import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, addPlayer, effectiveRegles } from './room.js';
import {
  startGame,
  submitAnswer,
  answerTimeout,
  submitVote,
  voteTimeout,
  handlePlayerLeft,
  submitPass,
  respondDoubleOuRien,
  niveauChoiceTimeout,
  chooseQuestion,
  questionChoiceTimeout,
  returnQuestion,
  submitBet,
  judgeBet,
  judgeBetTimeout,
  submitSurpriseAnswer,
  surpriseAnswerTimeout,
  submitSurpriseVote,
  surpriseVoteTimeout,
  activateJokerPublic,
  declareBluff,
  submitBluffMise,
} from './turn.js';
import { JOKER_CONTRAINTES, REGLES } from './constants.js';
import { GameError } from './errors.js';

function createSequenceRng(values) {
  let i = 0;
  return () => {
    if (i >= values.length) throw new Error('Séquence rng épuisée');
    return values[i++];
  };
}

// Chaque tirage de question consomme toujours 3 valeurs rng, dans l'ordre :
// type (vérité/action), panier (niveau max / niveaux inférieurs), index dans
// le panier retenu. La valeur de panier est "ignorée" (BUCKET_DONT_CARE)
// quand un seul des deux paniers est non vide : elle est quand même
// consommée pour garder un nombre d'appels rng constant et prévisible.
const BUCKET_DONT_CARE = 0.5;

function pool({
  veriteTop = [],
  veriteLower = [],
  actionTop = [],
  actionLower = [],
  veriteEscalade = [],
  actionEscalade = [],
} = {}) {
  return {
    verite: { top: veriteTop, lower: veriteLower },
    action: { top: actionTop, lower: actionLower },
    escalade: { verite: veriteEscalade, action: actionEscalade },
  };
}

function threePlayerRoom(settings = {}) {
  let room = createRoom({ code: 'ABCD', hostId: 'p1', hostPseudo: 'A', ...settings });
  room = addPlayer(room, { id: 'p2', pseudo: 'B' });
  room = addPlayer(room, { id: 'p3', pseudo: 'C' });
  return room;
}

function twoPlayerRoom(settings = {}) {
  const room = createRoom({ code: 'ABCD', hostId: 'p1', hostPseudo: 'A', ...settings });
  return addPlayer(room, { id: 'p2', pseudo: 'B' });
}

// Pour les scénarios à quorum de vote (point 4) : p1 est toujours l'hôte /
// premier joueur actif, pN les suivants jusqu'à n.
function nPlayerRoom(n, settings = {}) {
  let room = createRoom({ code: 'ABCD', hostId: 'p1', hostPseudo: 'A', maxPlayers: Math.max(n, 8), ...settings });
  for (let i = 2; i <= n; i++) {
    room = addPlayer(room, { id: `p${i}`, pseudo: `J${i}` });
  }
  return room;
}

describe('startGame', () => {
  test('refuse de démarrer sous le minimum de joueurs (1 seul)', () => {
    const room = createRoom({ code: 'ABCD', hostId: 'p1', hostPseudo: 'A', maxTurns: 3 });
    assert.throws(
      () => startGame(room, { questionPool: pool({ veriteTop: ['v1', 'v2', 'v3'], actionTop: ['a1', 'a2', 'a3'] }) }),
      (err) => err.code === 'CANNOT_START'
    );
  });

  test('démarre dès 2 joueurs (minimum abaissé)', () => {
    const room = twoPlayerRoom({ maxTurns: 1 });
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1'], actionTop: ['a1'] }),
      rng: createSequenceRng([0.1, BUCKET_DONT_CARE, 0.0]),
    });
    assert.equal(start.room.status, 'playing');
  });

  test('le minuteur de réponse reflète answerSec du salon, pas une constante fixe', () => {
    const room = twoPlayerRoom({ maxTurns: 1, answerSec: 30 });
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1'], actionTop: ['a1'] }),
      rng: createSequenceRng([0.1, BUCKET_DONT_CARE, 0.0]),
    });
    const timer = start.effects.find((e) => e.type === 'START_TIMER' && e.name === 'answer');
    assert.equal(timer.durationMs, 30_000);
  });

  test('le minuteur de réponse reflète answerSec aussi pour un tour surprise', () => {
    const room = threePlayerRoom({ maxTurns: 1, answerSec: 60, regles: { tourSurprise: true } });
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1', 'v2', 'v3'], actionTop: ['a1', 'a2', 'a3'] }),
      rng: createSequenceRng([0.01, 0.1, BUCKET_DONT_CARE, 0.0]), // 0.01 < 0.2 : déclenche le tour surprise
    });
    assert.equal(start.room.currentTurn.mode, 'surprise');
    const timer = start.effects.find((e) => e.type === 'START_TIMER' && e.name === 'answer');
    assert.equal(timer.durationMs, 60_000);
  });

  test('refuse si les questions sont insuffisantes et indique combien il en manque', () => {
    const room = threePlayerRoom({ maxTurns: 3 });
    assert.throws(
      () => startGame(room, { questionPool: pool({ veriteTop: ['v1'], actionTop: ['a1', 'a2', 'a3'] }) }),
      (err) => err.code === 'NOT_ENOUGH_QUESTIONS' && err.details.missing.verite === 2 && err.details.missing.action === 0
    );
  });

  test('cumule les niveaux top et lower pour la vérification de suffisance', () => {
    const room = threePlayerRoom({ maxTurns: 3 });
    // 1 en niveau max + 2 en niveaux inférieurs = 3, suffisant pour 3 tours.
    assert.doesNotThrow(() =>
      startGame(room, {
        questionPool: pool({ veriteTop: ['v1'], veriteLower: ['v2', 'v3'], actionTop: ['a1', 'a2', 'a3'] }),
        rng: createSequenceRng([0.1, BUCKET_DONT_CARE, 0.0]),
      })
    );
  });
});

describe('tirage pondéré par niveau', () => {
  test('tire dans le niveau maximum ("top") quand le tirage de panier est sous 0.6', () => {
    const room = threePlayerRoom({ maxTurns: 1 });
    const rng = createSequenceRng([0.1, 0.59, 0.0]); // type=vérité, panier=top (0.59<0.6), index=0
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['top-1'], veriteLower: ['lower-1'], actionTop: ['a1'] }),
      rng,
    });
    assert.equal(start.room.currentTurn.questionId, 'top-1');
  });

  test('tire dans les niveaux inférieurs ("lower") quand le tirage de panier est à 0.6 ou plus', () => {
    const room = threePlayerRoom({ maxTurns: 1 });
    const rng = createSequenceRng([0.1, 0.6, 0.0]); // type=vérité, panier=lower (0.6 >= 0.6), index=0
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['top-1'], veriteLower: ['lower-1'], actionTop: ['a1'] }),
      rng,
    });
    assert.equal(start.room.currentTurn.questionId, 'lower-1');
  });

  test('tirage simple sur le panier disponible quand l\'autre est vide', () => {
    const room = threePlayerRoom({ maxTurns: 1 });
    // panier "top" vide pour vérité : même avec un tirage de panier < 0.6, on doit retomber sur "lower".
    const rng = createSequenceRng([0.1, 0.1, 0.0]);
    const start = startGame(room, {
      questionPool: pool({ veriteLower: ['lower-1'], actionTop: ['a1'] }),
      rng,
    });
    assert.equal(start.room.currentTurn.questionId, 'lower-1');
  });
});

describe('cycle complet d\'une partie (maxTurns)', () => {
  test('tirage, réponse, vote unanime avec bonus, puis fin de partie', () => {
    const room = threePlayerRoom({ maxTurns: 2 });
    const rng = createSequenceRng([
      0.1, BUCKET_DONT_CARE, 0.0, // tour 1 : vérité (index 0 -> v1)
      0.9, BUCKET_DONT_CARE, 0.5, // tour 2 : action (liste ['a1','a2'], index 1 -> a2)
    ]);

    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1', 'v2'], actionTop: ['a1', 'a2'] }),
      rng,
    });

    assert.equal(start.room.status, 'playing');
    assert.equal(start.room.currentTurn.activePlayerId, 'p1');
    assert.equal(start.room.currentTurn.type, 'verite');
    assert.equal(start.room.currentTurn.questionId, 'v1');
    assert.deepEqual(
      start.effects.map((e) => e.type),
      ['TURN_STARTED', 'START_TIMER']
    );

    const answered = submitAnswer(start.room, { playerId: 'p1', text: 'Ma réponse' });
    assert.equal(answered.room.currentTurn.phase, 'voting');
    assert.deepEqual(
      answered.effects.map((e) => e.type),
      ['CLEAR_TIMER', 'ANSWER_SUBMITTED', 'START_TIMER']
    );

    const afterFirstVote = submitVote(answered.room, { voterId: 'p2', vote: 'up', turnNumber: 1, rng });
    assert.equal(afterFirstVote.room.status, 'playing');
    assert.equal(afterFirstVote.room.currentTurn.turnNumber, 1);

    const afterSecondVote = submitVote(afterFirstVote.room, { voterId: 'p3', vote: 'up', turnNumber: 1, rng });

    const resolvedEffect = afterSecondVote.effects.find((e) => e.type === 'TURN_RESOLVED');
    assert.equal(resolvedEffect.points, 3); // 1 (vérité) + 2 pouces haut

    const p1AfterTurn1 = afterSecondVote.room.players.find((p) => p.id === 'p1');
    assert.equal(p1AfterTurn1.score, 3);

    // tour 2 démarré automatiquement
    assert.equal(afterSecondVote.room.currentTurn.turnNumber, 2);
    assert.equal(afterSecondVote.room.currentTurn.activePlayerId, 'p2');
    assert.equal(afterSecondVote.room.currentTurn.type, 'action');
    assert.equal(afterSecondVote.room.currentTurn.questionId, 'a2');

    const answered2 = submitAnswer(afterSecondVote.room, { playerId: 'p2', text: 'Action !' });

    // p1 vote contre, p3 ne vote pas -> timeout de vote
    const afterOneVote = submitVote(answered2.room, { voterId: 'p1', vote: 'down', turnNumber: 2 });
    const timedOut = voteTimeout(afterOneVote.room, { turnNumber: 2 });

    const resolved2 = timedOut.effects.find((e) => e.type === 'TURN_RESOLVED');
    assert.equal(resolved2.points, 2); // 2 (action) + 0 pouce haut

    const ended = timedOut.effects.find((e) => e.type === 'GAME_ENDED');
    assert.ok(ended, 'la partie doit se terminer au tour 2 (maxTurns=2)');
    assert.equal(ended.reason, 'maxTurns');
    assert.deepEqual(ended.ranking, [
      { playerId: 'p1', score: 3 },
      { playerId: 'p2', score: 2 },
      { playerId: 'p3', score: 0 },
    ]);
    assert.equal(timedOut.room.status, 'finished');
    assert.equal(timedOut.room.currentTurn, null);
  });
});

describe('timeout de réponse', () => {
  test('0 point si personne ne répond dans les temps', () => {
    const room = threePlayerRoom({ maxTurns: 1 });
    const rng = createSequenceRng([0.1, BUCKET_DONT_CARE, 0.0]);
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1'], actionTop: ['a1'] }),
      rng,
    });

    const timedOut = answerTimeout(start.room, { turnNumber: 1 });
    const resolved = timedOut.effects.find((e) => e.type === 'TURN_RESOLVED');
    assert.equal(resolved.points, 0);

    const player = timedOut.room.players.find((p) => p.id === resolved.playerId);
    assert.equal(player.score, 0);
    assert.equal(timedOut.room.status, 'finished');
  });
});

