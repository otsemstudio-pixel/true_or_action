import { GameError } from './errors.js';
import { POINTS, VOTE_BONUS, TIMERS, PLAYERS, REGLES, REGLES_TIMERS } from './constants.js';
import { canStart, getPlayer, excludePlayer, effectiveRegles } from './room.js';

const TOP_NIVEAU_WEIGHT = 0.6;

function defaultRng() {
  return Math.random();
}

export function startGame(room, { questionPool, rng = defaultRng }) {
  if (!canStart(room)) {
    throw new GameError('CANNOT_START', `Il faut au moins ${PLAYERS.min} joueurs pour lancer la partie`, {
      min: PLAYERS.min,
    });
  }

  const { maxTurns } = room.settings;
  if (maxTurns !== null) {
    const available = {
      verite: bucketCount(questionPool?.verite),
      action: bucketCount(questionPool?.action),
    };
    const missing = {
      verite: Math.max(0, maxTurns - available.verite),
      action: Math.max(0, maxTurns - available.action),
    };

    if (missing.verite > 0 || missing.action > 0) {
      throw new GameError(
        'NOT_ENOUGH_QUESTIONS',
        `Questions insuffisantes pour ${maxTurns} tours : il manque ${missing.verite} vérité et ${missing.action} action`,
        { missing, maxTurns }
      );
    }
  }

  const startedRoom = {
    ...room,
    status: 'playing',
    turnOrder: room.players.map((p) => p.id),
    currentTurnIndex: -1,
    turnNumber: 0,
    questionPool: {
      verite: cloneBucket(questionPool.verite),
      action: cloneBucket(questionPool.action),
      escalade: {
        verite: [...(questionPool.escalade?.verite ?? [])],
        action: [...(questionPool.escalade?.action ?? [])],
      },
    },
  };

  return advanceTurn(startedRoom, rng);
}

// ---------- Réponse normale ----------

export function submitAnswer(room, { playerId, text, rng = defaultRng }) {
  assertNormalTurn(room);
  assertTurnPhase(room, 'answering');

  if (room.currentTurn.activePlayerId !== playerId) {
    throw new GameError('NOT_YOUR_TURN', "Ce n'est pas votre tour de répondre");
  }

  const trimmed = (text ?? '').trim();
  if (!trimmed) {
    throw new GameError('EMPTY_ANSWER', 'La réponse ne peut pas être vide');
  }

  const turnNumber = room.currentTurn.turnNumber;
  const room2 = {
    ...room,
    currentTurn: { ...room.currentTurn, phase: 'voting', answer: trimmed },
  };

  const baseEffects = [
    { type: 'CLEAR_TIMER', name: 'answer', turnNumber },
    { type: 'ANSWER_SUBMITTED', turnNumber, playerId, answer: trimmed },
  ];

  // À 2 joueurs, le seul votant possible serait l'autre joueur : le vote n'a
  // pas de sens à sélectionner entre deux options avec une seule voix. La
  // phase de vote est sautée, les points restent la valeur de base (aucun
  // pouce haut ne peut s'ajouter puisque personne ne vote) — sauf pari mutuel
  // actif avec un pari déjà déposé : on ouvre alors la phase de jugement
  // plutôt que de résoudre tout de suite.
  if (room.turnOrder.length <= 2) {
    const regles = effectiveRegles(room);
    const pari = room.currentTurn.pariMutuel;
    if (regles.pariMutuel && pari?.bet != null) {
      const room3 = { ...room2, currentTurn: { ...room2.currentTurn, phase: 'jugement' } };
      return {
        room: room3,
        effects: [
          ...baseEffects,
          { type: 'JUGEMENT_STARTED', turnNumber, bettorId: pari.bettorId, bet: pari.bet },
          { type: 'START_TIMER', name: 'jugement', turnNumber, durationMs: REGLES_TIMERS.jugementMs },
        ],
      };
    }
    const resolved = resolveTurn(room2, rng);
    return { room: resolved.room, effects: [...baseEffects, ...resolved.effects] };
  }

  return {
    room: room2,
    effects: [...baseEffects, { type: 'START_TIMER', name: 'vote', turnNumber, durationMs: TIMERS.voteMs }],
  };
}

export function answerTimeout(room, { turnNumber, rng = defaultRng }) {
  assertNormalTurn(room);
  assertTurnPhase(room, 'answering');
  assertTurnNumber(room, turnNumber);

  return resolveTurn(room, rng);
}

