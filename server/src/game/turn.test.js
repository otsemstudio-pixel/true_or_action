import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, addPlayer } from './room.js';
import { startGame, submitAnswer, answerTimeout, submitVote, voteTimeout } from './turn.js';
import { GameError } from './errors.js';

function createSequenceRng(values) {
  let i = 0;
  return () => {
    if (i >= values.length) throw new Error('Séquence rng épuisée');
    return values[i++];
  };
}

function threePlayerRoom(settings = {}) {
  let room = createRoom({ code: 'ABCD', hostId: 'p1', hostPseudo: 'A', ...settings });
  room = addPlayer(room, { id: 'p2', pseudo: 'B' });
  room = addPlayer(room, { id: 'p3', pseudo: 'C' });
  return room;
}

describe('startGame', () => {
  test('refuse de démarrer sous le minimum de joueurs', () => {
    const room = createRoom({ code: 'ABCD', hostId: 'p1', hostPseudo: 'A', maxTurns: 3 });
    assert.throws(
      () => startGame(room, { questionPool: { verite: ['v1', 'v2', 'v3'], action: ['a1', 'a2', 'a3'] } }),
      (err) => err.code === 'CANNOT_START'
    );
  });

  test('refuse si les questions sont insuffisantes et indique combien il en manque', () => {
    const room = threePlayerRoom({ maxTurns: 3 });
    assert.throws(
      () => startGame(room, { questionPool: { verite: ['v1'], action: ['a1', 'a2', 'a3'] } }),
      (err) => err.code === 'NOT_ENOUGH_QUESTIONS' && err.details.missing.verite === 2 && err.details.missing.action === 0
    );
  });
});

describe('cycle complet d\'une partie (maxTurns)', () => {
  test('tirage, réponse, vote unanime avec bonus, puis fin de partie', () => {
    const room = threePlayerRoom({ maxTurns: 2 });
    const rng = createSequenceRng([
      0.1, 0.0, // tour 1 : vérité (index 0 -> v1)
      0.9, 0.5, // tour 2 : action (liste ['a1','a2'], index 1 -> a2)
    ]);

    const start = startGame(room, {
      questionPool: { verite: ['v1', 'v2'], action: ['a1', 'a2'] },
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
    const rng = createSequenceRng([0.1, 0.0]);
    const start = startGame(room, {
      questionPool: { verite: ['v1'], action: ['a1'] },
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
    const rng = createSequenceRng([0.1, 0.0, 0.1, 0.0, 0.1, 0.0]);
    const start = startGame(room, {
      questionPool: { verite: ['v1', 'v2', 'v3'], action: ['a1', 'a2', 'a3'] },
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
});

describe('règles de réponse', () => {
  test('seul le joueur actif peut répondre', () => {
    const room = threePlayerRoom({ maxTurns: 1 });
    const rng = createSequenceRng([0.1, 0.0]);
    const start = startGame(room, { questionPool: { verite: ['v1'], action: ['a1'] }, rng });
    assert.throws(
      () => submitAnswer(start.room, { playerId: 'p2', text: 'triche' }),
      (err) => err.code === 'NOT_YOUR_TURN'
    );
  });

  test('refuse une réponse vide', () => {
    const room = threePlayerRoom({ maxTurns: 1 });
    const rng = createSequenceRng([0.1, 0.0]);
    const start = startGame(room, { questionPool: { verite: ['v1'], action: ['a1'] }, rng });
    assert.throws(
      () => submitAnswer(start.room, { playerId: 'p1', text: '   ' }),
      (err) => err.code === 'EMPTY_ANSWER'
    );
  });
});

describe('non-répétition des questions', () => {
  test('une question tirée ne ressort plus dans la même partie', () => {
    const room = threePlayerRoom({ maxTurns: 3 });
    const rng = createSequenceRng([
      0.1, 0.0, // tour 1
      0.1, 0.0, // tour 2
      0.1, 0.0, // tour 3
    ]);
    const start = startGame(room, {
      questionPool: { verite: ['v1', 'v2', 'v3'], action: ['a1', 'a2', 'a3'] },
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
});