describe('règles de vote', () => {
  function setupVotingPhase() {
    const room = threePlayerRoom({ maxTurns: 3 });
    const rng = createSequenceRng([0.1, BUCKET_DONT_CARE, 0.0]);
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1', 'v2', 'v3'], actionTop: ['a1', 'a2', 'a3'] }),
      rng,
    });
    const answered = submitAnswer(start.room, { playerId: 'p1', text: 'réponse' });
    return answered.room;
  }

  test('le joueur actif ne peut pas voter pour lui-même', () => {
    const room = setupVotingPhase();
    assert.throws(
      () => submitVote(room, { voterId: 'p1', vote: 'up', turnNumber: 1 }),
      (err) => err.code === 'CANNOT_VOTE_SELF'
    );
  });

  test('un joueur ne peut pas voter deux fois', () => {
    const room = setupVotingPhase();
    const after = submitVote(room, { voterId: 'p2', vote: 'up', turnNumber: 1 });
    assert.throws(
      () => submitVote(after.room, { voterId: 'p2', vote: 'down', turnNumber: 1 }),
      (err) => err.code === 'ALREADY_VOTED'
    );
  });

  test('refuse un tour périmé', () => {
    const room = setupVotingPhase();
    assert.throws(
      () => submitVote(room, { voterId: 'p2', vote: 'up', turnNumber: 999 }),
      (err) => err.code === 'STALE_TURN'
    );
  });

  // Point 4 : dans un grand salon, le tour se résout dès 60% des votants
  // éligibles plutôt que d'attendre le dernier — indispensable pour ne pas
  // bloquer indéfiniment un tour à 19 votants potentiels.
  test('un salon de 6 joueurs (5 votants éligibles) résout le tour dès 3 votes (quorum 60%), sans attendre les 2 derniers', () => {
    const room = nPlayerRoom(6, { maxTurns: 1 });
    const rng = createSequenceRng([0.1, BUCKET_DONT_CARE, 0.0]);
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1'], actionTop: ['a1'] }),
      rng,
    });
    const answered = submitAnswer(start.room, { playerId: 'p1', text: 'réponse' });

    const v1 = submitVote(answered.room, { voterId: 'p2', vote: 'up', turnNumber: 1 });
    assert.equal(v1.room.currentTurn.phase, 'voting');
    const v2 = submitVote(v1.room, { voterId: 'p3', vote: 'up', turnNumber: 1 });
    assert.equal(v2.room.currentTurn.phase, 'voting');
    const v3 = submitVote(v2.room, { voterId: 'p4', vote: 'up', turnNumber: 1 });

    const resolved = v3.effects.find((e) => e.type === 'TURN_RESOLVED');
    assert.ok(resolved, 'le tour doit se résoudre au 3e vote (quorum ceil(5*0.6)=3), p5 et p6 ne votent jamais');
    assert.equal(resolved.points, 4); // 1 (vérité) + 3 pouces haut
  });

  // Point 4 : le bonus de vote reste +1/pouce mais plafonne à +5 par tour,
  // même dans un très grand salon où beaucoup de pouces haut sont possibles.
  test('le bonus de vote plafonne à +5 même avec plus de votants favorables', () => {
    const room = nPlayerRoom(10, { maxTurns: 1 });
    const rng = createSequenceRng([0.1, BUCKET_DONT_CARE, 0.0]);
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1'], actionTop: ['a1'] }),
      rng,
    });
    const answered = submitAnswer(start.room, { playerId: 'p1', text: 'réponse' });

    // 9 votants éligibles -> quorum = ceil(9*0.6) = 6 : le tour se résout au
    // 6e pouce haut, avant que les 3 derniers n'aient pu voter.
    let currentRoom = answered.room;
    let last;
    for (const voterId of ['p2', 'p3', 'p4', 'p5', 'p6', 'p7']) {
      last = submitVote(currentRoom, { voterId, vote: 'up', turnNumber: 1 });
      currentRoom = last.room;
    }
    const resolved = last.effects.find((e) => e.type === 'TURN_RESOLVED');
    assert.ok(resolved, 'le tour doit se résoudre au 6e vote (quorum ceil(9*0.6)=6)');
    assert.equal(resolved.points, 6); // 1 (vérité) + 5 (bonus plafonné, 6 pouces haut réels)
  });
});

describe('règles de réponse', () => {
  test('seul le joueur actif peut répondre', () => {
    const room = threePlayerRoom({ maxTurns: 1 });
    const rng = createSequenceRng([0.1, BUCKET_DONT_CARE, 0.0]);
    const start = startGame(room, { questionPool: pool({ veriteTop: ['v1'], actionTop: ['a1'] }), rng });
    assert.throws(
      () => submitAnswer(start.room, { playerId: 'p2', text: 'triche' }),
      (err) => err.code === 'NOT_YOUR_TURN'
    );
  });

  test('refuse une réponse vide', () => {
    const room = threePlayerRoom({ maxTurns: 1 });
    const rng = createSequenceRng([0.1, BUCKET_DONT_CARE, 0.0]);
    const start = startGame(room, { questionPool: pool({ veriteTop: ['v1'], actionTop: ['a1'] }), rng });
    assert.throws(
      () => submitAnswer(start.room, { playerId: 'p1', text: '   ' }),
      (err) => err.code === 'EMPTY_ANSWER'
    );
  });
});

describe('mode score cible seul (maxTurns null)', () => {
  test('ignore la vérification de questions et termine sur le score', () => {
    const room = threePlayerRoom({ maxTurns: null, targetScore: 2 });
    const rng = createSequenceRng([0.1, BUCKET_DONT_CARE, 0.0]);

    // Une seule question dispo : sans maxTurns, aucune vérification n'est faite dessus.
    const start = startGame(room, { questionPool: pool({ veriteTop: ['v1'] }), rng });
    assert.equal(start.room.currentTurn.type, 'verite');

    const answered = submitAnswer(start.room, { playerId: 'p1', text: 'réponse' });
    const resolved = submitVote(answered.room, { voterId: 'p2', vote: 'up', turnNumber: 1 });
    const resolved2 = submitVote(resolved.room, { voterId: 'p3', vote: 'up', turnNumber: 1, rng });

    // 1 (vérité) + 2 pouces haut = 3 >= score cible 2
    const ended = resolved2.effects.find((e) => e.type === 'GAME_ENDED');
    assert.ok(ended);
    assert.equal(ended.reason, 'targetScore');
  });

  test('refuse un salon sans maxTurns ni targetScore', () => {
    assert.throws(
      () =>
        createRoom({ code: 'ABCD', hostId: 'p1', hostPseudo: 'A', maxTurns: null, targetScore: null }),
      (err) => err.code === 'INVALID_SETTINGS'
    );
  });
});

describe('non-répétition des questions', () => {
  test('une question tirée ne ressort plus dans la même partie', () => {
    const room = threePlayerRoom({ maxTurns: 3 });
    const rng = createSequenceRng([
      0.1, BUCKET_DONT_CARE, 0.0, // tour 1
      0.1, BUCKET_DONT_CARE, 0.0, // tour 2
      0.1, BUCKET_DONT_CARE, 0.0, // tour 3
    ]);
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1', 'v2', 'v3'], actionTop: ['a1', 'a2', 'a3'] }),
      rng,
    });

    const drawnIds = [start.room.currentTurn.questionId];

    let current = start.room;
    for (let turn = 1; turn <= 2; turn++) {
      const answered = submitAnswer(current, { playerId: current.currentTurn.activePlayerId, text: 'réponse' });
      const resolved = voteTimeout(answered.room, { turnNumber: turn, rng });
      current = resolved.room;
      if (current.currentTurn) {
        drawnIds.push(current.currentTurn.questionId);
      }
    }

    assert.equal(new Set(drawnIds).size, drawnIds.length);
  });

  test('le cumul top + lower est pris en compte pour la non-répétition', () => {
    const room = threePlayerRoom({ maxTurns: 2 });
    // Une seule question par panier/type : le deuxième tirage du même type doit
    // forcément retomber sur l'autre panier, jamais répéter le même id.
    const rng = createSequenceRng([
      0.1, 0.1, 0.0, // tour 1 : vérité, panier top (id top-v)
      0.1, 0.9, 0.0, // tour 2 : vérité à nouveau, mais top épuisé -> lower (id lower-v)
    ]);
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['top-v'], veriteLower: ['lower-v'], actionTop: ['a1', 'a2'] }),
      rng,
    });
    assert.equal(start.room.currentTurn.questionId, 'top-v');

    const answered = submitAnswer(start.room, { playerId: 'p1', text: 'réponse' });
    const resolved = voteTimeout(answered.room, { turnNumber: 1, rng });
    assert.equal(resolved.room.currentTurn.questionId, 'lower-v');
  });
});

describe('vote sauté à 2 joueurs', () => {
  test('la réponse résout directement le tour avec les points de base, sans phase de vote', () => {
    const room = twoPlayerRoom({ maxTurns: 2 });
    const rng = createSequenceRng([
      0.1, BUCKET_DONT_CARE, 0.0, // tour 1 : vérité
      0.9, BUCKET_DONT_CARE, 0.0, // tour 2 : action
    ]);
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1', 'v2'], actionTop: ['a1', 'a2'] }),
      rng,
    });
    assert.equal(start.room.currentTurn.type, 'verite');

    const answered = submitAnswer(start.room, { playerId: 'p1', text: 'réponse', rng });

    assert.deepEqual(
      answered.effects.map((e) => e.type),
      ['CLEAR_TIMER', 'ANSWER_SUBMITTED', 'TURN_RESOLVED', 'TURN_STARTED', 'START_TIMER']
    );
    assert.equal(answered.effects.some((e) => e.type === 'START_TIMER' && e.name === 'vote'), false);

    const resolved = answered.effects.find((e) => e.type === 'TURN_RESOLVED');
    assert.equal(resolved.points, 1); // vérité = 1 point fixe, aucun pouce haut possible
    assert.deepEqual(resolved.votes, {});

    // tour 2 démarré directement, toujours en phase "answering"
    assert.equal(answered.room.currentTurn.turnNumber, 2);
    assert.equal(answered.room.currentTurn.phase, 'answering');
    assert.equal(answered.room.currentTurn.activePlayerId, 'p2');
  });

  test('action vaut 2 points fixes à 2 joueurs, puis fin de partie', () => {
    const room = twoPlayerRoom({ maxTurns: 1 });
    const rng = createSequenceRng([0.9, BUCKET_DONT_CARE, 0.0]); // action
    const start = startGame(room, { questionPool: pool({ veriteTop: ['v1'], actionTop: ['a1'] }), rng });

    const answered = submitAnswer(start.room, { playerId: 'p1', text: 'action !' });
    const resolved = answered.effects.find((e) => e.type === 'TURN_RESOLVED');
    assert.equal(resolved.points, 2);

    const ended = answered.effects.find((e) => e.type === 'GAME_ENDED');
    assert.ok(ended, 'maxTurns=1 atteint, la partie doit se terminer');
    assert.equal(answered.room.status, 'finished');
  });

  test('à 3 joueurs, le comportement de vote est inchangé', () => {
    const room = threePlayerRoom({ maxTurns: 1 });
    const rng = createSequenceRng([0.1, BUCKET_DONT_CARE, 0.0]);
    const start = startGame(room, { questionPool: pool({ veriteTop: ['v1'], actionTop: ['a1'] }), rng });
    const answered = submitAnswer(start.room, { playerId: 'p1', text: 'réponse' });

    assert.deepEqual(
      answered.effects.map((e) => e.type),
      ['CLEAR_TIMER', 'ANSWER_SUBMITTED', 'START_TIMER']
    );
    assert.equal(answered.room.currentTurn.phase, 'voting');
  });
});