export function submitVote(room, { voterId, vote, turnNumber, rng = defaultRng }) {
  assertNormalTurn(room);
  assertTurnPhase(room, 'voting');
  assertTurnNumber(room, turnNumber);

  if (voterId === room.currentTurn.activePlayerId) {
    throw new GameError('CANNOT_VOTE_SELF', 'Le joueur actif ne peut pas voter pour lui-même');
  }
  if (!getPlayer(room, voterId)) {
    throw new GameError('PLAYER_NOT_FOUND', 'Joueur introuvable dans le salon');
  }
  if (room.currentTurn.votes[voterId]) {
    throw new GameError('ALREADY_VOTED', 'Ce joueur a déjà voté pour ce tour');
  }
  if (vote !== 'up' && vote !== 'down') {
    throw new GameError('INVALID_VOTE', 'Vote invalide');
  }

  const room2 = {
    ...room,
    currentTurn: {
      ...room.currentTurn,
      votes: { ...room.currentTurn.votes, [voterId]: vote },
    },
  };

  const effects = [{ type: 'VOTE_SUBMITTED', turnNumber, voterId, vote }];

  const eligibleVoters = room.players.filter(
    (p) => p.id !== room.currentTurn.activePlayerId && p.status !== 'left'
  );
  const allVoted = eligibleVoters.every((p) => Boolean(room2.currentTurn.votes[p.id]));

  if (allVoted) {
    const resolved = resolveTurn(room2, rng);
    return {
      room: resolved.room,
      effects: [...effects, { type: 'CLEAR_TIMER', name: 'vote', turnNumber }, ...resolved.effects],
    };
  }

  return { room: room2, effects };
}

export function voteTimeout(room, { turnNumber, rng = defaultRng }) {
  assertNormalTurn(room);
  assertTurnPhase(room, 'voting');
  assertTurnNumber(room, turnNumber);

  return resolveTurn(room, rng);
}

// ---------- Règle A : le refus qui coûte ----------

export function submitPass(room, { playerId, rng = defaultRng }) {
  assertNormalTurn(room);
  assertTurnPhase(room, 'answering');
  const regles = effectiveRegles(room);
  if (!regles.refusCouteux) {
    throw new GameError('REGLE_DISABLED', "La règle du refus n'est pas activée dans ce salon");
  }
  if (room.currentTurn.activePlayerId !== playerId) {
    throw new GameError('NOT_YOUR_TURN', "Ce n'est pas votre tour");
  }

  const turnNumber = room.currentTurn.turnNumber;
  // Un refus après un double ou rien accepté ne rejoue pas le malus normal
  // (déjà prévenu par la règle B elle-même : "refusé ou timeout : zéro, et
  // le malus du refus ne s'applique pas") ni sa conséquence habituelle
  // (choix parmi 3 au tour suivant) — seul un refus "à froid" les déclenche.
  const afterDoubleOuRien = Boolean(room.currentTurn.doubleOuRien);
  const points = afterDoubleOuRien ? 0 : REGLES.refusMalus;

  const room2 = {
    ...room,
    players: room.players.map((p) => (p.id === playerId ? { ...p, score: p.score + points } : p)),
    currentTurn: { ...room.currentTurn, phase: 'resolved', answer: null },
    history: [
      ...room.history,
      { turnNumber, playerId, type: room.currentTurn.type, questionId: room.currentTurn.questionId, answer: null, votes: {}, points, mode: 'normal', refused: true },
    ],
    forceQuestionChoice: !afterDoubleOuRien,
  };

  const effects = [
    { type: 'CLEAR_TIMER', name: 'answer', turnNumber },
    { type: 'PASS_SUBMITTED', turnNumber, playerId, points },
  ];

  const endReason = checkGameEnd(room2);
  if (endReason) {
    const finished = { ...room2, status: 'finished', currentTurn: null };
    return { room: finished, effects: [...effects, { type: 'GAME_ENDED', reason: endReason, ranking: buildRanking(finished) }] };
  }

  const next = advanceTurn(room2, rng);
  return { room: next.room, effects: [...effects, ...next.effects] };
}

// ---------- Règle B : le double ou rien ----------

export function respondDoubleOuRien(room, { playerId, accept, rng = defaultRng }) {
  assertNormalTurn(room);
  assertTurnPhase(room, 'niveau_choice');
  if (room.currentTurn.activePlayerId !== playerId) {
    throw new GameError('NOT_YOUR_TURN', "Ce n'est pas votre tour");
  }
  return resolveNiveauChoice(room, Boolean(accept), rng);
}

export function niveauChoiceTimeout(room, { turnNumber, rng = defaultRng }) {
  assertNormalTurn(room);
  assertTurnPhase(room, 'niveau_choice');
  assertTurnNumber(room, turnNumber);
  return resolveNiveauChoice(room, false, rng);
}

