import { GameError } from './errors.js';
import { PLAYERS } from './constants.js';

export function createRoom({ code, hostId, hostPseudo, maxTurns, targetScore = null }) {
  if (!Number.isInteger(maxTurns) || maxTurns < 1) {
    throw new GameError('INVALID_SETTINGS', 'maxTurns doit être un entier positif');
  }
  if (targetScore !== null && (!Number.isInteger(targetScore) || targetScore < 1)) {
    throw new GameError('INVALID_SETTINGS', 'targetScore doit être un entier positif');
  }

  return {
    code,
    hostId,
    status: 'waiting',
    settings: { maxTurns, targetScore },
    players: [{ id: hostId, pseudo: hostPseudo, score: 0, status: 'connected' }],
    turnOrder: [],
    currentTurnIndex: -1,
    turnNumber: 0,
    questionPool: { verite: [], action: [] },
    currentTurn: null,
    history: [],
  };
}

export function addPlayer(room, { id, pseudo }) {
  if (room.status !== 'waiting') {
    throw new GameError('ROOM_NOT_JOINABLE', 'La partie a déjà commencé');
  }
  if (room.players.length >= PLAYERS.max) {
    throw new GameError('ROOM_FULL', 'Le salon est complet');
  }
  if (room.players.some((p) => p.id === id)) {
    throw new GameError('ALREADY_IN_ROOM', 'Ce joueur est déjà dans le salon');
  }

  return {
    ...room,
    players: [...room.players, { id, pseudo, score: 0, status: 'connected' }],
  };
}

export function removePlayer(room, playerId) {
  if (room.status !== 'waiting') {
    throw new GameError('ROOM_NOT_JOINABLE', 'Impossible de quitter une partie en cours');
  }

  const players = room.players.filter((p) => p.id !== playerId);
  if (players.length === room.players.length) return room;

  const hostId = room.hostId === playerId && players.length > 0 ? players[0].id : room.hostId;

  return { ...room, players, hostId };
}

export function markDisconnected(room, playerId) {
  return updatePlayerStatus(room, playerId, 'disconnected');
}

export function markReconnected(room, playerId) {
  return updatePlayerStatus(room, playerId, 'connected');
}

export function excludePlayer(room, playerId) {
  const updated = updatePlayerStatus(room, playerId, 'excluded');
  return {
    ...updated,
    turnOrder: updated.turnOrder.filter((id) => id !== playerId),
  };
}

function updatePlayerStatus(room, playerId, status) {
  const player = getPlayer(room, playerId);
  if (!player) {
    throw new GameError('PLAYER_NOT_FOUND', 'Joueur introuvable dans le salon');
  }
  return {
    ...room,
    players: room.players.map((p) => (p.id === playerId ? { ...p, status } : p)),
  };
}

export function getPlayer(room, playerId) {
  return room.players.find((p) => p.id === playerId) || null;
}

export function getActivePlayer(room) {
  if (!room.currentTurn) return null;
  return getPlayer(room, room.currentTurn.activePlayerId);
}

export function canStart(room) {
  return room.status === 'waiting' && room.players.length >= PLAYERS.min;
}