describe('handlePlayerLeft', () => {
  test('3 -> 2 joueurs en partie : la partie continue sans se terminer', () => {
    const room = threePlayerRoom({ maxTurns: 2 });
    const rng = createSequenceRng([0.1, BUCKET_DONT_CARE, 0.0]);
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1', 'v2'], actionTop: ['a1', 'a2'] }),
      rng,
    });

    const { room: afterLeft, effects } = handlePlayerLeft(start.room, 'p3');
    assert.equal(afterLeft.status, 'playing');
    assert.equal(afterLeft.turnOrder.length, 2);
    assert.deepEqual(effects, []);
  });

  test('2 -> 1 joueur en partie : fin immédiate avec le classement en l\'état', () => {
    const room = twoPlayerRoom({ maxTurns: 5 });
    const rng = createSequenceRng([0.1, BUCKET_DONT_CARE, 0.0]);
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1', 'v2', 'v3', 'v4', 'v5'], actionTop: ['a1', 'a2', 'a3', 'a4', 'a5'] }),
      rng,
    });

    const { room: afterLeft, effects } = handlePlayerLeft(start.room, 'p2');
    assert.equal(afterLeft.status, 'finished');
    assert.equal(afterLeft.currentTurn, null);

    // Un CLEAR_TIMER par minuteur possible côté règles optionnelles (point 3),
    // même si la plupart n'ont jamais été armés pour cette partie — les
    // effacer est un no-op sûr côté sockets (voir timers.js).
    assert.deepEqual(
      effects.map((e) => e.type),
      ['CLEAR_TIMER', 'CLEAR_TIMER', 'CLEAR_TIMER', 'CLEAR_TIMER', 'CLEAR_TIMER', 'GAME_ENDED']
    );
    const ended = effects.find((e) => e.type === 'GAME_ENDED');
    assert.equal(ended.reason, 'notEnoughPlayers');
    // Le classement final inclut aussi le joueur qui vient de partir (avec son
    // dernier score), comme pour toute autre fin de partie.
    assert.deepEqual(ended.ranking, [
      { playerId: 'p1', score: 0 },
      { playerId: 'p2', score: 0 },
    ]);
    assert.equal(afterLeft.players.find((p) => p.id === 'p2').status, 'left');
  });

  test("n'a pas d'effet de fin de partie si le salon n'est pas en cours", () => {
    const room = threePlayerRoom({ maxTurns: 5 });
    const { room: afterLeft, effects } = handlePlayerLeft(room, 'p3');
    assert.equal(afterLeft.status, 'waiting');
    assert.deepEqual(effects, []);
    assert.equal(afterLeft.players.find((p) => p.id === 'p3').status, 'left');
  });
});

// =====================================================================
// Point 3 — règles optionnelles
// =====================================================================

describe('règle A : le refus qui coûte', () => {
  test('coûte 2 points et ouvre un choix parmi 3 questions pour le joueur suivant', () => {
    const room = threePlayerRoom({ maxTurns: 5, regles: { refusCouteux: true } });
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9', 'v10', 'v11', 'v12', 'v13', 'v14', 'v15', 'v16', 'v17', 'v18', 'v19', 'v20'], actionTop: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11', 'a12', 'a13', 'a14', 'a15', 'a16', 'a17', 'a18', 'a19', 'a20'] }),
      rng: createSequenceRng([0.1, BUCKET_DONT_CARE, 0.0]), // tour 1 : vérité -> v1
    });
    assert.equal(start.room.currentTurn.activePlayerId, 'p1');

    const passed = submitPass(start.room, {
      playerId: 'p1',
      rng: createSequenceRng([
        0.1, // type des propositions -> vérité
        0.1, 0.0, // proposition 1 (top restant ['v2','v3','v4']) -> v2
        0.1, 0.0, // proposition 2 (['v3','v4']) -> v3
        0.1, 0.0, // proposition 3 (['v4']) -> v4
      ]),
    });

    assert.equal(passed.room.players.find((p) => p.id === 'p1').score, -2);
    assert.equal(passed.room.currentTurn.phase, 'question_choice');
    assert.equal(passed.room.currentTurn.activePlayerId, 'p2');
    assert.deepEqual(
      passed.room.currentTurn.choices.map((c) => c.questionId),
      ['v2', 'v3', 'v4']
    );
    assert.deepEqual(passed.effects.map((e) => e.type), [
      'CLEAR_TIMER',
      'PASS_SUBMITTED',
      'QUESTION_CHOICE_OFFERED',
      'START_TIMER',
    ]);

    const chosen = chooseQuestion(passed.room, { playerId: 'p2', questionId: 'v3' });
    assert.equal(chosen.room.currentTurn.phase, 'answering');
    assert.equal(chosen.room.currentTurn.questionId, 'v3');
    assert.equal(chosen.room.currentTurn.type, 'verite');
    // v2 et v4, non retenus, retournent dans le réservoir.
    assert.ok(chosen.room.questionPool.verite.top.includes('v2'));
    assert.ok(chosen.room.questionPool.verite.top.includes('v4'));
  });

  test('le total peut devenir négatif', () => {
    const room = threePlayerRoom({ maxTurns: 5, regles: { refusCouteux: true } });
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9', 'v10', 'v11', 'v12', 'v13', 'v14', 'v15', 'v16', 'v17', 'v18', 'v19', 'v20'], actionTop: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11', 'a12', 'a13', 'a14', 'a15', 'a16', 'a17', 'a18', 'a19', 'a20'] }),
      rng: createSequenceRng([0.1, BUCKET_DONT_CARE, 0.0]),
    });
    const passed = submitPass(start.room, {
      playerId: 'p1',
      rng: createSequenceRng([0.1, 0.1, 0.0, 0.1, 0.0, 0.1, 0.0]),
    });
    // p2 doit d'abord recevoir une question (choisie ou par timeout) avant de
    // pouvoir à son tour refuser de répondre.
    const chosenForP2 = questionChoiceTimeout(passed.room, { turnNumber: 2 });
    assert.equal(chosenForP2.room.currentTurn.phase, 'answering');
    const passed2 = submitPass(chosenForP2.room, { playerId: 'p2', rng: createSequenceRng([0.1, 0.1, 0.0, 0.1, 0.0, 0.1, 0.0]) });
    // p2 refuse aussi son tour (score déjà à 0, -2 => -2) ; puis choix pour p3.
    assert.equal(passed2.room.players.find((p) => p.id === 'p2').score, -2);
    assert.equal(passed2.room.currentTurn.activePlayerId, 'p3');
  });

  test('timeout du choix parmi 3 : la première proposition est retenue', () => {
    const room = threePlayerRoom({ maxTurns: 5, regles: { refusCouteux: true } });
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9', 'v10', 'v11', 'v12', 'v13', 'v14', 'v15', 'v16', 'v17', 'v18', 'v19', 'v20'], actionTop: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11', 'a12', 'a13', 'a14', 'a15', 'a16', 'a17', 'a18', 'a19', 'a20'] }),
      rng: createSequenceRng([0.1, BUCKET_DONT_CARE, 0.0]),
    });
    const passed = submitPass(start.room, {
      playerId: 'p1',
      rng: createSequenceRng([0.1, 0.1, 0.0, 0.1, 0.0, 0.1, 0.0]), // choix: v2, v3, v4
    });
    const timedOut = questionChoiceTimeout(passed.room, { turnNumber: 2 });
    assert.equal(timedOut.room.currentTurn.questionId, 'v2');
    assert.equal(timedOut.room.currentTurn.phase, 'answering');
  });

  test('refuse si la règle n\'est pas activée', () => {
    const room = threePlayerRoom({ maxTurns: 1 });
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9', 'v10', 'v11', 'v12', 'v13', 'v14', 'v15', 'v16', 'v17', 'v18', 'v19', 'v20'], actionTop: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11', 'a12', 'a13', 'a14', 'a15', 'a16', 'a17', 'a18', 'a19', 'a20'] }),
      rng: createSequenceRng([0.1, BUCKET_DONT_CARE, 0.0]),
    });
    assert.throws(() => submitPass(start.room, { playerId: 'p1' }), (err) => err.code === 'REGLE_DISABLED');
  });

  test("refuse si ce n'est pas le tour du joueur", () => {
    const room = threePlayerRoom({ maxTurns: 1, regles: { refusCouteux: true } });
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9', 'v10', 'v11', 'v12', 'v13', 'v14', 'v15', 'v16', 'v17', 'v18', 'v19', 'v20'], actionTop: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11', 'a12', 'a13', 'a14', 'a15', 'a16', 'a17', 'a18', 'a19', 'a20'] }),
      rng: createSequenceRng([0.1, BUCKET_DONT_CARE, 0.0]),
    });
    assert.throws(() => submitPass(start.room, { playerId: 'p2' }), (err) => err.code === 'NOT_YOUR_TURN');
  });
});

