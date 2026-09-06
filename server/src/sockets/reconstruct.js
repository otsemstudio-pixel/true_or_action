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
    isGuest: Boolean(p.is_guest),
  }));
  const turnOrder = dbPlayers.filter((p) => p.state !== 'left').map((p) => String(p.user_id));

  const currentPartie = await repo.fetchCurrentPartie(pool, roomRow.id);
  const latestTurn = currentPartie ? await repo.fetchLatestTurn(pool, currentPartie.id) : null;
  let currentTurn = null;
  let currentTurnDbId = null;
  let currentTurnIndex = -1;
  let deadlineInfo = null;

  // Un tour surprise en cours (player_id encore null, résolu seulement à la
  // fin) ne peut pas être reconstruit fidèlement : qui a déjà répondu/voté ne
  // vit qu'en mémoire tant que le tour n'est pas résolu. Comme pour les
  // pré-phases de règles (offre de double ou rien, choix parmi 3, jugement
  // de pari), on l'affiche comme "aucun tour en cours" plutôt que d'inventer
  // un état partiel — le tour suivant resynchronise tout le monde normalement.
  const isLiveNormalTurn =
    latestTurn && (latestTurn.status === 'answering' || latestTurn.status === 'voting') && latestTurn.player_id != null;

  if (isLiveNormalTurn) {
    const votesRows = await repo.fetchVotesForTurn(pool, latestTurn.id);
    const votes = {};
    for (const v of votesRows) votes[String(v.voter_id)] = v.valeur === 1 ? 'up' : 'down';

    const questionRow = await repo.fetchQuestionById(pool, latestTurn.question_id);

    currentTurn = {
      mode: 'normal',
      turnNumber: latestTurn.numero,
      activePlayerId: String(latestTurn.player_id),
      type: questionRow?.type ?? null,
      questionId: latestTurn.question_id,
      phase: latestTurn.status,
      answer: latestTurn.reponse,
      votes,
      doubleOuRien: Boolean(latestTurn.double_ou_rien),
      returned: latestTurn.returned_from_player_id != null,
      originalPlayerId: latestTurn.returned_from_player_id != null ? String(latestTurn.returned_from_player_id) : null,
      // Le pari en cours (texte, verdict) ne survit pas à une reconstruction :
      // il n'est jamais persisté (donnée éphémère, voir game/turn.js).
      pariMutuel: null,
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
  const categorie = roomRow.categorie ?? 'general';
  const { questionPool: fullPool, byId: questionsById } = await repo.fetchQuestionBank(pool, {
    niveauMax: roomRow.niveau_max ?? 1,
    langue: roomRow.langue ?? 'fr',
    categorie,
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

  const regles = repo.reglesFromRoomRow(roomRow);
  // Double ou rien n'existe pas en mode couple (pas de niveau supérieur où
  // piocher) : même vérification qu'effectiveRegles côté pur, dupliquée ici
  // car reconstruct.js construit le pool avant d'avoir un objet room complet.
  if (regles.doubleOuRien && categorie !== 'couple' && (roomRow.niveau_max ?? 1) < 3) {
    const { questionPool: escaladeBank } = await repo.fetchQuestionBank(pool, {
      niveauMax: (roomRow.niveau_max ?? 1) + 1,
      langue: roomRow.langue ?? 'fr',
      categorie,
    });
    questionPool.escalade = {
      verite: escaladeBank.verite.top.filter((id) => !usedQuestionIds.has(id)),
      action: escaladeBank.action.top.filter((id) => !usedQuestionIds.has(id)),
    };
  } else {
    questionPool.escalade = { verite: [], action: [] };
  }

  const questionRetourneeUsage = currentPartie
    ? await repo.fetchRegleUsage(pool, currentPartie.id, 'questionRetournee')
    : [];

  const room = {
    code: roomRow.code,
    hostId: String(roomRow.host_id),
    status: roomRow.status,
    settings: { maxTurns: roomRow.max_turns, targetScore: roomRow.score_cible },
    niveauMax: roomRow.niveau_max ?? 1,
    langue: roomRow.langue ?? 'fr',
    maxPlayers: roomRow.max_players ?? 8,
    categorie,
    players,
    turnOrder,
    currentTurnIndex,
    turnNumber: latestTurn ? latestTurn.numero : 0,
    questionPool,
    currentTurn,
    history: [],
    regles,
    reglesUsage: { questionRetournee: questionRetourneeUsage.map(String) },
    forceQuestionChoice: false,
  };

  const messageRows = await repo.fetchRecentMessages(pool, roomRow.id, 30);
  const messages = messageRows.map((m) => ({
    id: m.id,
    playerId: String(m.user_id),
    pseudo: m.pseudo,
    text: m.contenu,
    createdAt: new Date(m.created_at).getTime(),
    replyTo: m.reply_to_id ? { id: m.reply_to_id, pseudo: m.reply_pseudo, text: m.reply_contenu } : null,
    turnInfo: m.turn_id
      ? {
          turnNumber: m.turn_numero,
          type: m.question_type,
          contenu: m.question_contenu,
          points: m.turn_status === 'done' || m.turn_status === 'timeout' ? m.turn_points : null,
          resolved: m.turn_status === 'done' || m.turn_status === 'timeout',
          thumbsUp: Number(m.thumbs_up) || 0,
        }
      : null,
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