function resolveNiveauChoice(room, accept, rng) {
  const turnNumber = room.currentTurn.turnNumber;
  const activePlayerId = room.currentTurn.activePlayerId;
  const clearEffect = { type: 'CLEAR_TIMER', name: 'niveau_choice', turnNumber };

  if (!accept) {
    const started = startAnsweringTurn(room, activePlayerId, rng, { doubleOuRien: false });
    return { room: started.room, effects: [clearEffect, ...started.effects] };
  }

  const escalade = room.questionPool.escalade ?? { verite: [], action: [] };
  const hasEscalade = escalade.verite.length > 0 || escalade.action.length > 0;
  if (!hasEscalade) {
    // Aucune question dispo au niveau supérieur (banque restreinte) : on
    // retombe silencieusement sur un tour normal plutôt que de bloquer.
    const started = startAnsweringTurn(room, activePlayerId, rng, { doubleOuRien: false });
    return { room: started.room, effects: [clearEffect, ...started.effects] };
  }

  const started = startAnsweringTurn(room, activePlayerId, rng, { doubleOuRien: true });
  return { room: started.room, effects: [clearEffect, ...started.effects] };
}

// ---------- Règle A (suite) : choix parmi 3 questions ----------

export function chooseQuestion(room, { playerId, questionId, rng = defaultRng }) {
  assertNormalTurn(room);
  assertTurnPhase(room, 'question_choice');
  if (room.currentTurn.activePlayerId !== playerId) {
    throw new GameError('NOT_YOUR_TURN', "Ce n'est pas votre tour");
  }
  const choice = room.currentTurn.choices.find((c) => c.questionId === questionId);
  if (!choice) {
    throw new GameError('INVALID_CHOICE', 'Cette question ne fait pas partie des propositions');
  }
  return resolveQuestionChoice(room, choice, rng);
}

export function questionChoiceTimeout(room, { turnNumber, rng = defaultRng }) {
  assertNormalTurn(room);
  assertTurnPhase(room, 'question_choice');
  assertTurnNumber(room, turnNumber);
  // Pas de choix exprimé : la première proposition est retenue par défaut.
  const choice = room.currentTurn.choices[0];
  return resolveQuestionChoice(room, choice, rng);
}

function resolveQuestionChoice(room, choice, rng) {
  const turnNumber = room.currentTurn.turnNumber;
  const activePlayerId = room.currentTurn.activePlayerId;
  const clearEffect = { type: 'CLEAR_TIMER', name: 'question_choice', turnNumber };

  // Les propositions non retenues retournent dans le réservoir pour de
  // prochains tirages (seule celle choisie est réellement consommée).
  const discarded = room.currentTurn.choices.filter((c) => c.questionId !== choice.questionId);
  let pool = room.questionPool;
  for (const c of discarded) {
    pool = { ...pool, [c.type]: { ...pool[c.type], top: [...pool[c.type].top, c.questionId] } };
  }

  const roomWithPool = { ...room, questionPool: pool };
  const started = startAnsweringTurn(roomWithPool, activePlayerId, rng, {
    doubleOuRien: false,
    forcedType: choice.type,
    forcedQuestionId: choice.questionId,
  });
  return { room: started.room, effects: [clearEffect, ...started.effects] };
}

// ---------- Règle C : la question retournée ----------

export function returnQuestion(room, { playerId }) {
  assertNormalTurn(room);
  assertTurnPhase(room, 'answering');
  const regles = effectiveRegles(room);
  if (!regles.questionRetournee) {
    throw new GameError('REGLE_DISABLED', "La règle de la question retournée n'est pas activée dans ce salon");
  }
  if (room.currentTurn.activePlayerId !== playerId) {
    throw new GameError('NOT_YOUR_TURN', "Ce n'est pas votre tour");
  }
  if (room.currentTurn.doubleOuRien) {
    throw new GameError('QUESTION_RETOURNEE_INDISPONIBLE', 'Impossible de retourner une question de double ou rien');
  }
  if (room.currentTurn.returned) {
    throw new GameError('QUESTION_RETOURNEE_INDISPONIBLE', 'Cette question a déjà été retournée');
  }
  if (room.reglesUsage.questionRetournee.includes(playerId)) {
    throw new GameError('QUESTION_RETOURNEE_INDISPONIBLE', 'Déjà utilisée cette partie');
  }

  const target = findBestPreviousVoter(room);
  if (!target) {
    throw new GameError('QUESTION_RETOURNEE_INDISPONIBLE', 'Aucun tour précédent valable');
  }

  const turnNumber = room.currentTurn.turnNumber;
  const room2 = {
    ...room,
    currentTurn: {
      ...room.currentTurn,
      activePlayerId: target,
      returned: true,
      originalPlayerId: playerId,
    },
    reglesUsage: {
      ...room.reglesUsage,
      questionRetournee: [...room.reglesUsage.questionRetournee, playerId],
    },
  };

  return {
    room: room2,
    effects: [{ type: 'QUESTION_RETURNED', turnNumber, fromPlayerId: playerId, toPlayerId: target }],
  };
}