describe('règle B : le double ou rien', () => {
  test('offre le choix avant de révéler la question, si le niveau max le permet', () => {
    const room = threePlayerRoom({ maxTurns: 3, niveauMax: 1, regles: { doubleOuRien: true } });
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9', 'v10', 'v11', 'v12', 'v13', 'v14', 'v15', 'v16', 'v17', 'v18', 'v19', 'v20'], actionTop: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11', 'a12', 'a13', 'a14', 'a15', 'a16', 'a17', 'a18', 'a19', 'a20'], veriteEscalade: ['ev1', 'ev2', 'ev3', 'ev4', 'ev5'], actionEscalade: ['ea1', 'ea2', 'ea3', 'ea4', 'ea5'] }),
    });
    assert.equal(start.room.currentTurn.phase, 'niveau_choice');
    assert.equal(start.room.currentTurn.activePlayerId, 'p1');
    assert.equal(start.room.currentTurn.questionId, null);
    assert.deepEqual(start.effects.map((e) => e.type), ['NIVEAU_CHOICE_OFFERED', 'START_TIMER']);
  });

  test('refus : tour normal, niveau inchangé', () => {
    const room = threePlayerRoom({ maxTurns: 3, niveauMax: 1, regles: { doubleOuRien: true } });
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9', 'v10', 'v11', 'v12', 'v13', 'v14', 'v15', 'v16', 'v17', 'v18', 'v19', 'v20'], actionTop: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11', 'a12', 'a13', 'a14', 'a15', 'a16', 'a17', 'a18', 'a19', 'a20'], veriteEscalade: ['ev1', 'ev2', 'ev3', 'ev4', 'ev5'] }),
    });
    const declined = respondDoubleOuRien(start.room, {
      playerId: 'p1',
      accept: false,
      rng: createSequenceRng([0.1, BUCKET_DONT_CARE, 0.0]),
    });
    assert.equal(declined.room.currentTurn.phase, 'answering');
    assert.equal(declined.room.currentTurn.doubleOuRien, false);
    assert.equal(declined.room.currentTurn.questionId, 'v1');
  });

  test('timeout équivaut à un refus', () => {
    const room = threePlayerRoom({ maxTurns: 3, niveauMax: 1, regles: { doubleOuRien: true } });
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9', 'v10', 'v11', 'v12', 'v13', 'v14', 'v15', 'v16', 'v17', 'v18', 'v19', 'v20'], actionTop: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11', 'a12', 'a13', 'a14', 'a15', 'a16', 'a17', 'a18', 'a19', 'a20'] }),
    });
    const timedOut = niveauChoiceTimeout(start.room, {
      turnNumber: 1,
      rng: createSequenceRng([0.1, BUCKET_DONT_CARE, 0.0]),
    });
    assert.equal(timedOut.room.currentTurn.doubleOuRien, false);
    assert.equal(timedOut.room.currentTurn.questionId, 'v1');
  });

  test('acceptation : question du niveau supérieur, points doublés en cas de réponse', () => {
    const room = threePlayerRoom({ maxTurns: 3, niveauMax: 1, regles: { doubleOuRien: true } });
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9', 'v10', 'v11', 'v12', 'v13', 'v14', 'v15', 'v16', 'v17', 'v18', 'v19', 'v20'], actionTop: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11', 'a12', 'a13', 'a14', 'a15', 'a16', 'a17', 'a18', 'a19', 'a20'], veriteEscalade: ['ev1', 'ev2', 'ev3', 'ev4', 'ev5'], actionEscalade: ['ea1', 'ea2', 'ea3', 'ea4', 'ea5'] }),
    });
    const accepted = respondDoubleOuRien(start.room, {
      playerId: 'p1',
      accept: true,
      rng: createSequenceRng([0.1, 0.0]), // type vérité, index 0 dans l'escalade
    });
    assert.equal(accepted.room.currentTurn.doubleOuRien, true);
    assert.equal(accepted.room.currentTurn.questionId, 'ev1');

    const answered = submitAnswer(accepted.room, { playerId: 'p1', text: 'réponse' });
    assert.equal(answered.room.currentTurn.phase, 'voting'); // 3 joueurs : vote normal
    const resolved = voteTimeout(answered.room, { turnNumber: 1 });
    const effect = resolved.effects.find((e) => e.type === 'TURN_RESOLVED');
    assert.equal(effect.points, 2); // vérité (1) x2, aucun pouce (timeout de vote)
    assert.equal(effect.doubleOuRien, true);
  });

  test('acceptation puis absence de réponse : zéro point', () => {
    const room = threePlayerRoom({ maxTurns: 3, niveauMax: 1, regles: { doubleOuRien: true } });
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9', 'v10', 'v11', 'v12', 'v13', 'v14', 'v15', 'v16', 'v17', 'v18', 'v19', 'v20'], actionTop: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11', 'a12', 'a13', 'a14', 'a15', 'a16', 'a17', 'a18', 'a19', 'a20'], veriteEscalade: ['ev1', 'ev2', 'ev3', 'ev4', 'ev5'], actionEscalade: ['ea1', 'ea2', 'ea3', 'ea4', 'ea5'] }),
    });
    const accepted = respondDoubleOuRien(start.room, {
      playerId: 'p1',
      accept: true,
      rng: createSequenceRng([0.1, 0.0]),
    });
    const timedOut = answerTimeout(accepted.room, { turnNumber: 1 });
    const effect = timedOut.effects.find((e) => e.type === 'TURN_RESOLVED');
    assert.equal(effect.points, 0);
  });

  test('indisponible en mode couple (pas de niveau supérieur), même activé', () => {
    const room = twoPlayerRoom({ maxTurns: 1, categorie: 'couple', regles: { doubleOuRien: true } });
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1', 'v2', 'v3'], actionTop: ['a1', 'a2', 'a3'] }),
      rng: createSequenceRng([0.1, BUCKET_DONT_CARE, 0.0]),
    });
    assert.equal(start.room.currentTurn.phase, 'answering');
    assert.equal(start.room.currentTurn.mode, 'normal');
  });

  test('indisponible si le salon est déjà au niveau maximum', () => {
    const room = threePlayerRoom({ maxTurns: 1, niveauMax: 3, regles: { doubleOuRien: true } });
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9', 'v10', 'v11', 'v12', 'v13', 'v14', 'v15', 'v16', 'v17', 'v18', 'v19', 'v20'], actionTop: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11', 'a12', 'a13', 'a14', 'a15', 'a16', 'a17', 'a18', 'a19', 'a20'] }),
      rng: createSequenceRng([0.1, BUCKET_DONT_CARE, 0.0]),
    });
    assert.equal(start.room.currentTurn.phase, 'answering');
  });

  test('sans question disponible au niveau supérieur, retombe silencieusement sur un tour normal', () => {
    const room = threePlayerRoom({ maxTurns: 1, niveauMax: 1, regles: { doubleOuRien: true } });
    const start = startGame(room, { questionPool: pool({ veriteTop: ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9', 'v10', 'v11', 'v12', 'v13', 'v14', 'v15', 'v16', 'v17', 'v18', 'v19', 'v20'], actionTop: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11', 'a12', 'a13', 'a14', 'a15', 'a16', 'a17', 'a18', 'a19', 'a20'] }) });
    const accepted = respondDoubleOuRien(start.room, {
      playerId: 'p1',
      accept: true,
      rng: createSequenceRng([0.1, BUCKET_DONT_CARE, 0.0]),
    });
    assert.equal(accepted.room.currentTurn.doubleOuRien, false);
    assert.equal(accepted.room.currentTurn.questionId, 'v1');
  });

  test('cas explicite — refus après un double ou rien accepté : zéro point, pas de conséquence', () => {
    const room = threePlayerRoom({ maxTurns: 5, niveauMax: 1, regles: { doubleOuRien: true, refusCouteux: true } });
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9', 'v10', 'v11', 'v12', 'v13', 'v14', 'v15', 'v16', 'v17', 'v18', 'v19', 'v20'], actionTop: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11', 'a12', 'a13', 'a14', 'a15', 'a16', 'a17', 'a18', 'a19', 'a20'], veriteEscalade: ['ev1', 'ev2', 'ev3', 'ev4', 'ev5'], actionEscalade: ['ea1', 'ea2', 'ea3', 'ea4', 'ea5'] }),
    });
    const accepted = respondDoubleOuRien(start.room, {
      playerId: 'p1',
      accept: true,
      rng: createSequenceRng([0.1, 0.0]),
    });
    const passed = submitPass(accepted.room, { playerId: 'p1' });
    assert.equal(passed.room.players.find((p) => p.id === 'p1').score, 0);
    assert.equal(passed.room.forceQuestionChoice, false);
    // La règle double ou rien reste active : le tour suivant réoffre le choix.
    assert.equal(passed.room.currentTurn.phase, 'niveau_choice');
    assert.equal(passed.room.currentTurn.activePlayerId, 'p2');
  });
});

describe('règle C : la question retournée', () => {
  function setupWithPreviousVote() {
    const room = threePlayerRoom({ maxTurns: 5, regles: { questionRetournee: true } });
    const rng = createSequenceRng([
      0.1, BUCKET_DONT_CARE, 0.0, // tour 1 : vérité -> v1 (p1 actif)
      0.9, BUCKET_DONT_CARE, 0.0, // tour 2 : action -> a1 (p2 actif)
    ]);
    const start = startGame(room, { questionPool: pool({ veriteTop: ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9', 'v10', 'v11', 'v12', 'v13', 'v14', 'v15', 'v16', 'v17', 'v18', 'v19', 'v20'], actionTop: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11', 'a12', 'a13', 'a14', 'a15', 'a16', 'a17', 'a18', 'a19', 'a20'] }), rng });
    const answered1 = submitAnswer(start.room, { playerId: 'p1', text: 'réponse' });
    const v1 = submitVote(answered1.room, { voterId: 'p2', vote: 'down', turnNumber: 1 });
    const v2 = submitVote(v1.room, { voterId: 'p3', vote: 'up', turnNumber: 1, rng });
    return v2.room; // tour 2, p2 actif, p3 a le mieux noté le tour 1
  }

  test('retourne la question au joueur qui a le mieux noté le tour précédent', () => {
    const room = setupWithPreviousVote();
    assert.equal(room.currentTurn.activePlayerId, 'p2');

    const returned = returnQuestion(room, { playerId: 'p2' });
    assert.equal(returned.room.currentTurn.activePlayerId, 'p3');
    assert.equal(returned.room.currentTurn.returned, true);
    assert.equal(returned.room.currentTurn.originalPlayerId, 'p2');
    assert.deepEqual(returned.effects, [
      { type: 'QUESTION_RETURNED', turnNumber: 2, fromPlayerId: 'p2', toPlayerId: 'p3' },
    ]);
    assert.deepEqual(returned.room.reglesUsage.questionRetournee, ['p2']);

    // p3 répond désormais à la place de p2 ; les points iront à p3.
    const answered = submitAnswer(returned.room, { playerId: 'p3', text: 'réponse de p3' });
    assert.equal(answered.room.currentTurn.phase, 'voting');
  });

  test('le joueur qui reçoit la question ne peut pas la retourner à son tour', () => {
    const room = setupWithPreviousVote();
    const returned = returnQuestion(room, { playerId: 'p2' });
    assert.throws(
      () => returnQuestion(returned.room, { playerId: 'p3' }),
      (err) => err.code === 'QUESTION_RETOURNEE_INDISPONIBLE'
    );
  });

  test('une fois par partie et par joueur', () => {
    const room = setupWithPreviousVote();
    const roomWithUsage = { ...room, reglesUsage: { questionRetournee: ['p2'] } };
    assert.throws(
      () => returnQuestion(roomWithUsage, { playerId: 'p2' }),
      (err) => err.code === 'QUESTION_RETOURNEE_INDISPONIBLE'
    );
  });

  test('indisponible sans tour précédent', () => {
    const room = threePlayerRoom({ maxTurns: 3, regles: { questionRetournee: true } });
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9', 'v10', 'v11', 'v12', 'v13', 'v14', 'v15', 'v16', 'v17', 'v18', 'v19', 'v20'], actionTop: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11', 'a12', 'a13', 'a14', 'a15', 'a16', 'a17', 'a18', 'a19', 'a20'] }),
      rng: createSequenceRng([0.1, BUCKET_DONT_CARE, 0.0]),
    });
    assert.throws(
      () => returnQuestion(start.room, { playerId: 'p1' }),
      (err) => err.code === 'QUESTION_RETOURNEE_INDISPONIBLE'
    );
  });

  test('indisponible à 2 joueurs (le vote y est toujours sauté, donc jamais de "mieux noté")', () => {
    const room = twoPlayerRoom({ maxTurns: 3, regles: { questionRetournee: true } });
    const rng = createSequenceRng([
      0.1, BUCKET_DONT_CARE, 0.0,
      0.9, BUCKET_DONT_CARE, 0.0,
    ]);
    const start = startGame(room, { questionPool: pool({ veriteTop: ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9', 'v10', 'v11', 'v12', 'v13', 'v14', 'v15', 'v16', 'v17', 'v18', 'v19', 'v20'], actionTop: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11', 'a12', 'a13', 'a14', 'a15', 'a16', 'a17', 'a18', 'a19', 'a20'] }), rng });
    const answered = submitAnswer(start.room, { playerId: 'p1', text: 'réponse' });
    assert.equal(answered.room.currentTurn.turnNumber, 2); // résolu directement, tour 2 démarré
    assert.throws(
      () => returnQuestion(answered.room, { playerId: 'p2' }),
      (err) => err.code === 'QUESTION_RETOURNEE_INDISPONIBLE'
    );
  });

  test('indisponible sur une question de double ou rien', () => {
    const room = threePlayerRoom({
      maxTurns: 5,
      niveauMax: 1,
      regles: { questionRetournee: true, doubleOuRien: true },
    });
    // On simule directement un tour "doubleOuRien" avec un historique valable.
    const base = threePlayerRoom({ maxTurns: 5, regles: { questionRetournee: true } });
    const start = startGame(base, {
      questionPool: pool({ veriteTop: ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9', 'v10', 'v11', 'v12', 'v13', 'v14', 'v15', 'v16', 'v17', 'v18', 'v19', 'v20'], actionTop: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11', 'a12', 'a13', 'a14', 'a15', 'a16', 'a17', 'a18', 'a19', 'a20'] }),
      rng: createSequenceRng([0.1, BUCKET_DONT_CARE, 0.0, 0.9, BUCKET_DONT_CARE, 0.0]),
    });
    const answered1 = submitAnswer(start.room, { playerId: 'p1', text: 'réponse' });
    const v1 = submitVote(answered1.room, { voterId: 'p2', vote: 'down', turnNumber: 1 });
    const v2 = submitVote(v1.room, { voterId: 'p3', vote: 'up', turnNumber: 1 });
    const withDoubleOuRien = { ...v2.room, currentTurn: { ...v2.room.currentTurn, doubleOuRien: true } };
    assert.throws(
      () => returnQuestion(withDoubleOuRien, { playerId: 'p2' }),
      (err) => err.code === 'QUESTION_RETOURNEE_INDISPONIBLE'
    );
  });

  test("refuse si la règle n'est pas activée", () => {
    const room = threePlayerRoom({ maxTurns: 1 });
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9', 'v10', 'v11', 'v12', 'v13', 'v14', 'v15', 'v16', 'v17', 'v18', 'v19', 'v20'], actionTop: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11', 'a12', 'a13', 'a14', 'a15', 'a16', 'a17', 'a18', 'a19', 'a20'] }),
      rng: createSequenceRng([0.1, BUCKET_DONT_CARE, 0.0]),
    });
    assert.throws(() => returnQuestion(start.room, { playerId: 'p1' }), (err) => err.code === 'REGLE_DISABLED');
  });
});

