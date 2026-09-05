import { GameError } from './errors.js';
import { POINTS, VOTE_BONUS, TIMERS } from './constants.js';
import { canStart, getPlayer } from './room.js';

function defaultRng() {
  return Math.random();
}

export function startGame(room, { questionPool, rng = defaultRng }) {
  if (!canStart(room)) {
    throw new GameError('CANNOT_START', 'Il faut au moins 3 joueurs pour lancer la partie');
  }

  const { maxTurns } = room.settings;
  const available = {
    verite: questionPool?.verite?.length ?? 0,
    action: questionPool?.action?.length ?? 0,
  };
  const missing = {
    verite: Math.max(0, maxTurns - available.verite),
    action: Math.max(0, maxTurns - available.action),
  };

  if (missing.verite > 0 || missing.action > 0) {
    throw new GameError(
      'NOT_ENOUGH_QUESTIONS',
      `Questions insuffisantes pour ${maxTurns} tours : il manque ${missing.verite} vérité et ${missing.action} action`,
      { missing }
    );
  }

  const startedRoom = {
    ...room,
    status: 'playing',
    turnOrder: room.players.map((p) => p.id),
    currentTurnIndex: -1,
    turnNumber: 0,
    questionPool: {
      verite: [...questionPool.verite],
      action: [...questionPool.action],
    },
  };

  return advanceTurn(startedRoom, rng);
}

export function submitAnswer(room, { playerId, text }) {
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

  return {
    room: room2,
    effects: [
      { type: 'CLEAR_TIMER', name: 'answer', turnNumber },
      { type: 'ANSWER_SUBMITTED', turnNumber, playerId, answer: trimmed },
      { type: 'START_TIMER', name: 'vote', turnNumber, durationMs: TIMERS.voteMs },
    ],
  };
}

export function answerTimeout(room, { turnNumber, rng = defaultRng }) {
  assertTurnPhase(room, 'answering');
  assertTurnNumber(room, turnNumber);

  return resolveTurn(room, rng);
}

export function submitVote(room, { voterId, vote, turnNumber, rng = defaultRng }) {
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
    (p) => p.id !== room.currentTurn.activePlayerId && p.status !== 'excluded'
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
  assertTurnPhase(room, 'voting');
  assertTurnNumber(room, turnNumber);

  return resolveTurn(room, rng);
}

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

function drawType(rng) {
  return rng() < 0.5 ? 'verite' : 'action';
}

function drawQuestion(pool, type, rng) {
  const list = pool[type];
  const index = Math.floor(rng() * list.length);
  const questionId = list[index];
  const nextList = [...list.slice(0, index), ...list.slice(index + 1)];
  return { questionId, nextPool: { ...pool, [type]: nextList } };
}

function nextActiveIndex(room) {
  if (room.turnOrder.length === 0) return -1;
  return (room.currentTurnIndex + 1) % room.turnOrder.length;
}

function advanceTurn(room, rng) {
  const turnNumber = room.turnNumber + 1;
  const currentTurnIndex = nextActiveIndex(room);
  const activePlayerId = room.turnOrder[currentTurnIndex];

  const type = drawType(rng);
  const { questionId, nextPool } = drawQuestion(room.questionPool, type, rng);

  const room2 = {
    ...room,
    turnNumber,
    currentTurnIndex,
    questionPool: nextPool,
    currentTurn: {
      turnNumber,
      activePlayerId,
      type,
      questionId,
      phase: 'answering',
      answer: null,
      votes: {},
    },
  };

  return {
    room: room2,
    effects: [
      { type: 'TURN_STARTED', turnNumber, activePlayerId, questionType: type, questionId },
      { type: 'START_TIMER', name: 'answer', turnNumber, durationMs: TIMERS.answerMs },
    ],
  };
}

function resolveTurn(room, rng) {
  const turn = room.currentTurn;
  const thumbsUp = Object.values(turn.votes).filter((v) => v === 'up').length;
  const points = turn.answer === null ? 0 : POINTS[turn.type] + thumbsUp * VOTE_BONUS;

  const players = room.players.map((p) =>
    p.id === turn.activePlayerId ? { ...p, score: p.score + points } : p
  );

  const historyEntry = {
    turnNumber: turn.turnNumber,
    playerId: turn.activePlayerId,
    type: turn.type,
    questionId: turn.questionId,
    answer: turn.answer,
    votes: turn.votes,
    points,
  };

  let room2 = {
    ...room,
    players,
    currentTurn: { ...turn, phase: 'resolved' },
    history: [...room.history, historyEntry],
  };

  const effects = [
    { type: 'TURN_RESOLVED', turnNumber: turn.turnNumber, playerId: turn.activePlayerId, points, votes: turn.votes },
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
  if (room.turnNumber >= room.settings.maxTurns) return 'maxTurns';
  if (room.settings.targetScore !== null) {
    const reached = room.players.some((p) => p.score >= room.settings.targetScore);
    if (reached) return 'targetScore';
  }
  return null;
}

function buildRanking(room) {
  return [...room.players]
    .sort((a, b) => b.score - a.score)
    .map((p) => ({ playerId: p.id, score: p.score }));
}