// Le "mieux noté" au tour précédent : parmi les votes binaires, on retient le
// premier joueur ayant voté "up" (aucun classement possible au-delà d'un
// binaire, donc pas d'ambiguïté à trancher). Indisponible si le tour
// précédent n'existe pas, n'est pas un tour normal résolu, ou n'a récolté
// aucun pouce vers le haut (2 joueurs et pari mutuel : aucun vote n'existe
// jamais, donc jamais de cible non plus — cohérent sans code spécial).
function findBestPreviousVoter(room) {
  const last = room.history[room.history.length - 1];
  if (!last || last.mode !== 'normal') return null;
  const upVoter = Object.entries(last.votes ?? {}).find(([, v]) => v === 'up');
  return upVoter ? upVoter[0] : null;
}

// ---------- Règle E : le pari mutuel (2 joueurs uniquement) ----------

export function submitBet(room, { playerId, text }) {
  assertNormalTurn(room);
  assertTurnPhase(room, 'answering');
  const regles = effectiveRegles(room);
  if (!regles.pariMutuel) {
    throw new GameError('REGLE_DISABLED', "Le pari mutuel n'est pas activé dans ce salon");
  }
  if (playerId === room.currentTurn.activePlayerId) {
    throw new GameError('PARI_MUTUEL_INDISPONIBLE', 'Le joueur actif ne peut pas parier sur sa propre réponse');
  }
  if (!getPlayer(room, playerId)) {
    throw new GameError('PLAYER_NOT_FOUND', 'Joueur introuvable dans le salon');
  }
  if (room.currentTurn.pariMutuel?.bet != null) {
    throw new GameError('PARI_MUTUEL_INDISPONIBLE', 'Un pari a déjà été déposé pour ce tour');
  }
  const trimmed = (text ?? '').trim();
  if (!trimmed) {
    throw new GameError('EMPTY_ANSWER', 'Le pari ne peut pas être vide');
  }

  return {
    room: {
      ...room,
      currentTurn: { ...room.currentTurn, pariMutuel: { bettorId: playerId, bet: trimmed, verdict: null } },
    },
    effects: [],
  };
}

export function judgeBet(room, { playerId, verdict, rng = defaultRng }) {
  assertNormalTurn(room);
  assertTurnPhase(room, 'jugement');
  if (room.currentTurn.activePlayerId !== playerId) {
    throw new GameError('NOT_YOUR_TURN', "Ce n'est pas votre tour");
  }
  if (verdict !== 'juste' && verdict !== 'a_cote') {
    throw new GameError('INVALID_VOTE', 'Verdict invalide');
  }
  return resolveJugement(room, verdict, rng);
}

export function judgeBetTimeout(room, { turnNumber, rng = defaultRng }) {
  assertNormalTurn(room);
  assertTurnPhase(room, 'jugement');
  assertTurnNumber(room, turnNumber);
  return resolveJugement(room, 'a_cote', rng);
}

function resolveJugement(room, verdict, rng) {
  const turnNumber = room.currentTurn.turnNumber;
  const clearEffect = { type: 'CLEAR_TIMER', name: 'jugement', turnNumber };
  const resolved = resolveTurn(room, rng, { pariMutuelVerdict: verdict });
  return { room: resolved.room, effects: [clearEffect, ...resolved.effects] };
}

// ---------- Règle D : le tour surprise ----------

export function submitSurpriseAnswer(room, { playerId, text }) {
  assertSurpriseTurn(room);
  assertTurnPhase(room, 'answering');
  if (!room.currentTurn.activePlayerIds.includes(playerId)) {
    throw new GameError('NOT_YOUR_TURN', "Vous ne participez pas à ce tour");
  }
  if (room.currentTurn.answers[playerId] != null) {
    throw new GameError('ALREADY_ANSWERED', 'Vous avez déjà répondu');
  }
  const trimmed = (text ?? '').trim();
  if (!trimmed) {
    throw new GameError('EMPTY_ANSWER', 'La réponse ne peut pas être vide');
  }

  const turnNumber = room.currentTurn.turnNumber;
  const answers = { ...room.currentTurn.answers, [playerId]: trimmed };
  const room2 = { ...room, currentTurn: { ...room.currentTurn, answers } };
  const effects = [{ type: 'SURPRISE_ANSWER_SUBMITTED', turnNumber, playerId }];

  const allAnswered = room.currentTurn.activePlayerIds.every((id) => answers[id] != null);
  if (allAnswered) {
    const opened = openSurpriseVoting(room2, turnNumber);
    return { room: opened.room, effects: [...effects, { type: 'CLEAR_TIMER', name: 'answer', turnNumber }, ...opened.effects] };
  }
  return { room: room2, effects };
}