describe('règle D : le tour surprise', () => {
  test('un tirage sous le seuil déclenche un tour surprise pour tous les joueurs actifs', () => {
    const room = threePlayerRoom({ maxTurns: 3, regles: { tourSurprise: true } });
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9', 'v10', 'v11', 'v12', 'v13', 'v14', 'v15', 'v16', 'v17', 'v18', 'v19', 'v20'], actionTop: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11', 'a12', 'a13', 'a14', 'a15', 'a16', 'a17', 'a18', 'a19', 'a20'] }),
      rng: createSequenceRng([0.1, 0.1, BUCKET_DONT_CARE, 0.0]),
    });
    assert.equal(start.room.currentTurn.mode, 'surprise');
    assert.deepEqual(start.room.currentTurn.activePlayerIds, ['p1', 'p2', 'p3']);
    assert.equal(start.room.currentTurn.questionId, 'v1');
    assert.deepEqual(start.effects.map((e) => e.type), ['TURN_STARTED', 'START_TIMER']);
  });

  test('un tirage au-dessus du seuil reste un tour normal', () => {
    const room = threePlayerRoom({ maxTurns: 3, regles: { tourSurprise: true } });
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9', 'v10', 'v11', 'v12', 'v13', 'v14', 'v15', 'v16', 'v17', 'v18', 'v19', 'v20'], actionTop: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11', 'a12', 'a13', 'a14', 'a15', 'a16', 'a17', 'a18', 'a19', 'a20'] }),
      rng: createSequenceRng([0.5, 0.1, BUCKET_DONT_CARE, 0.0]),
    });
    assert.equal(start.room.currentTurn.mode, 'normal');
  });

  test('cycle complet : réponses, votes, 3 points au gagnant, 1 aux autres répondants', () => {
    const room = threePlayerRoom({ maxTurns: 2, regles: { tourSurprise: true } });
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9', 'v10', 'v11', 'v12', 'v13', 'v14', 'v15', 'v16', 'v17', 'v18', 'v19', 'v20'], actionTop: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11', 'a12', 'a13', 'a14', 'a15', 'a16', 'a17', 'a18', 'a19', 'a20'] }),
      rng: createSequenceRng([0.1, 0.1, BUCKET_DONT_CARE, 0.0]),
    });

    const a1 = submitSurpriseAnswer(start.room, { playerId: 'p1', text: 'rep1' });
    assert.deepEqual(a1.effects.map((e) => e.type), ['SURPRISE_ANSWER_SUBMITTED']);
    const a2 = submitSurpriseAnswer(a1.room, { playerId: 'p2', text: 'rep2' });
    const a3 = submitSurpriseAnswer(a2.room, { playerId: 'p3', text: 'rep3' });
    assert.equal(a3.room.currentTurn.phase, 'voting');
    assert.deepEqual(a3.effects.map((e) => e.type), [
      'SURPRISE_ANSWER_SUBMITTED',
      'CLEAR_TIMER',
      'SURPRISE_VOTING_STARTED',
      'START_TIMER',
    ]);

    // Le quorum (60% des votants éligibles, ici 2 sur 3) résout le tour dès
    // le 2e vote : p3 n'a pas besoin de voter pour que le tour se termine.
    const v1 = submitSurpriseVote(a3.room, { voterId: 'p1', targetId: 'p3' });
    const v2 = submitSurpriseVote(v1.room, { voterId: 'p2', targetId: 'p3' });
    const resolved = v2.effects.find((e) => e.type === 'SURPRISE_RESOLVED');
    assert.deepEqual(resolved.winnerIds, ['p3']);

    const scores = Object.fromEntries(v2.room.players.map((p) => [p.id, p.score]));
    assert.equal(scores.p3, 3);
    assert.equal(scores.p1, 1);
    assert.equal(scores.p2, 1);
  });

  test("un joueur qui n'a pas répondu ne peut pas recevoir de vote, et marque 0", () => {
    const room = threePlayerRoom({ maxTurns: 1, regles: { tourSurprise: true } });
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9', 'v10', 'v11', 'v12', 'v13', 'v14', 'v15', 'v16', 'v17', 'v18', 'v19', 'v20'], actionTop: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11', 'a12', 'a13', 'a14', 'a15', 'a16', 'a17', 'a18', 'a19', 'a20'] }),
      rng: createSequenceRng([0.1, 0.1, BUCKET_DONT_CARE, 0.0]),
    });
    const a1 = submitSurpriseAnswer(start.room, { playerId: 'p1', text: 'rep1' });
    const timedOut = surpriseAnswerTimeout(a1.room, { turnNumber: 1 });
    assert.equal(timedOut.room.currentTurn.phase, 'voting');

    assert.throws(
      () => submitSurpriseVote(timedOut.room, { voterId: 'p1', targetId: 'p2' }),
      (err) => err.code === 'SURPRISE_VOTE_INVALID'
    );

    const v = submitSurpriseVote(timedOut.room, { voterId: 'p2', targetId: 'p1' });
    const resolved = surpriseVoteTimeout(v.room, { turnNumber: 1 });
    const effect = resolved.effects.find((e) => e.type === 'SURPRISE_RESOLVED');
    const scores = Object.fromEntries(effect.results.map((r) => [r.playerId, r.points]));
    assert.equal(scores.p1, 3);
    assert.equal(scores.p2, 0);
    assert.equal(scores.p3, 0);
  });

  test('une égalité de votes fait gagner tous les joueurs à égalité', () => {
    const room = threePlayerRoom({ maxTurns: 1, regles: { tourSurprise: true } });
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9', 'v10', 'v11', 'v12', 'v13', 'v14', 'v15', 'v16', 'v17', 'v18', 'v19', 'v20'], actionTop: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11', 'a12', 'a13', 'a14', 'a15', 'a16', 'a17', 'a18', 'a19', 'a20'] }),
      rng: createSequenceRng([0.1, 0.1, BUCKET_DONT_CARE, 0.0]),
    });
    const a1 = submitSurpriseAnswer(start.room, { playerId: 'p1', text: 'r1' });
    const a2 = submitSurpriseAnswer(a1.room, { playerId: 'p2', text: 'r2' });
    const a3 = submitSurpriseAnswer(a2.room, { playerId: 'p3', text: 'r3' });
    // Le quorum (60% de 3 votants = 2) résout le tour dès ce 2e vote : p3 ne
    // vote jamais, d'où l'égalité à deux plutôt qu'à trois.
    const v1 = submitSurpriseVote(a3.room, { voterId: 'p1', targetId: 'p2' });
    const v2 = submitSurpriseVote(v1.room, { voterId: 'p2', targetId: 'p1' });
    const resolved = v2.effects.find((e) => e.type === 'SURPRISE_RESOLVED');
    assert.deepEqual(resolved.winnerIds.sort(), ['p1', 'p2']);
    const scores = Object.fromEntries(v2.room.players.map((p) => [p.id, p.score]));
    assert.equal(scores.p1, 3);
    assert.equal(scores.p2, 3);
    assert.equal(scores.p3, 1);
  });

  test('cas explicite — le refus est indisponible pendant un tour surprise', () => {
    const room = threePlayerRoom({ maxTurns: 1, regles: { tourSurprise: true, refusCouteux: true } });
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9', 'v10', 'v11', 'v12', 'v13', 'v14', 'v15', 'v16', 'v17', 'v18', 'v19', 'v20'], actionTop: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11', 'a12', 'a13', 'a14', 'a15', 'a16', 'a17', 'a18', 'a19', 'a20'] }),
      rng: createSequenceRng([0.1, 0.1, BUCKET_DONT_CARE, 0.0]),
    });
    assert.throws(() => submitPass(start.room, { playerId: 'p1' }), (err) => err.code === 'INVALID_PHASE');
  });

  test('cas explicite — la question retournée est indisponible quand le tour précédent était surprise', () => {
    const room = threePlayerRoom({ maxTurns: 5, regles: { tourSurprise: true, questionRetournee: true } });
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9', 'v10', 'v11', 'v12', 'v13', 'v14', 'v15', 'v16', 'v17', 'v18', 'v19', 'v20'], actionTop: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11', 'a12', 'a13', 'a14', 'a15', 'a16', 'a17', 'a18', 'a19', 'a20'] }),
      rng: createSequenceRng([0.1, 0.1, BUCKET_DONT_CARE, 0.0]),
    });
    const a1 = submitSurpriseAnswer(start.room, { playerId: 'p1', text: 'r1' });
    const a2 = submitSurpriseAnswer(a1.room, { playerId: 'p2', text: 'r2' });
    const a3 = submitSurpriseAnswer(a2.room, { playerId: 'p3', text: 'r3' });
    // Tour surprise forcé à se résoudre sans déclencher un second tour surprise,
    // pour observer un tour normal juste après un tour surprise.
    const forcedNormalRoom = { ...a3.room };
    const v1 = submitSurpriseVote(forcedNormalRoom, { voterId: 'p1', targetId: 'p2' });
    // Le quorum (60% de 3 votants = 2) résout le tour dès ce 2e vote — c'est
    // donc cet appel qui tire le tour suivant, d'où le rng dédié ici plutôt
    // que sur un 3e vote qui ne serait plus valide (le tour est déjà résolu).
    const v2 = submitSurpriseVote(v1.room, {
      voterId: 'p2',
      targetId: 'p3',
      rng: createSequenceRng([0.9, 0.1, BUCKET_DONT_CARE, 0.0]), // pas de 2e tour surprise, tour normal
    });
    if (v2.room.currentTurn?.mode === 'normal') {
      assert.throws(
        () => returnQuestion(v2.room, { playerId: v2.room.currentTurn.activePlayerId }),
        (err) => err.code === 'QUESTION_RETOURNEE_INDISPONIBLE'
      );
    }
  });

  test('à 2 joueurs avec pari mutuel actif, aucun tour surprise n\'est jamais tiré', () => {
    const room = twoPlayerRoom({ maxTurns: 1, regles: { tourSurprise: true, pariMutuel: true } });
    // 0.01 aurait déclenché un tour surprise (< 0.2) si la porte n'était pas fermée ;
    // ici elle est consommée directement comme type de tirage normal.
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9', 'v10', 'v11', 'v12', 'v13', 'v14', 'v15', 'v16', 'v17', 'v18', 'v19', 'v20'], actionTop: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11', 'a12', 'a13', 'a14', 'a15', 'a16', 'a17', 'a18', 'a19', 'a20'] }),
      rng: createSequenceRng([0.01, BUCKET_DONT_CARE, 0.0]),
    });
    assert.equal(start.room.currentTurn.mode, 'normal');
  });
});

