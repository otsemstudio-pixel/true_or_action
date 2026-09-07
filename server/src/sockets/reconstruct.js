import * as repo from '../db/repository.js';
import { pool } from '../db/pool.js';
import { createRoomEntry } from './store.js';
import { buildHistoryFromRows, buildCurrentNormalTurnFromRow } from './turnReconstruction.js';

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
    // Règle G : contrairement à la contrainte de style du joker (Phase 1),
    // la déclaration de bluff ET les mises doivent toutes deux survivre à une
    // reconnexion en cours de tour (exigence explicite de la Phase 3) — les
    // deux sont donc bien persistées, pas traitées comme éphémères.
    const bluffMisesRows = await repo.fetchBluffMisesForTurn(pool, latestTurn.id);

    // Un tour "joker inversé" a son question_id mis à NULL en base (voir
    // repository.js updateTurnQuestion) : la question réellement posée vit
    // dans joker_inverse_question_id à la place.
    const effectiveQuestionId = latestTurn.joker_inverse_question_id ?? latestTurn.question_id;
    const questionRow = await repo.fetchQuestionById(pool, effectiveQuestionId);

    // Le pari en cours (texte, verdict) et la contrainte de style du joker
    // ne survivent jamais à une reconstruction : jamais persistés (données
    // éphémères, voir game/turn.js) — fidélité partielle assumée, une
    // reconnexion en cours de tour peut donc laisser un second joueur
    // activer un nouveau joker de style. Fenêtre rare et sans enjeu de
    // score, laissée telle quelle.
    currentTurn = buildCurrentNormalTurnFromRow(latestTurn, {
      votesRows,
      bluffMisesRows,
      questionType: questionRow?.type ?? null,
    });
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
  const jokerPublicUsage = currentPartie ? await repo.fetchRegleUsage(pool, currentPartie.id, 'jokerPublic') : [];

  // room.history : reconstruit réellement depuis la base, comme le reste de
  // l'état de la partie — jusqu'ici toujours réinitialisé à vide ici, ce qui
  // rendait "la question retournée" (règle C) et le joker inversé, effet
  // "question précédente" (règle G), indisponibles après la moindre
  // reconnexion ou redémarrage serveur, tous deux ne lisant que
  // room.history[history.length - 1] (voir game/turn.js).
  const historyRows = currentPartie ? await repo.fetchTurnHistory(pool, currentPartie.id) : [];
  const historyTurnIds = historyRows.map((r) => r.id);
  const historyVotesRows = await repo.fetchVotesForTurnsWithVoter(pool, historyTurnIds);
  const historySurpriseRows = await repo.fetchTourSurpriseReponsesForTurns(pool, historyTurnIds);
  const history = buildHistoryFromRows(historyRows, historyVotesRows, historySurpriseRows);

  const room = {
    code: roomRow.code,
    hostId: String(roomRow.host_id),
    status: roomRow.status,
    settings: { maxTurns: roomRow.max_turns, targetScore: roomRow.score_cible },
    niveauMax: roomRow.niveau_max ?? 1,
    langue: roomRow.langue ?? 'fr',
    maxPlayers: roomRow.max_players ?? 8,
    answerSec: roomRow.timeout_sec ?? 45,
    categorie,
    players,
    turnOrder,
    currentTurnIndex,
    turnNumber: latestTurn ? latestTurn.numero : 0,
    questionPool,
    currentTurn,
    history,
    regles,
    reglesUsage: {
      questionRetournee: questionRetourneeUsage.map(String),
      jokerPublic: jokerPublicUsage.map(String),
    },
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