export function surpriseAnswerTimeout(room, { turnNumber }) {
  assertSurpriseTurn(room);
  assertTurnPhase(room, 'answering');
  assertTurnNumber(room, turnNumber);
  const opened = openSurpriseVoting(room, turnNumber);
  return { room: opened.room, effects: opened.effects };
}

function openSurpriseVoting(room, turnNumber) {
  const room2 = { ...room, currentTurn: { ...room.currentTurn, phase: 'voting', votes: {} } };
  return {
    room: room2,
    effects: [
      {
        type: 'SURPRISE_VOTING_STARTED',
        turnNumber,
        answers: Object.entries(room.currentTurn.answers).map(([playerId, text]) => ({ playerId, text })),
      },
      { type: 'START_TIMER', name: 'vote', turnNumber, durationMs: TIMERS.voteMs },
    ],
  };
}

export function submitSurpriseVote(room, { voterId, targetId, rng = defaultRng }) {
  assertSurpriseTurn(room);
  assertTurnPhase(room, 'voting');
  if (!room.currentTurn.activePlayerIds.includes(voterId)) {
    throw new GameError('NOT_YOUR_TURN', "Vous ne participez pas à ce tour");
  }
  if (voterId === targetId) {
    throw new GameError('CANNOT_VOTE_SELF', 'Vous ne pouvez pas voter pour vous-même');
  }
  if (room.currentTurn.answers[targetId] == null) {
    throw new GameError('SURPRISE_VOTE_INVALID', "Ce joueur n'a pas répondu");
  }
  if (room.currentTurn.votes[voterId]) {
    throw new GameError('ALREADY_VOTED', 'Ce joueur a déjà voté pour ce tour');
  }

  const turnNumber = room.currentTurn.turnNumber;
  const votes = { ...room.currentTurn.votes, [voterId]: targetId };
  const room2 = { ...room, currentTurn: { ...room.currentTurn, votes } };
  const effects = [{ type: 'SURPRISE_VOTE_SUBMITTED', turnNumber, voterId }];

  const eligibleVoters = room.currentTurn.activePlayerIds.filter((id) => room.currentTurn.answers[id] != null || true);
  const allVoted = eligibleVoters.every((id) => Boolean(votes[id]));
  if (allVoted) {
    const resolved = resolveSurpriseTurn(room2, rng);
    return { room: resolved.room, effects: [...effects, { type: 'CLEAR_TIMER', name: 'vote', turnNumber }, ...resolved.effects] };
  }
  return { room: room2, effects };
}

export function surpriseVoteTimeout(room, { turnNumber, rng = defaultRng }) {
  assertSurpriseTurn(room);
  assertTurnPhase(room, 'voting');
  assertTurnNumber(room, turnNumber);
  return resolveSurpriseTurn(room, rng);
}

function resolveSurpriseTurn(room, rng) {
  const turn = room.currentTurn;
  const turnNumber = turn.turnNumber;

  const votesRecus = {};
  for (const id of turn.activePlayerIds) votesRecus[id] = 0;
  for (const target of Object.values(turn.votes)) votesRecus[target] = (votesRecus[target] ?? 0) + 1;

  const answeredIds = turn.activePlayerIds.filter((id) => turn.answers[id] != null);
  const maxVotes = answeredIds.length > 0 ? Math.max(...answeredIds.map((id) => votesRecus[id] ?? 0)) : 0;
  const winnerIds = maxVotes > 0 ? answeredIds.filter((id) => votesRecus[id] === maxVotes) : [];

  const results = turn.activePlayerIds.map((id) => {
    const answered = turn.answers[id] != null;
    const isWinner = winnerIds.includes(id);
    const points = isWinner ? REGLES.tourSurprisePointsGagnant : answered ? REGLES.tourSurprisePointsParticipant : 0;
    return { playerId: id, answer: turn.answers[id] ?? null, votesRecus: votesRecus[id] ?? 0, points };
  });

  const players = room.players.map((p) => {
    const result = results.find((r) => r.playerId === p.id);
    return result ? { ...p, score: p.score + result.points } : p;
  });

  const room2 = {
    ...room,
    players,
    currentTurn: { ...turn, phase: 'resolved' },
    history: [
      ...room.history,
      { turnNumber, mode: 'surprise', questionId: turn.questionId, type: turn.type, results, votes: {} },
    ],
  };

  const effects = [{ type: 'SURPRISE_RESOLVED', turnNumber, results, winnerIds }];

  const endReason = checkGameEnd(room2);
  if (endReason) {
    const finished = { ...room2, status: 'finished', currentTurn: null };
    return { room: finished, effects: [...effects, { type: 'GAME_ENDED', reason: endReason, ranking: buildRanking(finished) }] };
  }

  const next = advanceTurn(room2, rng);
  return { room: next.room, effects: [...effects, ...next.effects] };
}