describe('règle E : le pari mutuel (2 joueurs uniquement)', () => {
  test('le parieur dépose un pari, jugé par le joueur actif une fois sa réponse envoyée', () => {
    const room = twoPlayerRoom({ maxTurns: 2, regles: { pariMutuel: true } });
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9', 'v10', 'v11', 'v12', 'v13', 'v14', 'v15', 'v16', 'v17', 'v18', 'v19', 'v20'], actionTop: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11', 'a12', 'a13', 'a14', 'a15', 'a16', 'a17', 'a18', 'a19', 'a20'] }),
      rng: createSequenceRng([0.1, BUCKET_DONT_CARE, 0.0]),
    });
    assert.equal(start.room.currentTurn.activePlayerId, 'p1');

    const bet = submitBet(start.room, { playerId: 'p2', text: 'Il va dire une bêtise' });
    assert.equal(bet.room.currentTurn.pariMutuel.bet, 'Il va dire une bêtise');
    assert.deepEqual(bet.effects, []);

    const answered = submitAnswer(bet.room, { playerId: 'p1', text: 'une bêtise, en effet' });
    assert.equal(answered.room.currentTurn.phase, 'jugement');
    assert.deepEqual(answered.effects.map((e) => e.type), [
      'CLEAR_TIMER',
      'ANSWER_SUBMITTED',
      'JUGEMENT_STARTED',
      'START_TIMER',
    ]);

    const judged = judgeBet(answered.room, { playerId: 'p1', verdict: 'juste' });
    const resolvedEffect = judged.effects.find((e) => e.type === 'TURN_RESOLVED');
    assert.equal(resolvedEffect.pariMutuel.points, 2);
    assert.equal(judged.room.players.find((p) => p.id === 'p2').score, 2);
    assert.equal(judged.room.players.find((p) => p.id === 'p1').score, 1);
  });

  test('verdict "à côté" : aucun point pour le parieur', () => {
    const room = twoPlayerRoom({ maxTurns: 2, regles: { pariMutuel: true } });
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9', 'v10', 'v11', 'v12', 'v13', 'v14', 'v15', 'v16', 'v17', 'v18', 'v19', 'v20'], actionTop: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11', 'a12', 'a13', 'a14', 'a15', 'a16', 'a17', 'a18', 'a19', 'a20'] }),
      rng: createSequenceRng([0.1, BUCKET_DONT_CARE, 0.0]),
    });
    const bet = submitBet(start.room, { playerId: 'p2', text: 'un pari' });
    const answered = submitAnswer(bet.room, { playerId: 'p1', text: 'réponse' });
    const judged = judgeBet(answered.room, { playerId: 'p1', verdict: 'a_cote' });
    const resolvedEffect = judged.effects.find((e) => e.type === 'TURN_RESOLVED');
    assert.equal(resolvedEffect.pariMutuel.points, 0);
    assert.equal(judged.room.players.find((p) => p.id === 'p2').score, 0);
  });

  test('timeout du jugement équivaut à "à côté"', () => {
    const room = twoPlayerRoom({ maxTurns: 2, regles: { pariMutuel: true } });
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9', 'v10', 'v11', 'v12', 'v13', 'v14', 'v15', 'v16', 'v17', 'v18', 'v19', 'v20'], actionTop: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11', 'a12', 'a13', 'a14', 'a15', 'a16', 'a17', 'a18', 'a19', 'a20'] }),
      rng: createSequenceRng([0.1, BUCKET_DONT_CARE, 0.0]),
    });
    const bet = submitBet(start.room, { playerId: 'p2', text: 'un pari' });
    const answered = submitAnswer(bet.room, { playerId: 'p1', text: 'réponse' });
    const timedOut = judgeBetTimeout(answered.room, { turnNumber: 1 });
    const effect = timedOut.effects.find((e) => e.type === 'TURN_RESOLVED');
    assert.equal(effect.pariMutuel.points, 0);
  });

  test('sans pari déposé, résout normalement sans phase de jugement', () => {
    const room = twoPlayerRoom({ maxTurns: 1, regles: { pariMutuel: true } });
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9', 'v10', 'v11', 'v12', 'v13', 'v14', 'v15', 'v16', 'v17', 'v18', 'v19', 'v20'], actionTop: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11', 'a12', 'a13', 'a14', 'a15', 'a16', 'a17', 'a18', 'a19', 'a20'] }),
      rng: createSequenceRng([0.1, BUCKET_DONT_CARE, 0.0]),
    });
    const answered = submitAnswer(start.room, { playerId: 'p1', text: 'réponse' });
    assert.deepEqual(answered.effects.map((e) => e.type), [
      'CLEAR_TIMER',
      'ANSWER_SUBMITTED',
      'TURN_RESOLVED',
      'GAME_ENDED',
    ]);
  });

  test('le joueur actif ne peut pas parier sur sa propre réponse', () => {
    const room = twoPlayerRoom({ maxTurns: 1, regles: { pariMutuel: true } });
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9', 'v10', 'v11', 'v12', 'v13', 'v14', 'v15', 'v16', 'v17', 'v18', 'v19', 'v20'], actionTop: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11', 'a12', 'a13', 'a14', 'a15', 'a16', 'a17', 'a18', 'a19', 'a20'] }),
      rng: createSequenceRng([0.1, BUCKET_DONT_CARE, 0.0]),
    });
    assert.throws(
      () => submitBet(start.room, { playerId: 'p1', text: '...' }),
      (err) => err.code === 'PARI_MUTUEL_INDISPONIBLE'
    );
  });

  test('indisponible au-delà de 2 joueurs', () => {
    const room = threePlayerRoom({ maxTurns: 1, regles: { pariMutuel: true } });
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9', 'v10', 'v11', 'v12', 'v13', 'v14', 'v15', 'v16', 'v17', 'v18', 'v19', 'v20'], actionTop: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11', 'a12', 'a13', 'a14', 'a15', 'a16', 'a17', 'a18', 'a19', 'a20'] }),
      rng: createSequenceRng([0.1, BUCKET_DONT_CARE, 0.0]),
    });
    assert.throws(
      () => submitBet(start.room, { playerId: 'p2', text: '...' }),
      (err) => err.code === 'REGLE_DISABLED'
    );
  });
});

describe('règle F : le joker du public', () => {
  test('un autre joueur active le joker, une contrainte est tirée et diffusée', () => {
    const room = threePlayerRoom({ maxTurns: 1, regles: { jokerPublic: true } });
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1'], actionTop: ['a1'] }),
      rng: createSequenceRng([0.1, BUCKET_DONT_CARE, 0.0]),
    });
    assert.equal(start.room.currentTurn.activePlayerId, 'p1');

    const activated = activateJokerPublic(start.room, { playerId: 'p2', rng: createSequenceRng([0]) });
    assert.equal(activated.room.currentTurn.jokerConstraint, JOKER_CONTRAINTES[0]);
    assert.deepEqual(activated.room.reglesUsage.jokerPublic, ['p2']);
    assert.deepEqual(activated.effects, [
      { type: 'JOKER_ACTIVATED', turnNumber: 1, activatedBy: 'p2', mode: 'style', contrainte: JOKER_CONTRAINTES[0] },
    ]);
  });

  test('le joueur actif lui-même peut activer son propre joker', () => {
    const room = threePlayerRoom({ maxTurns: 1, regles: { jokerPublic: true } });
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1'], actionTop: ['a1'] }),
      rng: createSequenceRng([0.1, BUCKET_DONT_CARE, 0.0]),
    });
    const activated = activateJokerPublic(start.room, { playerId: 'p1', rng: createSequenceRng([0]) });
    assert.equal(activated.room.currentTurn.jokerConstraint, JOKER_CONTRAINTES[0]);
  });

  test('désactivé par défaut : REGLE_DISABLED', () => {
    const room = threePlayerRoom({ maxTurns: 1 });
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1'], actionTop: ['a1'] }),
      rng: createSequenceRng([0.1, BUCKET_DONT_CARE, 0.0]),
    });
    assert.throws(
      () => activateJokerPublic(start.room, { playerId: 'p2' }),
      (err) => err.code === 'REGLE_DISABLED'
    );
  });

  test('un joueur ne peut pas réutiliser son joker déjà consommé cette partie', () => {
    const room = threePlayerRoom({ maxTurns: 1, regles: { jokerPublic: true } });
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1'], actionTop: ['a1'] }),
      rng: createSequenceRng([0.1, BUCKET_DONT_CARE, 0.0]),
    });
    const roomWithUsage = { ...start.room, reglesUsage: { ...start.room.reglesUsage, jokerPublic: ['p2'] } };
    assert.throws(
      () => activateJokerPublic(roomWithUsage, { playerId: 'p2' }),
      (err) => err.code === 'JOKER_DEJA_UTILISE'
    );
  });

  test('une seconde activation sur le même tour est ignorée silencieusement, sans consommer le joker du second joueur', () => {
    const room = threePlayerRoom({ maxTurns: 1, regles: { jokerPublic: true } });
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1'], actionTop: ['a1'] }),
      rng: createSequenceRng([0.1, BUCKET_DONT_CARE, 0.0]),
    });
    const first = activateJokerPublic(start.room, { playerId: 'p2', rng: createSequenceRng([0]) });
    const second = activateJokerPublic(first.room, { playerId: 'p3', rng: createSequenceRng([1]) });
    assert.deepEqual(second.effects, []);
    assert.equal(second.room.currentTurn.jokerConstraint, JOKER_CONTRAINTES[0]);
    assert.deepEqual(second.room.reglesUsage.jokerPublic, ['p2']);
  });

  test('indisponible hors de la phase "answering" (ex : choix parmi 3)', () => {
    const room = threePlayerRoom({ maxTurns: 2, regles: { jokerPublic: true, refusCouteux: true } });
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1', 'v2'], actionTop: ['a1', 'a2'] }),
      rng: createSequenceRng([0.1, BUCKET_DONT_CARE, 0.0]),
    });
    const passed = submitPass(start.room, { playerId: 'p1' });
    assert.equal(passed.room.currentTurn.phase, 'question_choice');
    assert.throws(
      () => activateJokerPublic(passed.room, { playerId: 'p2' }),
      (err) => err.code === 'INVALID_PHASE'
    );
  });

  test('indisponible pendant un tour surprise', () => {
    const room = threePlayerRoom({ maxTurns: 1, regles: { jokerPublic: true, tourSurprise: true } });
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1'], actionTop: ['a1'] }),
      rng: createSequenceRng([0.1, 0.0, BUCKET_DONT_CARE, 0.0]),
    });
    assert.equal(start.room.currentTurn.mode, 'surprise');
    assert.throws(
      () => activateJokerPublic(start.room, { playerId: 'p2' }),
      (err) => err.code === 'INVALID_PHASE'
    );
  });
});

