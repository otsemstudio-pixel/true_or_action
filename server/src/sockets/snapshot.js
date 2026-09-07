import { effectiveRegles } from '../game/room.js';

// Règle G : le bluff assumé et les mises ne doivent jamais fuiter avant la
// révélation dans turn:resolved, y compris via un snapshot de reconnexion
// (room:rejoin) — d'où le second paramètre, absent de toutes les autres
// utilisations de currentTurn dans ce fichier, aucune n'ayant jamais eu
// besoin de varier son contenu selon qui la reçoit jusqu'ici.
export function buildSnapshot(entry, viewerId = null) {
  const { room, chat, timers } = entry;
  const isResolved = room.currentTurn?.phase === 'resolved';
  // Une déclaration manuelle (Phase 3) reste visible du joueur actif qui l'a
  // lui-même posée. Un bluff surprise (Phase 4, tiré par le jeu) reste caché
  // de tout le monde, actif compris, jusqu'à la résolution — "surprise" veut
  // dire surprise pour lui aussi, jamais de connaissance anticipée du tirage.
  const isManualBluffVisible =
    !room.currentTurn?.bluffSurprise &&
    viewerId != null &&
    String(viewerId) === String(room.currentTurn?.activePlayerId);

  let currentTurn = null;
  if (room.currentTurn) {
    if (room.currentTurn.mode === 'surprise') {
      currentTurn = {
        mode: 'surprise',
        turnNumber: room.currentTurn.turnNumber,
        activePlayerIds: room.currentTurn.activePlayerIds,
        type: room.currentTurn.type,
        questionId: room.currentTurn.questionId,
        contenu: entry.questionsById.get(room.currentTurn.questionId) ?? null,
        phase: room.currentTurn.phase,
        answeredPlayerIds: Object.keys(room.currentTurn.answers),
        votes: room.currentTurn.votes,
        answerDeadline: timers.get('answer')?.deadline ?? null,
        voteDeadline: timers.get('vote')?.deadline ?? null,
      };
    } else {
      currentTurn = {
        mode: 'normal',
        turnNumber: room.currentTurn.turnNumber,
        activePlayerId: room.currentTurn.activePlayerId,
        type: room.currentTurn.type,
        questionId: room.currentTurn.questionId,
        contenu: room.currentTurn.questionId != null ? entry.questionsById.get(room.currentTurn.questionId) ?? null : null,
        phase: room.currentTurn.phase,
        answer: room.currentTurn.answer,
        votes: room.currentTurn.votes,
        doubleOuRien: room.currentTurn.doubleOuRien,
        returned: room.currentTurn.returned,
        originalPlayerId: room.currentTurn.originalPlayerId,
        pariMutuel: room.currentTurn.pariMutuel,
        jokerConstraint: room.currentTurn.jokerConstraint ?? null,
        jokerInverse: Boolean(room.currentTurn.jokerInverse),
        // Visible du joueur actif lui-même pour une déclaration manuelle
        // (état de son propre bouton), et de tout le monde une fois résolu ;
        // jamais avant sinon — bluffSurprise (règle G, variante) n'est lui
        // jamais exposé, même au joueur actif (voir isManualBluffVisible).
        bluffDeclared: isResolved || isManualBluffVisible ? Boolean(room.currentTurn.bluffDeclared) : false,
        // Jamais montré avant la résolution, quel que soit le joueur qui
        // regarde — y compris le miseur pour les mises des autres.
        bluffMises: isResolved ? room.currentTurn.bluffMises : {},
        choices:
          room.currentTurn.choices?.map((c) => ({
            questionId: c.questionId,
            type: c.type,
            contenu: entry.questionsById.get(c.questionId) ?? null,
          })) ?? null,
        answerDeadline: timers.get('answer')?.deadline ?? null,
        voteDeadline: timers.get('vote')?.deadline ?? null,
        niveauChoiceDeadline: timers.get('niveau_choice')?.deadline ?? null,
        questionChoiceDeadline: timers.get('question_choice')?.deadline ?? null,
        jugementDeadline: timers.get('jugement')?.deadline ?? null,
      };
    }
  }

  return {
    code: room.code,
    status: room.status,
    hostId: room.hostId,
    settings: room.settings,
    niveauMax: room.niveauMax,
    maxPlayers: room.maxPlayers,
    answerSec: room.answerSec,
    categorie: room.categorie,
    langue: room.langue,
    // Vue effective (pari mutuel selon le nombre de joueurs, double ou rien
    // masqué en mode couple) : jamais la valeur brute stockée, pour que
    // l'affichage (salon d'attente, partie) ne montre jamais une règle
    // "active" qui ne l'est plus réellement dans le contexte courant.
    regles: effectiveRegles(room),
    partieId: entry.dbPartieId ?? null,
    players: room.players,
    turnNumber: room.turnNumber,
    currentTurn,
    messages: chat.messages.slice(-30),
  };
}