// ---------- Aiguillage phase / mode ----------

function assertTurnPhase(room, phase) {
  if (!room.currentTurn || room.currentTurn.phase !== phase) {
    throw new GameError('INVALID_PHASE', 'Action invalide pour la phase actuelle du tour');
  }
}

function assertTurnNumber(room, turnNumber) {
  if (room.currentTurn.turnNumber !== turnNumber) {
    throw new GameError('STALE_TURN', 'Ce tour est déjà terminé');
  }
}

function assertNormalTurn(room) {
  if (room.currentTurn?.mode === 'surprise') {
    throw new GameError('INVALID_PHASE', 'Action invalide pendant un tour surprise');
  }
}

function assertSurpriseTurn(room) {
  if (room.currentTurn?.mode !== 'surprise') {
    throw new GameError('INVALID_PHASE', "Ce tour n'est pas un tour surprise");
  }
}

function bucketCount(buckets) {
  return (buckets?.top?.length ?? 0) + (buckets?.lower?.length ?? 0);
}

function cloneBucket(buckets) {
  return { top: [...(buckets?.top ?? [])], lower: [...(buckets?.lower ?? [])] };
}

function drawType(rng) {
  return rng() < 0.5 ? 'verite' : 'action';
}

// Tire dans niveau <= niveau_max du salon (déjà filtré par l'appelant lors de
// la construction du pool). 60% de chances de tirer dans le niveau maximum
// autorisé ("top"), 40% dans les niveaux inférieurs ("lower"), si les deux
// ensembles sont non vides ; sinon tirage simple sur l'ensemble disponible.
// Le rng est toujours consommé de la même façon (type, panier, index) pour
// rester prévisible, que le choix de panier soit réellement disputé ou non.
function drawQuestion(pool, type, rng) {
  const buckets = pool[type];
  const hasTop = buckets.top.length > 0;
  const hasLower = buckets.lower.length > 0;

  if (!hasTop && !hasLower) {
    throw new GameError('NO_QUESTIONS_LEFT', `Plus de question de type ${type} disponible`, { type });
  }

  const bucketRoll = rng();
  let bucketName;
  if (hasTop && hasLower) {
    bucketName = bucketRoll < TOP_NIVEAU_WEIGHT ? 'top' : 'lower';
  } else {
    bucketName = hasTop ? 'top' : 'lower';
  }

  const list = buckets[bucketName];
  const index = Math.floor(rng() * list.length);
  const questionId = list[index];
  const nextList = [...list.slice(0, index), ...list.slice(index + 1)];
  const nextPool = { ...pool, [type]: { ...buckets, [bucketName]: nextList } };
  return { questionId, nextPool };
}

// Tire `count` questions distinctes du même type (règle A : 3 propositions).
// Si le réservoir est trop court, renvoie ce qu'il a pu tirer (le reste des
// propositions verra sa liste "choices" plus courte, sans planter).
function drawDistinctQuestions(pool, type, rng, count) {
  const ids = [];
  let currentPool = pool;
  for (let i = 0; i < count; i++) {
    if (bucketCount(currentPool[type]) === 0) break;
    const { questionId, nextPool } = drawQuestion(currentPool, type, rng);
    ids.push(questionId);
    currentPool = nextPool;
  }
  return { questionIds: ids, nextPool: currentPool };
}

function drawFromFlatList(list, rng) {
  const index = Math.floor(rng() * list.length);
  const id = list[index];
  return { id, next: [...list.slice(0, index), ...list.slice(index + 1)] };
}

function nextActiveIndex(room) {
  if (room.turnOrder.length === 0) return -1;
  return (room.currentTurnIndex + 1) % room.turnOrder.length;
}

// Construit et démarre le prochain tour : tour surprise (règle D, tiré au
// hasard), sinon tour normal — lui-même précédé, le cas échéant, d'une
// pré-phase spéciale (choix parmi 3 après un refus, ou offre de double ou
// rien) avant que la question ne soit révélée.
function advanceTurn(room, rng) {
  const regles = effectiveRegles(room);
  const turnNumber = room.turnNumber + 1;

  // Un refus vient de forcer un choix parmi 3 pour le tour suivant : cette
  // conséquence prime sur un tirage de tour surprise ou une offre de double
  // ou rien, pour ne jamais empiler deux pré-phases spéciales sur un même tour.
  if (room.forceQuestionChoice) {
    return startQuestionChoiceTurn({ ...room, turnNumber, forceQuestionChoice: false }, rng);
  }

  // Tour surprise : jamais si le pari mutuel doit remplacer le vote à 2
  // joueurs (structurellement incompatibles, voir effectiveRegles/decision).
  if (regles.tourSurprise && !regles.pariMutuel) {
    if (rng() < REGLES.tourSurpriseChance) {
      return startSurpriseTurn({ ...room, turnNumber }, rng);
    }
  }

  const currentTurnIndex = nextActiveIndex(room);
  const activePlayerId = room.turnOrder[currentTurnIndex];
  const baseRoom = { ...room, turnNumber, currentTurnIndex };

  if (regles.doubleOuRien && room.niveauMax < 3) {
    return startNiveauChoiceTurn(baseRoom, activePlayerId);
  }

  return startAnsweringTurn(baseRoom, activePlayerId, rng, {});
}

