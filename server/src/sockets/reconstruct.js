import * as repo from '../db/repository.js';
import { pool } from '../db/pool.js';
import { createRoomEntry } from './store.js';

// Reconstruit un RoomEntry complet (état pur du jeu + cache mémoire) à partir
// de la base — utilisé au démarrage (parties 'playing') et à la reconnexion
// (le snapshot renvoyé au client vient toujours de cette reconstruction,
// jamais du cache mémoire, même si le salon y est déjà présent).
export async function loadRoomEntryFromDb(roomRow) {
  const dbPlayers = await repo.fetchRoomPlayers(pool, roomRow.id);
  const players = dbPlayers.map((p) => ({
    id: String(p.user_id),
    pseudo: p.pseudo,
    score: p.score,
    status: p.state,
  }));
  const turnOrder = dbPlayers.filter((p) => p.state !== 'left').map((p) => String(p.user_id));

  const currentPartie = await repo.fetchCurrentPartie(pool, roomRow.id);
  const latestTurn = currentPartie ? await repo.fetchLatestTurn(pool, currentPartie.id) : null;
  let currentTurn = null;
  let currentTurnDbId = null;
  let currentTurnIndex = -1;
  let deadlineInfo = null;

  if (latestTurn && (latestTurn.status === 'answering' || latestTurn.status === 'voting')) {
    const votesRows = await repo.fetchVotesForTurn(pool, latestTurn.id);
    const votes = {};
    for (const v of votesRows) votes[String(v.voter_id)] = v.valeur === 1 ? 'up' : 'down';

    const questionRow = await repo.fetchQuestionById(pool, latestTurn.question_id);

    currentTurn = {
      turnNumber: latestTurn.numero,
      activePlayerId: String(latestTurn.player_id),
      type: questionRow?.type ?? null,
      questionId: latestTurn.question_id,
      phase: latestTurn.status,
      answer: latestTurn.reponse,
      votes,
    };
    currentTurnDbId = latestTurn.id;
    currentTurnIndex = turnOrder.indexOf(currentTurn.activePlayerId);
    deadlineInfo = {
      phase: latestTurn.status,
      deadline: latestTurn.status === 'answering' ? latestTurn.deadline : latestTurn.vote_deadline,
    };
  }

  const usedQuestionIds = currentPartie
    ? new Set(await repo.fetchUsedQuestionIds(pool, currentPartie.id))
    : new Set();
  const { questionPool: fullPool, byId: questionsById } = await repo.fetchQuestionBank(pool, {
    niveauMax: roomRow.niveau_max ?? 1,
    langue: roomRow.langue ?? 'fr',
  });
  const questionPool = {
    verite: {
      top: fullPool.verite.top.filter((id) => !usedQuestionIds.has(id)),
      lower: fullPool.verite.lower.filter((id) => !usedQuestionIds.has(id)),
    },
    action: {
      top: fullPool.action.top.filter((id) => !usedQuestionIds.has(id)),
      lower: fullPool.action.lower.filter((id) => !usedQuestionIds.has(id)),
    },
  };

  const room = {
    code: roomRow.code,
    hostId: String(roomRow.host_id),
    status: roomRow.status,
    settings: { maxTurns: roomRow.max_turns, targetScore: roomRow.score_cible },
    niveauMax: roomRow.niveau_max ?? 1,
    langue: roomRow.langue ?? 'fr',
    players,
    turnOrder,
    currentTurnIndex,
    turnNumber: latestTurn ? latestTurn.numero : 0,
    questionPool,
    currentTurn,
    history: [],
  };

  const messageRows = await repo.fetchRecentMessages(pool, roomRow.id, 30);
  const messages = messageRows.map((m) => ({
    id: m.id,
    playerId: String(m.user_id),
    pseudo: m.pseudo,
    text: m.contenu,
    createdAt: new Date(m.created_at).getTime(),
  }));

  const entry = createRoomEntry(room);
  entry.dbRoomId = roomRow.id;
  entry.dbPartieId = currentPartie?.id ?? null;
  entry.currentTurnDbId = currentTurnDbId;
  entry.questionsById = questionsById;
  entry.chat.messages = messages;

  const disconnectedPlayers = dbPlayers
    .filter((p) => p.state === 'disconnected')
    .map((p) => ({ id: String(p.user_id), lastSeenAt: p.last_seen_at }));

  return { entry, deadlineInfo, disconnectedPlayers };
}
