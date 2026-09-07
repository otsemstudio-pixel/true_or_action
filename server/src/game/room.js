import { GameError } from './errors.js';
import { PLAYERS, TIMERS } from './constants.js';
import { SUPPORTED_LANGUES } from '../config/langues.js';
import { SUPPORTED_CATEGORIES, DEFAULT_CATEGORIE } from '../config/categories.js';

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

function validateCategorie(categorie) {
  if (!SUPPORTED_CATEGORIES.includes(categorie)) {
    throw new GameError('INVALID_CATEGORIE', 'La catégorie doit être general ou couple', {
      allowed: SUPPORTED_CATEGORIES,
    });
  }
  return categorie;
}

function validateAnswerSec(answerSec) {
  if (!TIMERS.answerSecOptions.includes(answerSec)) {
    throw new GameError('INVALID_ANSWER_SEC', 'Le temps de réponse doit être 30, 45, 60 ou 90 secondes', {
      allowed: TIMERS.answerSecOptions,
    });
  }
  return answerSec;
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
  jokerPublic: false,
  jokerInverse: false,
  bluffAssume: false,
  bluffSurprise: false,
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
// lui-même si le salon repasse à 2 joueurs. Le double ou rien, lui, n'a pas
// de sens en mode couple (pas de niveau supérieur où piocher) : masqué côté
// interface, désactivé ici en renfort pour qu'un appel direct ne puisse pas
// le contourner.
export function effectiveRegles(room) {
  // En partie, "2 joueurs" veut dire 2 joueurs actifs dans la rotation
  // (turnOrder) : un joueur qui a quitté reste dans `players` (status
  // "left") mais ne doit plus compter pour cette règle.
  const activeCount = room.status === 'playing' ? room.turnOrder.length : room.players.length;
  return {
    ...room.regles,
    doubleOuRien: room.regles.doubleOuRien && room.categorie !== 'couple',
    pariMutuel: room.regles.pariMutuel && activeCount === 2,
    // Variante du joker du public (règle F) : n'a de sens que si le joker
    // lui-même est actif, même bouton, même joker à consommer.
    jokerInverse: room.regles.jokerInverse && room.regles.jokerPublic,
    // Même principe pour la variante automatique du bluff assumé (règle G) :
    // n'a de sens que si le mécanisme de base est lui-même actif.
    bluffSurprise: room.regles.bluffSurprise && room.regles.bluffAssume,
  };
}

export function createRoom({
  code,
  hostId,
  hostPseudo,
  hostIsGuest = false,
  maxTurns = null,
  targetScore = null,
  niveauMax = 1,
  langue = 'fr',
  categorie = DEFAULT_CATEGORIE,
  regles = {},
  maxPlayers = categorie === 'couple' ? PLAYERS.coupleMax : PLAYERS.defaultMax,
  answerSec = TIMERS.answerMs / 1000,
}) {
  const settings = validateSettings(maxTurns, targetScore);

  return {
    code,
    hostId,
    status: 'waiting',
    settings,
    niveauMax: validateNiveauMax(niveauMax),
    categorie: validateCategorie(categorie),
    langue: validateLangue(langue),
    maxPlayers: validateMaxPlayers(maxPlayers),
    answerSec: validateAnswerSec(answerSec),
    players: [{ id: hostId, pseudo: hostPseudo, score: 0, status: 'active', isGuest: Boolean(hostIsGuest) }],
    turnOrder: [],
    currentTurnIndex: -1,
    turnNumber: 0,
    questionPool: EMPTY_QUESTION_POOL,
    currentTurn: null,
    history: [],
    regles: validateRegles(regles),
    // Une fois par partie et par joueur (règles C et F) : ids déjà consommés.
    reglesUsage: { questionRetournee: [], jokerPublic: [] },
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
  if (room.categorie === 'couple') {
    throw new GameError('CATEGORIE_LOCKS_NIVEAU', "Le niveau ne s'applique pas en mode couple");
  }
  return { ...room, niveauMax: validateNiveauMax(niveauMax) };
}

// Temps de réponse (phase "answering" d'un tour normal ou surprise) : le
// minuteur de vote, lui, reste fixe et non réglable (voir constants.js).
export function updateAnswerSec(room, answerSec) {
  if (room.status !== 'waiting') {
    throw new GameError('ROOM_NOT_JOINABLE', 'Impossible de modifier le temps de réponse après le lancement');
  }
  return { ...room, answerSec: validateAnswerSec(answerSec) };
}

export function updateMaxPlayers(room, maxPlayers) {
  if (room.status !== 'waiting') {
    throw new GameError('ROOM_NOT_JOINABLE', 'Impossible de modifier le nombre de joueurs après le lancement');
  }
  if (room.categorie === 'couple') {
    throw new GameError('CATEGORIE_LOCKS_MAX_PLAYERS', 'Le nombre de joueurs est verrouillé à 2 en mode couple');
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

// Basculer de catégorie réinitialise le niveau à sa valeur par défaut et
// ajuste la limite de joueurs à ce qui est pertinent pour la catégorie
// choisie (verrouillée à 2 en couple, valeur par défaut sinon) — jamais
// d'expulsion : si des joueurs en trop sont déjà là, le passage en couple
// est simplement refusé.
export function updateCategorie(room, categorie) {
  if (room.status !== 'waiting') {
    throw new GameError('ROOM_NOT_JOINABLE', 'Impossible de modifier la catégorie après le lancement');
  }
  const validated = validateCategorie(categorie);
  if (validated === room.categorie) return room;

  if (validated === 'couple' && room.players.length > PLAYERS.coupleMax) {
    throw new GameError(
      'CATEGORIE_TOO_MANY_PLAYERS',
      `Impossible de passer en mode couple : ${room.players.length} joueurs sont déjà dans le salon (maximum ${PLAYERS.coupleMax})`,
      { current: room.players.length, max: PLAYERS.coupleMax }
    );
  }

  return {
    ...room,
    categorie: validated,
    maxPlayers: validated === 'couple' ? PLAYERS.coupleMax : PLAYERS.defaultMax,
    niveauMax: 1,
  };
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

export function addPlayer(room, { id, pseudo, isGuest = false }) {
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
    players: [...room.players, { id, pseudo, score: 0, status: 'active', isGuest: Boolean(isGuest) }],
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
    reglesUsage: { questionRetournee: [], jokerPublic: [] },
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