function startNiveauChoiceTurn(room, activePlayerId) {
  const turnNumber = room.turnNumber;
  const room2 = {
    ...room,
    currentTurn: {
      mode: 'normal',
      turnNumber,
      activePlayerId,
      type: null,
      questionId: null,
      phase: 'niveau_choice',
      answer: null,
      votes: {},
      doubleOuRien: false,
      returned: false,
      originalPlayerId: null,
      pariMutuel: null,
    },
  };
  return {
    room: room2,
    effects: [
      { type: 'NIVEAU_CHOICE_OFFERED', turnNumber, activePlayerId },
      { type: 'START_TIMER', name: 'niveau_choice', turnNumber, durationMs: REGLES_TIMERS.niveauChoiceMs },
    ],
  };
}

function startQuestionChoiceTurn(room, rng) {
  const turnNumber = room.turnNumber;
  const currentTurnIndex = nextActiveIndex(room);
  const activePlayerId = room.turnOrder[currentTurnIndex];
  const type = drawType(rng);
  const { questionIds, nextPool } = drawDistinctQuestions(room.questionPool, type, rng, 3);

  if (questionIds.length === 0) {
    // Réservoir épuisé pour ce type : bascule sur un tirage normal plutôt
    // que de bloquer le jeu avec un choix impossible.
    return startAnsweringTurn({ ...room, currentTurnIndex }, activePlayerId, rng, {});
  }

  const choices = questionIds.map((questionId) => ({ questionId, type }));

  const room2 = {
    ...room,
    currentTurnIndex,
    questionPool: nextPool,
    currentTurn: {
      mode: 'normal',
      turnNumber,
      activePlayerId,
      type: null,
      questionId: null,
      phase: 'question_choice',
      answer: null,
      votes: {},
      doubleOuRien: false,
      returned: false,
      originalPlayerId: null,
      pariMutuel: null,
      choices,
    },
  };

  return {
    room: room2,
    effects: [
      { type: 'QUESTION_CHOICE_OFFERED', turnNumber, activePlayerId, choices },
      { type: 'START_TIMER', name: 'question_choice', turnNumber, durationMs: REGLES_TIMERS.questionChoiceMs },
    ],
  };
}

// Révèle la question et ouvre la phase de réponse — point d'entrée commun au
// tirage direct, à la sortie d'une offre de double ou rien et à la sortie
// d'un choix parmi 3.
function startAnsweringTurn(room, activePlayerId, rng, { doubleOuRien = false, forcedType = null, forcedQuestionId = null }) {
  const turnNumber = room.turnNumber;
  let type = forcedType;
  let questionId = forcedQuestionId;
  let nextPool = room.questionPool;

  if (questionId == null) {
    type = drawType(rng);
    if (doubleOuRien) {
      const escalade = room.questionPool.escalade?.[type] ?? [];
      const { id, next } = drawFromFlatList(escalade, rng);
      questionId = id;
      nextPool = { ...room.questionPool, escalade: { ...room.questionPool.escalade, [type]: next } };
    } else {
      const drawn = drawQuestion(room.questionPool, type, rng);
      questionId = drawn.questionId;
      nextPool = drawn.nextPool;
    }
  }

  const regles = effectiveRegles(room);
  const pariMutuel = regles.pariMutuel ? { bettorId: null, bet: null, verdict: null } : null;

  const room2 = {
    ...room,
    questionPool: nextPool,
    currentTurn: {
      mode: 'normal',
      turnNumber,
      activePlayerId,
      type,
      questionId,
      phase: 'answering',
      answer: null,
      votes: {},
      doubleOuRien,
      returned: false,
      originalPlayerId: null,
      pariMutuel,
    },
  };

  return {
    room: room2,
    effects: [
      { type: 'TURN_STARTED', turnNumber, activePlayerId, questionType: type, questionId, doubleOuRien },
      { type: 'START_TIMER', name: 'answer', turnNumber, durationMs: TIMERS.answerMs },
    ],
  };
}

