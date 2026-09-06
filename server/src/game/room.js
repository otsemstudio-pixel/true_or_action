import { GameError } from './errors.js';
import { PLAYERS } from './constants.js';
import { SUPPORTED_LANGUES } from '../config/langues.js';

const NIVEAUX = [1, 2, 3];
const EMPTY_QUESTION_POOL = {
  verite: { top: [], lower: [] },
  action: { top: [], lower: [] },
};

function validateSettings(maxTurns, targetScore) {
  if (maxTurns === null && targetScore === null) {
    throw new GameError('INVALID_SETTINGS', 'Il faut définir un nombre de tours ou un score cible');
  }
  if (maxTurns !== null && (!Number.isInteger(maxTurns) || maxTurns < 1)) {
    throw new GameError('INVALID_SETTINGS', 'maxTurns doit être un entier positif');
  }
  if (targetScore !== null && (!Number.isInteger(targetScore) || targetScore < 1)) {
    throw new GameError('INVALID_SETTINGS', 'targetScore doit être un entier positif');
  }
  return { maxTurns, targetScore };
}

function validateMaxPlayers(maxPlayers) {
  if (!Number.isInteger(maxPlayers) || maxPlayers < PLAYERS.min || maxPlayers > PLAYERS.max) {
    throw new GameError(
      'INVALID_MAX_PLAYERS',
      `Le nombre maximum de joueurs doit être entre ${PLAYERS.min} et ${PLAYERS.max}`,
      { min: PLAYERS.min, max: PLAYERS.max }
    );
  }
  return maxPlayers;
}

function validateNiveauMax(niveauMax) {
  if (!NIVEAUX.includes(niveauMax)) {
    throw new GameError('INVALID_NIVEAU', 'Le niveau doit être 1, 2 ou 3');
  }
  return niveauMax;
}

function validateLangue(langue) {
  if (!SUPPORTED_LANGUES.includes(langue)) {
    throw new GameError('INVALID_LANGUE', 'La langue doit être fr ou en', { allowed: SUPPORTED_LANGUES });
  }
  return langue;
}

// Règles optionnelles (point 3) : cinq interrupteurs indépendants, tous
// désactivés par défaut. `validateRegles` fait une fusion partielle sur les
// valeurs déjà en place plutôt que d'exiger les cinq clés à chaque appel.
export const DEFAULT_REGLES = {
  refusCouteux: false,
  doubleOuRien: false,
  questionRetournee: false,
  tourSurprise: false,
  pariMutuel: false,
};

function validateRegles(regles, current = DEFAULT_REGLES) {
  const merged = { ...current, ...regles };
  for (const key of Object.keys(merged)) {
    if (!(key in DEFAULT_REGLES)) {
      throw new GameError('INVALID_REGLE', `Règle inconnue : ${key}`);
    }
    if (typeof merged[key] !== 'boolean') {
      throw new GameError('INVALID_REGLE', `La règle ${key} doit être un booléen`);
    }
  }
  return merged;
}

// Le pari mutuel n'a de sens qu'à exactement 2 joueurs (il remplace le vote,
// déjà absent à ce nombre précis) : si l'hôte l'a activé puis qu'un 3e joueur
// a rejoint, on le traite comme inactif sans avoir besoin de le désactiver
// explicitement en base ni de prévenir l'hôte — il redevient actif de
// lui-même si le salon repasse à 2 joueurs.
export function effectiveRegles(room) {
  // En partie, "2 joueurs" veut dire 2 joueurs actifs dans la rotation
  // (turnOrder) : un joueur qui a quitté reste dans `players` (status
  // "left") mais ne doit plus compter pour cette règle.
  const activeCount = room.status === 'playing' ? room.turnOrder.length : room.players.length;
  return { ...room.regles, pariMutuel: room.regles.pariMutuel && activeCount === 2 };
}

export function createRoom({
  code,
  hostId,
  hostPseudo,
  maxTurns = null,
  targetScore = null,
  niveauMax = 1,
  langue = 'fr',
  regles = {},
  maxPlayers = PLAYERS.defaultMax,
}) {
  const settings = validateSettings(maxTurns, targetScore);

  return {
    code,
    hostId,
    status: 'waiting',
    settings,
    niveauMax: validateNiveauMax(niveauMax),
    langue: validateLangue(langue),
    maxPlayers: validateMaxPlayers(maxPlayers),
    players: [{ id: hostId, pseudo: hostPseudo, score: 0, status: 'active' }],
    turnOrder: [],
    currentTurnIndex: -1,
    turnNumber: 0,
    questionPool: EMPTY_QUESTION_POOL,
    currentTurn: null,
    history: [],
    regles: validateRegles(regles),
    // Une fois par partie et par joueur (règle C) : ids déjà consommés.
    reglesUsage: { questionRetournee: [] },
    // Posé par un refus (règle A) : le tour suivant démarre en choix parmi 3
    // questions plutôt que par un tirage direct.
    forceQuestionChoice: false,
  };
}