describe('règle F (variante) : le joker inversé', () => {
  test('remplace la question du tour par celle du tour précédent, et rend l\'ancienne à la réserve', () => {
    const room = twoPlayerRoom({ maxTurns: 2, regles: { jokerPublic: true, jokerInverse: true } });
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1', 'v2'], actionTop: ['a1', 'a2'] }),
      rng: createSequenceRng([0.1, BUCKET_DONT_CARE, 0.0]),
    });
    const turn1Type = start.room.currentTurn.type;
    const turn1QuestionId = start.room.currentTurn.questionId;

    const answered = submitAnswer(start.room, { playerId: 'p1', text: 'réponse 1' });
    const turn2 = answered.room.currentTurn;
    assert.equal(turn2.activePlayerId, 'p2');
    assert.equal(answered.room.history[0].questionId, turn1QuestionId);
    // Structurellement garanti : chaque id n'existe qu'une fois dans le
    // réservoir, celui du tour 1 en a déjà été retiré avant ce second tirage.
    assert.notEqual(turn2.questionId, turn1QuestionId);
    const turn2OriginalQuestionId = turn2.questionId;
    const turn2OriginalType = turn2.type;

    const activated = activateJokerPublic(answered.room, { playerId: 'p1', effect: 'questionPrecedente' });
    assert.equal(activated.room.currentTurn.questionId, turn1QuestionId);
    assert.equal(activated.room.currentTurn.type, turn1Type);
    assert.equal(activated.room.currentTurn.jokerInverse, true);
    assert.equal(activated.room.currentTurn.jokerActivated, true);
    assert.deepEqual(activated.room.reglesUsage.jokerPublic, ['p1']);
    assert.deepEqual(activated.effects, [
      {
        type: 'JOKER_ACTIVATED',
        turnNumber: 2,
        activatedBy: 'p1',
        mode: 'questionPrecedente',
        questionId: turn1QuestionId,
        questionType: turn1Type,
      },
    ]);
    // La question jamais montrée du tour 2 retourne bien dans la réserve.
    assert.ok(activated.room.questionPool[turn2OriginalType].top.includes(turn2OriginalQuestionId));

    // La résolution normale qui suit garde trace du recyclage dans l'historique.
    const resolved = submitAnswer(activated.room, { playerId: 'p2', text: 'réponse recyclée' });
    assert.equal(resolved.room.history[1].jokerInverse, true);
  });

  test("indisponible au premier tour de la partie (aucun tour précédent), mais l'effet style reste disponible", () => {
    const room = threePlayerRoom({ maxTurns: 1, regles: { jokerPublic: true, jokerInverse: true } });
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1'], actionTop: ['a1'] }),
      rng: createSequenceRng([0.1, BUCKET_DONT_CARE, 0.0]),
    });
    assert.throws(
      () => activateJokerPublic(start.room, { playerId: 'p2', effect: 'questionPrecedente' }),
      (err) => err.code === 'JOKER_INVERSE_INDISPONIBLE'
    );
    const styleOk = activateJokerPublic(start.room, { playerId: 'p2', effect: 'style', rng: createSequenceRng([0]) });
    assert.equal(styleOk.room.currentTurn.jokerConstraint, JOKER_CONTRAINTES[0]);
  });

  test('sans effet si jokerPublic est désactivé (dépendance sur le joker de base)', () => {
    const room = threePlayerRoom({ maxTurns: 1, regles: { jokerInverse: true } }); // jokerPublic reste false
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1'], actionTop: ['a1'] }),
      rng: createSequenceRng([0.1, BUCKET_DONT_CARE, 0.0]),
    });
    assert.equal(effectiveRegles(start.room).jokerInverse, false);
    assert.throws(
      () => activateJokerPublic(start.room, { playerId: 'p2', effect: 'questionPrecedente' }),
      (err) => err.code === 'REGLE_DISABLED'
    );
  });

  test('un seul joker par tour au total : la consommation est partagée entre les deux effets', () => {
    const room = twoPlayerRoom({ maxTurns: 2, regles: { jokerPublic: true, jokerInverse: true } });
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1', 'v2'], actionTop: ['a1', 'a2'] }),
      rng: createSequenceRng([0.1, BUCKET_DONT_CARE, 0.0]),
    });
    const answered = submitAnswer(start.room, { playerId: 'p1', text: 'réponse 1' });
    const first = activateJokerPublic(answered.room, { playerId: 'p1', effect: 'questionPrecedente' });
    const second = activateJokerPublic(first.room, { playerId: 'p2', effect: 'style', rng: createSequenceRng([0]) });
    assert.deepEqual(second.effects, []);
    assert.equal(second.room.currentTurn.jokerInverse, true);
    assert.equal(second.room.currentTurn.jokerConstraint, null);
    assert.deepEqual(second.room.reglesUsage.jokerPublic, ['p1']);
  });
});

describe('règle G : le bluff assumé (avec mise collective)', () => {
  test('mélange de votes/mises justes et faux, sans majorité dupée : pas de doublement du menteur', () => {
    const room = nPlayerRoom(3, { maxTurns: 1, regles: { bluffAssume: true } });
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1'], actionTop: ['a1'] }),
      rng: createSequenceRng([0.1, BUCKET_DONT_CARE, 0.0]),
    });
    const type = start.room.currentTurn.type;

    const answered = submitAnswer(start.room, { playerId: 'p1', text: 'réponse' });
    const declared = declareBluff(answered.room, { playerId: 'p1' });
    assert.equal(declared.room.currentTurn.bluffDeclared, true);
    assert.deepEqual(declared.effects, [{ type: 'BLUFF_DECLARED', turnNumber: 1 }]);

    const misedP2 = submitBluffMise(declared.room, { playerId: 'p2', montant: 1, prediction: 'faux' });
    const misedP3 = submitBluffMise(misedP2.room, { playerId: 'p3', montant: 2, prediction: 'vrai' });

    const votedP2 = submitVote(misedP3.room, { voterId: 'p2', vote: 'down', turnNumber: 1 });
    const resolved = submitVote(votedP2.room, { voterId: 'p3', vote: 'up', turnNumber: 1 });

    const resolvedEffect = resolved.effects.find((e) => e.type === 'TURN_RESOLVED');
    assert.equal(resolvedEffect.bluffAssume.declared, true);
    assert.equal(resolvedEffect.bluffAssume.fooled, false, '1 up sur 2 votes : pas de majorité dupée');

    const p1Points = resolved.room.players.find((p) => p.id === 'p1').score;
    assert.equal(p1Points, type === 'verite' ? 1 : 2, 'le menteur touche ses points de base, non doublés');

    const p2Score = resolved.room.players.find((p) => p.id === 'p2').score;
    assert.equal(p2Score, 3, 'p2 : +2 (vote juste) +1 (mise juste sur "faux")');

    const p3Score = resolved.room.players.find((p) => p.id === 'p3').score;
    assert.equal(p3Score, -2, 'p3 : +0 (vote faux) -2 (mise perdue sur "vrai")');
  });

  test('majorité dupée : le menteur double ses points de ce tour', () => {
    const room = nPlayerRoom(3, { maxTurns: 1, regles: { bluffAssume: true } });
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1'], actionTop: ['a1'] }),
      rng: createSequenceRng([0.1, BUCKET_DONT_CARE, 0.0]),
    });
    const type = start.room.currentTurn.type;
    const answered = submitAnswer(start.room, { playerId: 'p1', text: 'réponse' });
    const declared = declareBluff(answered.room, { playerId: 'p1' });
    const votedP2 = submitVote(declared.room, { voterId: 'p2', vote: 'up', turnNumber: 1 });
    const resolved = submitVote(votedP2.room, { voterId: 'p3', vote: 'up', turnNumber: 1 });

    const resolvedEffect = resolved.effects.find((e) => e.type === 'TURN_RESOLVED');
    assert.equal(resolvedEffect.bluffAssume.fooled, true, '2 up sur 2 votes : majorité dupée');
    const p1Points = resolved.room.players.find((p) => p.id === 'p1').score;
    assert.equal(p1Points, (type === 'verite' ? 1 : 2) * REGLES.bluffLiarMultiplicateur);
  });

  test('mise placée mais bluff jamais déclaré : annulée, aucun gain ni perte', () => {
    const room = nPlayerRoom(3, { maxTurns: 1, regles: { bluffAssume: true } });
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1'], actionTop: ['a1'] }),
      rng: createSequenceRng([0.1, BUCKET_DONT_CARE, 0.0]),
    });
    const answered = submitAnswer(start.room, { playerId: 'p1', text: 'réponse' });
    const mised = submitBluffMise(answered.room, { playerId: 'p2', montant: 2, prediction: 'faux' });
    const votedP2 = submitVote(mised.room, { voterId: 'p2', vote: 'up', turnNumber: 1 });
    const resolved = submitVote(votedP2.room, { voterId: 'p3', vote: 'up', turnNumber: 1 });

    const resolvedEffect = resolved.effects.find((e) => e.type === 'TURN_RESOLVED');
    assert.equal(resolvedEffect.bluffAssume.declared, false);
    assert.equal(resolvedEffect.bluffAssume.miseResults[0].delta, 0);
    const p2Score = resolved.room.players.find((p) => p.id === 'p2').score;
    assert.equal(p2Score, 0, "la mise n'a aucun effet, le vote normal ne rapporte rien aux votants hors bluff");
  });

  test('validations : déclaration et mise', () => {
    const room = nPlayerRoom(3, { maxTurns: 1, regles: { bluffAssume: true } });
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1'], actionTop: ['a1'] }),
      rng: createSequenceRng([0.1, BUCKET_DONT_CARE, 0.0]),
    });
    const answered = submitAnswer(start.room, { playerId: 'p1', text: 'réponse' });

    assert.throws(
      () => declareBluff(answered.room, { playerId: 'p2' }),
      (err) => err.code === 'NOT_YOUR_TURN'
    );
    const declared = declareBluff(answered.room, { playerId: 'p1' });
    assert.throws(
      () => declareBluff(declared.room, { playerId: 'p1' }),
      (err) => err.code === 'BLUFF_DEJA_DECLARE'
    );

    assert.throws(
      () => submitBluffMise(declared.room, { playerId: 'p1', montant: 1, prediction: 'faux' }),
      (err) => err.code === 'CANNOT_MISE_SELF'
    );
    assert.throws(
      () => submitBluffMise(declared.room, { playerId: 'p2', montant: 3, prediction: 'faux' }),
      (err) => err.code === 'INVALID_MISE'
    );
    assert.throws(
      () => submitBluffMise(declared.room, { playerId: 'p2', montant: 1, prediction: 'peut-etre' }),
      (err) => err.code === 'INVALID_MISE'
    );
    const mised = submitBluffMise(declared.room, { playerId: 'p2', montant: 1, prediction: 'faux' });
    assert.throws(
      () => submitBluffMise(mised.room, { playerId: 'p2', montant: 2, prediction: 'vrai' }),
      (err) => err.code === 'ALREADY_MISE'
    );
  });

  test('désactivé par défaut : REGLE_DISABLED', () => {
    const room = nPlayerRoom(3, { maxTurns: 1 });
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1'], actionTop: ['a1'] }),
      rng: createSequenceRng([0.1, BUCKET_DONT_CARE, 0.0]),
    });
    const answered = submitAnswer(start.room, { playerId: 'p1', text: 'réponse' });
    assert.throws(
      () => declareBluff(answered.room, { playerId: 'p1' }),
      (err) => err.code === 'REGLE_DISABLED'
    );
    assert.throws(
      () => submitBluffMise(answered.room, { playerId: 'p2', montant: 1, prediction: 'faux' }),
      (err) => err.code === 'REGLE_DISABLED'
    );
  });

  test('structurellement indisponible à 2 joueurs (le vote y est toujours sauté)', () => {
    const room = twoPlayerRoom({ maxTurns: 1, regles: { bluffAssume: true } });
    const start = startGame(room, {
      questionPool: pool({ veriteTop: ['v1'], actionTop: ['a1'] }),
      rng: createSequenceRng([0.1, BUCKET_DONT_CARE, 0.0]),
    });
    // À 2 joueurs, submitAnswer résout directement (aucune phase "voting").
    const answered = submitAnswer(start.room, { playerId: 'p1', text: 'réponse' });
    assert.equal(answered.room.currentTurn, null, 'la partie se termine (maxTurns: 1), aucun tour en cours');
  });
});