function startSurpriseTurn(room, rng) {
  const turnNumber = room.turnNumber;
  const type = drawType(rng);
  const { questionId, nextPool } = drawQuestion(room.questionPool, type, rng);

  const room2 = {
    ...room,
    questionPool: nextPool,
    currentTurn: {
      mode: 'surprise',
      turnNumber,
      type,
      questionId,
      phase: 'answering',
      activePlayerIds: [...room.turnOrder],
      answers: {},
      votes: {},
    },
  };

  return {
    room: room2,
    effects: [
      {
        type: 'TURN_STARTED',
        turnNumber,
        mode: 'surprise',
        activePlayerIds: [...room.turnOrder],
        questionType: type,
        questionId,
      },
      { type: 'START_TIMER', name: 'answer', turnNumber, durationMs: TIMERS.answerMs },
    ],
  };
}

function resolveTurn(room, rng, { pariMutuelVerdict = null } = {}) {
  const turn = room.currentTurn;
  const thumbsUp = Object.values(turn.votes).filter((v) => v === 'up').length;
  let points = turn.answer === null ? 0 : POINTS[turn.type] + thumbsUp * VOTE_BONUS;
  if (turn.doubleOuRien) {
    points = turn.answer === null ? 0 : points * REGLES.doubleOuRienMultiplicateur;
  }

  let players = room.players.map((p) =>
    p.id === turn.activePlayerId ? { ...p, score: p.score + points } : p
  );

  let pariMutuelResult = null;
  if (turn.pariMutuel?.bet != null && pariMutuelVerdict != null) {
    const bonus = pariMutuelVerdict === 'juste' ? REGLES.pariMutuelPoints : 0;
    pariMutuelResult = { bettorId: turn.pariMutuel.bettorId, verdict: pariMutuelVerdict, points: bonus };
    if (bonus > 0) {
      players = players.map((p) => (p.id === turn.pariMutuel.bettorId ? { ...p, score: p.score + bonus } : p));
    }
  }

  const historyEntry = {
    turnNumber: turn.turnNumber,
    playerId: turn.activePlayerId,
    type: turn.type,
    questionId: turn.questionId,
    answer: turn.answer,
    votes: turn.votes,
    points,
    mode: 'normal',
    doubleOuRien: turn.doubleOuRien,
    returned: turn.returned,
    pariMutuel: pariMutuelResult,
  };

  let room2 = {
    ...room,
    players,
    currentTurn: { ...turn, phase: 'resolved' },
    history: [...room.history, historyEntry],
  };

  const effects = [
    {
      type: 'TURN_RESOLVED',
      turnNumber: turn.turnNumber,
      playerId: turn.activePlayerId,
      points,
      votes: turn.votes,
      timedOut: turn.answer === null,
      doubleOuRien: turn.doubleOuRien,
      pariMutuel: pariMutuelResult,
    },
  ];

  const endReason = checkGameEnd(room2);
  if (endReason) {
    room2 = { ...room2, status: 'finished', currentTurn: null };
    return {
      room: room2,
      effects: [...effects, { type: 'GAME_ENDED', reason: endReason, ranking: buildRanking(room2) }],
    };
  }

  const next = advanceTurn(room2, rng);
  return { room: next.room, effects: [...effects, ...next.effects] };
}

function checkGameEnd(room) {
  const { maxTurns, targetScore } = room.settings;
  if (maxTurns !== null && room.turnNumber >= maxTurns) return 'maxTurns';
  if (targetScore !== null && room.players.some((p) => p.score >= targetScore)) return 'targetScore';
  return null;
}

function buildRanking(room) {
  return [...room.players]
    .sort((a, b) => b.score - a.score)
    .map((p) => ({ playerId: p.id, score: p.score }));
}

// Exclut un joueur (fin de grâce après déconnexion). S'il n'en reste plus
// qu'un seul en partie, celle-ci se termine immédiatement avec le classement
// en l'état — jouer seul n'a pas de sens. Les timers de tour en cours (s'il y
// en avait) sont explicitement effacés, que la partie soit terminée ou non.
export function handlePlayerLeft(room, playerId) {
  const updatedRoom = excludePlayer(room, playerId);

  if (updatedRoom.status !== 'playing') {
    return { room: updatedRoom, effects: [] };
  }

  if (updatedRoom.turnOrder.length <= 1) {
    const finished = { ...updatedRoom, status: 'finished', currentTurn: null };
    return {
      room: finished,
      effects: [
        { type: 'CLEAR_TIMER', name: 'answer' },
        { type: 'CLEAR_TIMER', name: 'vote' },
        { type: 'CLEAR_TIMER', name: 'niveau_choice' },
        { type: 'CLEAR_TIMER', name: 'question_choice' },
        { type: 'CLEAR_TIMER', name: 'jugement' },
        { type: 'GAME_ENDED', reason: 'notEnoughPlayers', ranking: buildRanking(finished) },
      ],
    };
  }

  return { room: updatedRoom, effects: [] };
}