export function updateSettings(room, { maxTurns = null, targetScore = null }) {
  if (room.status !== 'waiting') {
    throw new GameError('ROOM_NOT_JOINABLE', 'Impossible de modifier les réglages après le lancement');
  }
  const settings = validateSettings(maxTurns, targetScore);
  return { ...room, settings };
}

export function updateNiveauMax(room, niveauMax) {
  if (room.status !== 'waiting') {
    throw new GameError('ROOM_NOT_JOINABLE', 'Impossible de modifier le niveau après le lancement');
  }
  return { ...room, niveauMax: validateNiveauMax(niveauMax) };
}

export function updateMaxPlayers(room, maxPlayers) {
  if (room.status !== 'waiting') {
    throw new GameError('ROOM_NOT_JOINABLE', 'Impossible de modifier le nombre de joueurs après le lancement');
  }
  const validated = validateMaxPlayers(maxPlayers);
  if (validated < room.players.length) {
    throw new GameError(
      'MAX_PLAYERS_BELOW_CURRENT',
      `Impossible de descendre sous le nombre de joueurs déjà présents (${room.players.length})`,
      { current: room.players.length }
    );
  }
  return { ...room, maxPlayers: validated };
}

export function updateLangue(room, langue) {
  if (room.status !== 'waiting') {
    throw new GameError('ROOM_NOT_JOINABLE', 'Impossible de modifier la langue après le lancement');
  }
  return { ...room, langue: validateLangue(langue) };
}

export function updateRegles(room, regles) {
  if (room.status !== 'waiting') {
    throw new GameError('ROOM_NOT_JOINABLE', 'Impossible de modifier les règles après le lancement');
  }
  return { ...room, regles: validateRegles(regles, room.regles) };
}

export function addPlayer(room, { id, pseudo }) {
  if (room.status !== 'waiting') {
    throw new GameError('ROOM_NOT_JOINABLE', 'La partie a déjà commencé');
  }
  if (room.players.length >= room.maxPlayers) {
    throw new GameError('ROOM_FULL', 'Le salon est complet');
  }
  if (room.players.some((p) => p.id === id)) {
    throw new GameError('ALREADY_IN_ROOM', 'Ce joueur est déjà dans le salon');
  }

  return {
    ...room,
    players: [...room.players, { id, pseudo, score: 0, status: 'active' }],
  };
}

export function removePlayer(room, playerId) {
  if (room.status === 'playing') {
    throw new GameError('ROOM_NOT_JOINABLE', 'Impossible de quitter une partie en cours');
  }

  const players = room.players.filter((p) => p.id !== playerId);
  if (players.length === room.players.length) return room;

  const hostId = room.hostId === playerId && players.length > 0 ? players[0].id : room.hostId;

  return { ...room, players, hostId };
}

export function restartRoom(room) {
  if (room.status !== 'finished') {
    throw new GameError('ROOM_NOT_FINISHED', "La partie n'est pas terminée");
  }

  return {
    ...room,
    status: 'waiting',
    players: room.players.filter((p) => p.status !== 'left').map((p) => ({ ...p, score: 0 })),
    turnOrder: [],
    currentTurnIndex: -1,
    turnNumber: 0,
    questionPool: EMPTY_QUESTION_POOL,
    currentTurn: null,
    history: [],
    // Les réglages de règles (activées/désactivées) survivent au rejeu, mais
    // leur usage (une fois par partie et par joueur, etc.) repart à zéro.
    reglesUsage: { questionRetournee: [] },
    forceQuestionChoice: false,
  };
}

export function markDisconnected(room, playerId) {
  return updatePlayerStatus(room, playerId, 'disconnected');
}

export function markReconnected(room, playerId) {
  return updatePlayerStatus(room, playerId, 'active');
}

export function excludePlayer(room, playerId) {
  const updated = updatePlayerStatus(room, playerId, 'left');
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
