import { GameError } from './errors.js';
import {
  POINTS,
  VOTE_BONUS,
  VOTE_BONUS_MAX,
  VOTE_QUORUM_RATIO,
  TIMERS,
  PLAYERS,
  REGLES,
  REGLES_TIMERS,
  JOKER_CONTRAINTES,
  BLUFF_MISE_MONTANTS,
} from './constants.js';
import { canStart, getPlayer, excludePlayer, effectiveRegles } from './room.js';
import {
  JOKER_IDS,
  fideleBonusDueForNextTurn,
  metronomeStreakBefore,
  hasUsedIncrevable,
  applyVeteranBonus,
  rituelStreakBefore,
  hasUsedMasque,
  limierBonusDueForNextOpportunity,
  sceptiquePerpetuelVoteCount,
} from './jokers.js';

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
  if (effectiveRegles(room).carteJoker && room.players.some((p) => p.carteJoker == null)) {
    throw new GameError('CARTE_JOKER_MANQUANTE', 'Chaque joueur doit choisir une carte joker avant de lancer la partie');
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
  const votesCast = eligibleVoters.filter((p) => Boolean(room2.currentTurn.votes[p.id])).length;

  if (quorumReached(votesCast, eligibleVoters.length)) {
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

// ---------- Règle G : le bluff assumé (avec mise collective) ----------

// Déclaration cachée : le joueur actif confirme en secret qu'il a menti.
// Ni broadcast ni changement visible du vote "up"/"down" en cours — il reste
// exactement le même vote de qualité aux yeux des votants (voir buildSnapshot
// pour la vue filtrée par joueur). resolveTurn seul sait réinterpréter les
// votes déjà là une fois ce champ posé, qu'ils aient été soumis avant ou
// après cette déclaration : l'ordre des deux actions n'a aucune importance.
export function declareBluff(room, { playerId }) {
  assertNormalTurn(room);
  assertTurnPhase(room, 'voting');
  const regles = effectiveRegles(room);
  if (!regles.bluffAssume) {
    throw new GameError('REGLE_DISABLED', "Le bluff assumé n'est pas activé dans ce salon");
  }
  if (room.currentTurn.activePlayerId !== playerId) {
    throw new GameError('NOT_YOUR_TURN', "Ce n'est pas votre tour");
  }
  // "Déjà déclaré" couvre aussi bien une déclaration manuelle antérieure
  // qu'un tour bluff surprise (règle G, variante) : dans les deux cas, le
  // joueur actif n'a plus la main sur ce tour, qu'il ait "gagné" ou non le
  // tirage automatique.
  if (room.currentTurn.bluffDeclared || room.currentTurn.bluffSurprise) {
    throw new GameError('BLUFF_DEJA_DECLARE', 'Le bluff a déjà été déclaré pour ce tour');
  }

  const turnNumber = room.currentTurn.turnNumber;
  const room2 = {
    ...room,
    currentTurn: { ...room.currentTurn, bluffDeclared: true },
  };

  return { room: room2, effects: [{ type: 'BLUFF_DECLARED', turnNumber }] };
}

// Mise secrète : un votant (jamais le joueur actif) risque 1 ou 2 points sur
// "vrai" (il pense que le joueur actif a été sincère, donc n'a pas menti) ou
// "faux" (il pense qu'il a menti). Ne paie que si un bluff a effectivement
// été déclaré sur ce tour — sinon la mise n'a tout simplement aucun objet à
// juger et reste sans effet (voir resolveTurn). Comme la déclaration
// ci-dessus, aucun effet diffusé : jamais visible avant la résolution.
export function submitBluffMise(room, { playerId, montant, prediction }) {
  assertNormalTurn(room);
  assertTurnPhase(room, 'voting');
  const regles = effectiveRegles(room);
  if (!regles.bluffAssume) {
    throw new GameError('REGLE_DISABLED', "Le bluff assumé n'est pas activé dans ce salon");
  }
  if (playerId === room.currentTurn.activePlayerId) {
    throw new GameError('CANNOT_MISE_SELF', 'Le joueur actif ne peut pas miser sur lui-même');
  }
  if (!getPlayer(room, playerId)) {
    throw new GameError('PLAYER_NOT_FOUND', 'Joueur introuvable dans le salon');
  }
  if (room.currentTurn.bluffMises[playerId]) {
    throw new GameError('ALREADY_MISE', 'Ce joueur a déjà misé pour ce tour');
  }
  if (!BLUFF_MISE_MONTANTS.includes(montant)) {
    throw new GameError('INVALID_MISE', 'Le montant de la mise doit être 1 ou 2');
  }
  if (prediction !== 'vrai' && prediction !== 'faux') {
    throw new GameError('INVALID_MISE', 'Prédiction invalide');
  }

  const turnNumber = room.currentTurn.turnNumber;
  const room2 = {
    ...room,
    currentTurn: {
      ...room.currentTurn,
      bluffMises: { ...room.currentTurn.bluffMises, [playerId]: { montant, prediction } },
    },
  };

  return {
    room: room2,
    effects: [{ type: 'BLUFF_MISE_SUBMITTED', turnNumber, voterId: playerId, montant, prediction }],
  };
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
  let points = afterDoubleOuRien ? 0 : REGLES.refusMalus;

  // Jokers, catégorie Régularité (voir jokers.js) : un joueur ne porte
  // jamais qu'un seul joker à la fois, les deux branches ci-dessous ne
  // s'appliquent donc jamais simultanément au même joueur.
  const activePlayer = getPlayer(room, playerId);
  let increvableUsed = false;
  if (activePlayer?.carteJoker === JOKER_IDS.LINCREVABLE && points < 0 && !hasUsedIncrevable(room.history, playerId)) {
    points = 0;
    increvableUsed = true;
  }
  if (activePlayer?.carteJoker === JOKER_IDS.LE_FIDELE && fideleBonusDueForNextTurn(room.history, playerId)) {
    points += 1;
  }

  const room2 = {
    ...room,
    players: applyVeteranBonus(
      room.players.map((p) => (p.id === playerId ? { ...p, score: p.score + points } : p)),
      room.history.length + 1
    ),
    currentTurn: { ...room.currentTurn, phase: 'resolved', answer: null },
    history: [
      ...room.history,
      {
        turnNumber,
        playerId,
        type: room.currentTurn.type,
        questionId: room.currentTurn.questionId,
        answer: null,
        votes: {},
        points,
        mode: 'normal',
        refused: true,
        increvableUsed,
      },
    ],
    forceQuestionChoice: !afterDoubleOuRien,
  };

  const effects = [
    { type: 'CLEAR_TIMER', name: 'answer', turnNumber },
    { type: 'PASS_SUBMITTED', turnNumber, playerId, points },
  ];

  const endReason = checkGameEnd(room2);
  if (endReason) {
    const finished = applySceptiquePerpetuelBonuses({ ...room2, status: 'finished', currentTurn: null });
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

// ---------- Règle F : le joker du public (+ variante "joker inversé") ----------

// Un seul joker par joueur et par partie, avec un choix d'effet au moment de
// l'activation — pas deux compteurs séparés : "l'inversé" n'est qu'une
// seconde façon de dépenser le même joker que la contrainte de style.
// Le tour précédent, au sens de cet effet, est toujours room.history[-1] :
// même motif que findBestPreviousVoter (règle C) juste au-dessus, y compris
// l'exclusion des tours surprise (mode différent, pas de "la" question d'un
// seul répondant à réutiliser de la même façon).
function findPreviousNormalTurn(room) {
  const last = room.history[room.history.length - 1];
  if (!last || last.mode !== 'normal' || last.questionId == null) return null;
  return { questionId: last.questionId, type: last.type };
}

// N'importe quel joueur (y compris le joueur actif lui-même, le prompt ne
// l'exclut pas) peut, une fois par partie, activer ce joker tant que la
// question est révélée et qu'il n'y a pas encore répondu — il n'existe pas de
// sous-phase dédiée "question révélée mais réponse pas commencée" dans ce
// jeu, la fenêtre d'activation est donc toute la phase "answering".
export function activateJokerPublic(room, { playerId, effect = 'style', rng = defaultRng }) {
  assertNormalTurn(room);
  assertTurnPhase(room, 'answering');
  const regles = effectiveRegles(room);

  if (effect === 'style') {
    if (!regles.jokerPublic) {
      throw new GameError('REGLE_DISABLED', "Le joker du public n'est pas activé dans ce salon");
    }
  } else if (effect === 'questionPrecedente') {
    if (!regles.jokerInverse) {
      throw new GameError('REGLE_DISABLED', "Le joker inversé n'est pas activé dans ce salon");
    }
  } else {
    throw new GameError('INVALID_JOKER_EFFECT', 'Effet de joker invalide');
  }

  const turnNumber = room.currentTurn.turnNumber;

  // Un autre joueur a activé le joker sur ce même tour (n'importe quel effet)
  // entre l'affichage du bouton côté client et la réception de cette action
  // (course classique à deux clics quasi simultanés) : ignoré sans erreur,
  // sans consommer le joker de celui qui arrive en second — rien ne lui a été
  // refusé, un effet est déjà en place pour ce tour.
  if (room.currentTurn.jokerActivated) {
    return { room, effects: [] };
  }

  if (room.reglesUsage.jokerPublic.includes(playerId)) {
    throw new GameError('JOKER_DEJA_UTILISE', 'Vous avez déjà utilisé votre joker cette partie');
  }

  const reglesUsage = {
    ...room.reglesUsage,
    jokerPublic: [...room.reglesUsage.jokerPublic, playerId],
  };

  if (effect === 'questionPrecedente') {
    const previous = findPreviousNormalTurn(room);
    if (!previous) {
      throw new GameError('JOKER_INVERSE_INDISPONIBLE', 'Aucun tour précédent à réutiliser');
    }

    // La question déjà tirée pour ce tour n'a jamais été montrée à personne :
    // elle retourne dans la réserve plutôt que d'être perdue (même logique
    // que les propositions écartées du choix parmi 3, règle A).
    const discardedType = room.currentTurn.type;
    const discardedId = room.currentTurn.questionId;
    const questionPool = {
      ...room.questionPool,
      [discardedType]: {
        ...room.questionPool[discardedType],
        top: [...room.questionPool[discardedType].top, discardedId],
      },
    };

    const room2 = {
      ...room,
      questionPool,
      currentTurn: {
        ...room.currentTurn,
        questionId: previous.questionId,
        type: previous.type,
        jokerActivated: true,
        jokerInverse: true,
      },
      reglesUsage,
    };

    return {
      room: room2,
      effects: [
        {
          type: 'JOKER_ACTIVATED',
          turnNumber,
          activatedBy: playerId,
          mode: 'questionPrecedente',
          questionId: previous.questionId,
          questionType: previous.type,
        },
      ],
    };
  }

  const index = Math.floor(rng() * JOKER_CONTRAINTES.length);
  const contrainte = JOKER_CONTRAINTES[index];

  const room2 = {
    ...room,
    currentTurn: { ...room.currentTurn, jokerConstraint: contrainte, jokerActivated: true },
    reglesUsage,
  };

  return {
    room: room2,
    effects: [{ type: 'JOKER_ACTIVATED', turnNumber, activatedBy: playerId, mode: 'style', contrainte }],
  };
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
  const answerOrder = [...room.currentTurn.answerOrder, playerId];
  const room2 = { ...room, currentTurn: { ...room.currentTurn, answers, answerOrder } };
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
  const votesCast = eligibleVoters.filter((id) => Boolean(votes[id])).length;
  if (quorumReached(votesCast, eligibleVoters.length)) {
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

  // Le rituel (voir jokers.js) : premier nom de answerOrder, jamais un
  // horodatage — seul contexte où "premier à répondre" a un sens réel
  // (un tour normal n'a qu'un seul répondant, toujours "premier" par
  // construction).
  const firstResponderId = turn.answerOrder[0] ?? null;

  const results = turn.activePlayerIds.map((id) => {
    const answered = turn.answers[id] != null;
    const isWinner = winnerIds.includes(id);
    let points = isWinner ? REGLES.tourSurprisePointsGagnant : answered ? REGLES.tourSurprisePointsParticipant : 0;

    const player = getPlayer(room, id);
    if (
      player?.carteJoker === JOKER_IDS.LE_RITUEL &&
      id === firstResponderId &&
      rituelStreakBefore(room.history, id) + 1 === 3
    ) {
      points += 1;
    }

    return { playerId: id, answer: turn.answers[id] ?? null, votesRecus: votesRecus[id] ?? 0, points };
  });

  const players = applyVeteranBonus(
    room.players.map((p) => {
      const result = results.find((r) => r.playerId === p.id);
      return result ? { ...p, score: p.score + result.points } : p;
    }),
    room.history.length + 1
  );

  const room2 = {
    ...room,
    players,
    currentTurn: { ...turn, phase: 'resolved' },
    history: [
      ...room.history,
      { turnNumber, mode: 'surprise', questionId: turn.questionId, type: turn.type, results, votes: {}, firstResponderId },
    ],
  };

  const effects = [{ type: 'SURPRISE_RESOLVED', turnNumber, results, winnerIds }];

  const endReason = checkGameEnd(room2);
  if (endReason) {
    const finished = applySceptiquePerpetuelBonuses({ ...room2, status: 'finished', currentTurn: null });
    return { room: finished, effects: [...effects, { type: 'GAME_ENDED', reason: endReason, ranking: buildRanking(finished) }] };
  }

  const next = advanceTurn(room2, rng);
  return { room: next.room, effects: [...effects, ...next.effects] };
}

// ---------- Aiguillage phase / mode ----------

// Un tour se résout dès que 60% des votants éligibles se sont exprimés,
// plutôt que d'attendre systématiquement le dernier — sinon un salon à 20
// joueurs resterait bloqué en attente d'un traînard (le minuteur de vote
// tranche de toute façon si même ce seuil n'est jamais atteint). Avec 0
// votant éligible, le seuil (0) est trivialement atteint : rien à attendre.
function quorumReached(votesCast, eligibleCount) {
  return votesCast >= Math.ceil(eligibleCount * VOTE_QUORUM_RATIO);
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

  // Règle G, variante "bluff surprise" : même déclencheur probabiliste que le
  // tour surprise ci-dessus (même constante REGLES.tourSurpriseChance),
  // jamais réutilisé pour tirer deux fois — ce second tirage n'est atteint
  // que si le premier n'a pas déjà rendu la main, donc jamais les deux effets
  // sur le même tour. Saute la pré-phase de double ou rien exactement comme
  // le tour surprise classique le fait déjà juste au-dessus, pour rester
  // cohérent avec ce précédent plutôt que d'inventer un nouveau cas.
  if (regles.bluffSurprise && !regles.pariMutuel) {
    if (rng() < REGLES.tourSurpriseChance) {
      return startAnsweringTurn(baseRoom, activePlayerId, rng, { bluffSurprise: true });
    }
  }

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
function startAnsweringTurn(
  room,
  activePlayerId,
  rng,
  { doubleOuRien = false, forcedType = null, forcedQuestionId = null, bluffSurprise = false }
) {
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

  // Règle G, variante "bluff surprise" : le jeu décide à la place du joueur,
  // par tirage — 50/50 entre "il a réellement menti" et "il reste sincère,
  // mais le tour se déroule quand même comme un bluff à deviner" (le prompt
  // dit "vrai ou simulé selon un tirage" sans préciser de probabilité :
  // 50/50 est le choix le plus neutre). Toujours false hors bluff surprise.
  const bluffDeclared = bluffSurprise ? rng() < 0.5 : false;

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
      // Règle F : au plus une activation du joker du public par tour, quel
      // que soit l'effet choisi — jokerActivated est le seul état qui doit
      // être vérifié pour ça (jokerConstraint reste null pour l'effet
      // "question précédente", qui ne le renseigne jamais).
      jokerActivated: false,
      // Effet "contrainte de style" : contrainte tirée au sort, ou null tant
      // que personne n'a activé le joker (ou si l'effet choisi était l'autre).
      jokerConstraint: null,
      // Effet "question précédente" (règle F, variante) : vrai si la question
      // de CE tour a été remplacée par celle du tour précédent.
      jokerInverse: false,
      // Règle G : le bluff assumé — vérité cachée du jeu (déclarée par le
      // joueur actif, ou tirée automatiquement en bluff surprise), jamais
      // visible des autres avant la résolution. Le vote "up"/"down" habituel
      // n'est jamais remplacé ni relabellé : il continue de fonctionner à
      // l'identique pour ne rien laisser filtrer côté client tant que ce
      // champ n'est pas encore révélé.
      bluffDeclared,
      // Marque ce tour comme décidé par le jeu (bluff surprise) plutôt que
      // par le joueur — empêche declareBluff de s'y superposer, qu'il ait
      // "gagné" ou non le tirage ci-dessus (voir sa garde). Jamais exposé
      // côté client, même au joueur actif : "surprise" veut dire surprise
      // pour lui aussi, exactement comme le tour surprise classique ne
      // prévient personne à l'avance.
      bluffSurprise,
      // Mises secrètes des votants, jamais montrées avant la résolution
      // (voir snapshot.js) : { [voterId]: { montant, prediction } }.
      bluffMises: {},
    },
  };

  return {
    room: room2,
    effects: [
      {
        type: 'TURN_STARTED',
        turnNumber,
        activePlayerId,
        questionType: type,
        questionId,
        doubleOuRien,
        // Jamais transmis au broadcast (voir handlers.js, la liste de champs
        // y est explicite) : seule la persistance (voir persistence.js) doit
        // connaître ces deux valeurs pour qu'une reconnexion ne perde ni le
        // marqueur "décidé par le jeu" ni le résultat du tirage.
        bluffDeclared,
        bluffSurprise,
      },
      { type: 'START_TIMER', name: 'answer', turnNumber, durationMs: room.answerSec * 1000 },
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
      // Ordre d'arrivée des réponses (Le rituel, voir jokers.js) : un simple
      // tableau plutôt qu'un horodatage — turn.js n'accède jamais à l'heure
      // réelle, l'ordre d'appel des fonctions pures suffit et reste
      // déterministe pour les tests.
      answerOrder: [],
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
      { type: 'START_TIMER', name: 'answer', turnNumber, durationMs: room.answerSec * 1000 },
    ],
  };
}

function resolveTurn(room, rng, { pariMutuelVerdict = null } = {}) {
  const turn = room.currentTurn;
  const regles = effectiveRegles(room);
  const bluffActive = turn.bluffDeclared;

  // Règle G : une fois un bluff déclaré, "up"/"down" ne notent plus la
  // qualité de la réponse mais la sincérité perçue — le bonus de qualité
  // habituel n'a alors plus de sens et cède la place au mécanisme de bluff
  // (voir bluffResult ci-dessous).
  const thumbsUp = Object.values(turn.votes).filter((v) => v === 'up').length;
  const voteBonus = bluffActive ? 0 : Math.min(thumbsUp * VOTE_BONUS, VOTE_BONUS_MAX);
  let points = turn.answer === null ? 0 : POINTS[turn.type] + voteBonus;
  if (turn.doubleOuRien) {
    points = turn.answer === null ? 0 : points * REGLES.doubleOuRienMultiplicateur;
  }

  // Règle G (suite) : calculé dès que la règle est active dans le salon,
  // même si ce tour précis n'a vu ni déclaration ni mise — les votants ayant
  // misé "à l'aveugle" (ils ne savent jamais à l'avance si ce tour est le
  // bon) méritent une réponse explicite plutôt qu'un silence qui pourrait
  // laisser croire à un bug.
  // Jokers, catégorie Bluff et jugement (voir jokers.js et le préalable du
  // prompt) : Le limier se déclenche pour d'AUTRES joueurs que l'actif, sur
  // l'historique d'AVANT ce tour — calculé ici, avant que ce tour n'y soit
  // ajouté, jamais à partir d'un vote réellement soumis ce tour-ci.
  const limierBonuses = {};
  if (regles.bluffAssume && bluffActive) {
    for (const p of room.players) {
      if (p.id === turn.activePlayerId || p.carteJoker !== JOKER_IDS.LE_LIMIER) continue;
      if (limierBonusDueForNextOpportunity(room.history, p.id)) {
        limierBonuses[p.id] = (limierBonuses[p.id] ?? 0) + REGLES.bluffVoteCorrectPoints;
      }
    }
  }

  let bluffResult = null;
  if (regles.bluffAssume) {
    const voteEntries = Object.entries(turn.votes);
    const miseEntries = Object.entries(turn.bluffMises);

    if (bluffActive) {
      const totalVotes = voteEntries.length;
      const fooledCount = voteEntries.filter(([, v]) => v === 'up').length;
      const majorityFooled = totalVotes > 0 && fooledCount > totalVotes / 2;
      if (majorityFooled && turn.answer !== null) {
        points *= REGLES.bluffLiarMultiplicateur;
        // Le masque (voir jokers.js) : une fois par partie, redouble encore
        // ce gain déjà doublé ci-dessus — x4 au total par rapport à un tour
        // normal, jamais différé, jamais reproduit une seconde fois.
        const activePlayerForMasque = getPlayer(room, turn.activePlayerId);
        if (
          activePlayerForMasque?.carteJoker === JOKER_IDS.LE_MASQUE &&
          !hasUsedMasque(room.history, turn.activePlayerId)
        ) {
          points *= REGLES.bluffLiarMultiplicateur;
        }
      }
      bluffResult = {
        declared: true,
        surprise: Boolean(turn.bluffSurprise),
        fooled: majorityFooled,
        // "down" = "je ne le crois pas sincère" = devine juste, il a bien
        // menti par construction de declareBluff.
        voterResults: voteEntries.map(([voterId, vote]) => {
          const guessedRight = vote === 'down';
          // Le semeur de doute (voir jokers.js) : +1 en plus du gain normal
          // d'un vote juste, pour ce votant seulement s'il porte ce joker.
          const semeurBonus =
            guessedRight && getPlayer(room, voterId)?.carteJoker === JOKER_IDS.LE_SEMEUR_DE_DOUTE ? 1 : 0;
          return { voterId, guessedRight, points: (guessedRight ? REGLES.bluffVoteCorrectPoints : 0) + semeurBonus };
        }),
        // "faux" = le miseur pense qu'il a menti = devine juste.
        miseResults: miseEntries.map(([voterId, mise]) => {
          const guessedRight = mise.prediction === 'faux';
          // Le parieur (voir jokers.js) : double le gain ET la perte pour ce
          // miseur seulement, jamais sur ses propres bluffs — impossible de
          // toute façon, submitBluffMise interdit de miser sur soi-même.
          const multiplicateur = getPlayer(room, voterId)?.carteJoker === JOKER_IDS.LE_PARIEUR ? 2 : 1;
          const delta = (guessedRight ? mise.montant : -mise.montant) * multiplicateur;
          return { voterId, montant: mise.montant, prediction: mise.prediction, guessedRight, delta };
        }),
      };
    } else {
      // Règle active mais pas invoquée sur ce tour : rien à juger. Les mises
      // déjà placées (le votant ne pouvait pas deviner à l'avance) sont
      // annulées sans gain ni perte plutôt qu'ignorées silencieusement.
      bluffResult = {
        declared: false,
        surprise: Boolean(turn.bluffSurprise),
        fooled: false,
        voterResults: [],
        miseResults: miseEntries.map(([voterId, mise]) => ({
          voterId,
          montant: mise.montant,
          prediction: mise.prediction,
          guessedRight: false,
          delta: 0,
        })),
      };
    }
  }

  // Jokers, catégorie Régularité (voir jokers.js) : évalués sur `points`
  // déjà final (après bonus de votes, double ou rien et multiplicateur de
  // bluff), avant qu'il ne soit appliqué au score — le bonus fait donc
  // partie intégrante du gain du tour, comme demandé ("en plus de ses gains
  // normaux"). Un joueur ne porte jamais qu'un seul joker : les deux
  // branches ci-dessous ne s'appliquent jamais en même temps.
  const activeJokerPlayer = getPlayer(room, turn.activePlayerId);
  if (activeJokerPlayer?.carteJoker === JOKER_IDS.LE_FIDELE && fideleBonusDueForNextTurn(room.history, turn.activePlayerId)) {
    points += 1;
  }
  if (
    activeJokerPlayer?.carteJoker === JOKER_IDS.LE_METRONOME &&
    metronomeStreakBefore(room.history, turn.activePlayerId) + 1 === 5
  ) {
    points += 2;
  }

  let players = room.players.map((p) =>
    p.id === turn.activePlayerId ? { ...p, score: p.score + points } : p
  );

  if (bluffResult) {
    const deltasByPlayer = { ...limierBonuses };
    for (const r of bluffResult.voterResults) {
      deltasByPlayer[r.voterId] = (deltasByPlayer[r.voterId] ?? 0) + r.points;
    }
    for (const r of bluffResult.miseResults) {
      deltasByPlayer[r.voterId] = (deltasByPlayer[r.voterId] ?? 0) + r.delta;
    }
    players = players.map((p) => (deltasByPlayer[p.id] ? { ...p, score: p.score + deltasByPlayer[p.id] } : p));
  }

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
    jokerConstraint: turn.jokerConstraint ?? null,
    jokerInverse: Boolean(turn.jokerInverse),
    bluffAssume: bluffResult,
  };

  players = applyVeteranBonus(players, room.history.length + 1);

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
      bluffAssume: bluffResult,
    },
  ];

  const endReason = checkGameEnd(room2);
  if (endReason) {
    room2 = applySceptiquePerpetuelBonuses({ ...room2, status: 'finished', currentTurn: null });
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

// Le sceptique perpétuel : seul joker réglé une fois pour toutes en fin de
// partie plutôt que tour par tour — appliqué juste avant buildRanking, aux
// 4 points où GAME_ENDED est émis (maxTurns, targetScore, refus forcé,
// notEnoughPlayers), pour qu'aucune sortie de partie ne l'oublie.
function applySceptiquePerpetuelBonuses(room) {
  const players = room.players.map((p) => {
    if (p.carteJoker !== JOKER_IDS.LE_SCEPTIQUE_PERPETUEL) return p;
    const count = sceptiquePerpetuelVoteCount(room.history, p.id);
    if (count === null || count < REGLES.sceptiquePerpetuelVotesMinimum) return p;
    return { ...p, score: p.score + count * REGLES.sceptiquePerpetuelPointsParVote };
  });
  return { ...room, players };
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
    const finished = applySceptiquePerpetuelBonuses({ ...updatedRoom, status: 'finished', currentTurn: null });
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