describe('règle G (variante) : le bluff surprise', () => {
  test('tirage gagnant, coin "menti" : bluffDeclared vrai, le joueur actif ne peut pas déclarer par-dessus', () => {
    const room = nPlayerRoom(3, { maxTurns: 1, regles: { bluffAssume: true, bluffSurprise: true } });
    const start = startGame(room, {
      // [seuil bluff surprise (<0.2), type, panier, index, pile ou face (<0.5)]
      questionPool: pool({ veriteTop: ['v1'], actionTop: ['a1'] }),
      rng: createSequenceRng([0.1, 0.0, BUCKET_DONT_CARE, 0.0, 0.2]),
    });
    assert.equal(start.room.currentTurn.mode, 'normal', 'reste un tour normal, pas un tour surprise classique');
    assert.equal(start.room.currentTurn.bluffSurprise, true);
    assert.equal(start.room.currentTurn.bluffDeclared, true);
    const activePlayerId = start.room.currentTurn.activePlayerId;
    const answered = submitAnswer(start.room, { playerId: activePlayerId, text: 'réponse' });
    assert.throws(
      () => declareBluff(answered.room, { playerId: activePlayerId }),
      (err) => err.code === 'BLUFF_DEJA_DECLARE'
    );
  });

  test('tirage gagnant, coin "sincère" : bluffDeclared faux, mais le joueur actif ne peut toujours pas déclarer', () => {
    const room = nPlayerRoom(3, { maxTurns: 1, regles: { bluffAssume: true, bluffSurprise: true } });
    const start = startGame(room, {
      rng: createSequenceRng([0.1, 0.0, BUCKET_DONT_CARE, 0.0, 0.9]),
      questionPool: pool({ veriteTop: ['v1'], actionTop: ['a1'] }),
    });
    assert.equal(start.room.currentTurn.bluffSurprise, true);
    assert.equal(start.room.currentTurn.bluffDeclared, false, 'le tirage a décidé "sincère" cette fois');
    const activePlayerId = start.room.currentTurn.activePlayerId;
    const answered = submitAnswer(start.room, { playerId: activePlayerId, text: 'réponse' });
    assert.throws(
      () => declareBluff(answered.room, { playerId: activePlayerId }),
      (err) => err.code === 'BLUFF_DEJA_DECLARE',
      "même avec bluffDeclared=false, le joueur n'a pas la main : le jeu a déjà décidé pour lui"
    );
  });

  test('un seul effet par tour : le tour surprise classique prime, le bluff surprise ne se déclenche jamais en plus', () => {
    const room = nPlayerRoom(3, { maxTurns: 1, regles: { tourSurprise: true, bluffAssume: true, bluffSurprise: true } });
    const start = startGame(room, {
      // Seuil du tour surprise classique gagnant (<0.2) : la fonction rend la
      // main immédiatement, jamais de second tirage pour le bluff surprise.
      rng: createSequenceRng([0.1, 0.0, BUCKET_DONT_CARE, 0.0]),
      questionPool: pool({ veriteTop: ['v1'], actionTop: ['a1'] }),
    });
    assert.equal(start.room.currentTurn.mode, 'surprise');
  });

  test("le bluff surprise se déclenche seul quand le tirage du tour surprise classique échoue", () => {
    const room = nPlayerRoom(3, { maxTurns: 1, regles: { tourSurprise: true, bluffAssume: true, bluffSurprise: true } });
    const start = startGame(room, {
      // [échec du seuil tour surprise (>=0.2), succès du seuil bluff surprise (<0.2), type, panier, index, pile ou face]
      rng: createSequenceRng([0.5, 0.1, 0.0, BUCKET_DONT_CARE, 0.0, 0.2]),
      questionPool: pool({ veriteTop: ['v1'], actionTop: ['a1'] }),
    });
    assert.equal(start.room.currentTurn.mode, 'normal');
    assert.equal(start.room.currentTurn.bluffSurprise, true);
  });

  test('masqué sans bluffAssume : jamais de tirage, comportement de tour normal', () => {
    const room = nPlayerRoom(3, { maxTurns: 1, regles: { bluffSurprise: true } }); // bluffAssume reste false
    const start = startGame(room, {
      rng: createSequenceRng([0.1, BUCKET_DONT_CARE, 0.0]),
      questionPool: pool({ veriteTop: ['v1'], actionTop: ['a1'] }),
    });
    assert.equal(effectiveRegles(start.room).bluffSurprise, false);
    assert.equal(start.room.currentTurn.bluffSurprise, false);
  });
});

// ---------- Simulations combinées (toutes les règles ensemble) ----------

function driveSurpriseStep(current, turn) {
  if (turn.phase === 'answering') {
    const next = turn.activePlayerIds.find((id) => turn.answers[id] == null);
    if (next) return submitSurpriseAnswer(current, { playerId: next, text: 'réponse surprise' }).room;
    return surpriseAnswerTimeout(current, { turnNumber: turn.turnNumber }).room;
  }
  if (turn.phase === 'voting') {
    const next = turn.activePlayerIds.find((id) => !turn.votes[id]);
    if (next) {
      const candidates = turn.activePlayerIds.filter((id) => id !== next && turn.answers[id] != null);
      if (candidates.length === 0) {
        return surpriseVoteTimeout(current, { turnNumber: turn.turnNumber }).room;
      }
      const target = candidates[Math.floor(Math.random() * candidates.length)];
      return submitSurpriseVote(current, { voterId: next, targetId: target }).room;
    }
    return surpriseVoteTimeout(current, { turnNumber: turn.turnNumber }).room;
  }
  return current;
}

// Joue une partie jusqu'au bout en prenant, à chaque étape, une action valide
// pour la phase en cours (avec un vrai hasard pour les décisions de règles) —
// but : vérifier que la combinaison des cinq règles ne casse jamais le jeu,
// quelle que soit la séquence d'événements réellement rencontrée.
function driveGameToCompletion(room, { maxSteps = 1000 } = {}) {
  let current = room;
  let steps = 0;
  while (current.status === 'playing' && steps < maxSteps) {
    steps++;
    const turn = current.currentTurn;
    if (!turn) break;

    if (turn.mode === 'surprise') {
      current = driveSurpriseStep(current, turn);
      continue;
    }

    const regles = effectiveRegles(current);

    if (turn.phase === 'niveau_choice') {
      current = respondDoubleOuRien(current, { playerId: turn.activePlayerId, accept: Math.random() < 0.5 }).room;
    } else if (turn.phase === 'question_choice') {
      const choice = turn.choices[Math.floor(Math.random() * turn.choices.length)];
      current = chooseQuestion(current, { playerId: turn.activePlayerId, questionId: choice.questionId }).room;
    } else if (turn.phase === 'answering') {
      if (regles.pariMutuel && turn.pariMutuel && turn.pariMutuel.bet == null && Math.random() < 0.5) {
        const bettorId = current.turnOrder.find((id) => id !== turn.activePlayerId);
        current = submitBet(current, { playerId: bettorId, text: 'pari' }).room;
      } else if (regles.refusCouteux && Math.random() < 0.1) {
        current = submitPass(current, { playerId: turn.activePlayerId }).room;
      } else if (regles.questionRetournee && !turn.returned && !turn.doubleOuRien && Math.random() < 0.1) {
        try {
          current = returnQuestion(current, { playerId: turn.activePlayerId }).room;
        } catch {
          current = submitAnswer(current, { playerId: turn.activePlayerId, text: 'réponse' }).room;
        }
      } else {
        current = submitAnswer(current, { playerId: turn.activePlayerId, text: 'réponse' }).room;
      }
    } else if (turn.phase === 'jugement') {
      current = judgeBet(current, { playerId: turn.activePlayerId, verdict: Math.random() < 0.5 ? 'juste' : 'a_cote' }).room;
    } else if (turn.phase === 'voting') {
      const nextVoter = current.players.find(
        (p) => p.id !== turn.activePlayerId && p.status !== 'left' && !turn.votes[p.id]
      );
      if (nextVoter) {
        current = submitVote(current, {
          voterId: nextVoter.id,
          vote: Math.random() < 0.5 ? 'up' : 'down',
          turnNumber: turn.turnNumber,
        }).room;
      } else {
        current = voteTimeout(current, { turnNumber: turn.turnNumber }).room;
      }
    } else {
      break;
    }
  }
  return current;
}

function bigPool() {
  return pool({
    veriteTop: Array.from({ length: 60 }, (_, i) => `v${i}`),
    actionTop: Array.from({ length: 60 }, (_, i) => `a${i}`),
    veriteEscalade: Array.from({ length: 30 }, (_, i) => `ev${i}`),
    actionEscalade: Array.from({ length: 30 }, (_, i) => `ea${i}`),
  });
}

const ALL_REGLES = {
  refusCouteux: true,
  doubleOuRien: true,
  questionRetournee: true,
  tourSurprise: true,
  pariMutuel: true,
};

describe('simulations combinant les cinq règles', () => {
  test('à 2 joueurs, la partie se termine toujours proprement, quelle que soit la séquence tirée', () => {
    for (let trial = 0; trial < 40; trial++) {
      const room = twoPlayerRoom({ maxTurns: 10, regles: ALL_REGLES });
      const start = startGame(room, { questionPool: bigPool() });
      const final = driveGameToCompletion(start.room);
      assert.equal(final.status, 'finished', `essai ${trial} non terminé`);
      for (const p of final.players) {
        assert.equal(Number.isFinite(p.score), true, `score non fini pour ${p.id} à l'essai ${trial}`);
      }
    }
  });

  test('à 5 joueurs, quatre règles actives (pari mutuel réservé à 2) : aucun crash', () => {
    for (let trial = 0; trial < 40; trial++) {
      let room = createRoom({ code: 'ABCD', hostId: 'p1', hostPseudo: 'A', maxTurns: 10, regles: ALL_REGLES });
      room = addPlayer(room, { id: 'p2', pseudo: 'B' });
      room = addPlayer(room, { id: 'p3', pseudo: 'C' });
      room = addPlayer(room, { id: 'p4', pseudo: 'D' });
      room = addPlayer(room, { id: 'p5', pseudo: 'E' });

      const start = startGame(room, { questionPool: bigPool() });
      const final = driveGameToCompletion(start.room);
      assert.equal(final.status, 'finished', `essai ${trial} non terminé`);
      for (const p of final.players) {
        assert.equal(Number.isFinite(p.score), true, `score non fini pour ${p.id} à l'essai ${trial}`);
      }
    }
  });
});
