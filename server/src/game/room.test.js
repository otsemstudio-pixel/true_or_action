import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRoom,
  addPlayer,
  removePlayer,
  markDisconnected,
  markReconnected,
  excludePlayer,
  canStart,
} from './room.js';
import { GameError } from './errors.js';

function baseRoom() {
  return createRoom({ code: 'ABCD', hostId: 'p1', hostPseudo: 'Hôte', maxTurns: 5 });
}

describe('createRoom', () => {
  test('rejette un maxTurns invalide', () => {
    assert.throws(
      () => createRoom({ code: 'ABCD', hostId: 'p1', hostPseudo: 'Hôte', maxTurns: 0 }),
      GameError
    );
  });

  test('crée un salon en attente avec l\'hôte comme premier joueur', () => {
    const room = baseRoom();
    assert.equal(room.status, 'waiting');
    assert.equal(room.players.length, 1);
    assert.equal(room.players[0].id, 'p1');
    assert.equal(canStart(room), false);
  });
});

describe('addPlayer', () => {
  test('ajoute des joueurs jusqu\'au minimum jouable', () => {
    let room = baseRoom();
    room = addPlayer(room, { id: 'p2', pseudo: 'B' });
    room = addPlayer(room, { id: 'p3', pseudo: 'C' });
    assert.equal(room.players.length, 3);
    assert.equal(canStart(room), true);
  });

  test('refuse un joueur déjà présent', () => {
    const room = addPlayer(baseRoom(), { id: 'p2', pseudo: 'B' });
    assert.throws(() => addPlayer(room, { id: 'p2', pseudo: 'B' }), (err) => err.code === 'ALREADY_IN_ROOM');
  });

  test('refuse au-delà de 8 joueurs', () => {
    let room = baseRoom();
    for (let i = 2; i <= 8; i++) {
      room = addPlayer(room, { id: `p${i}`, pseudo: `J${i}` });
    }
    assert.equal(room.players.length, 8);
    assert.throws(() => addPlayer(room, { id: 'p9', pseudo: 'Trop' }), (err) => err.code === 'ROOM_FULL');
  });

  test('refuse de rejoindre une partie déjà lancée', () => {
    const room = { ...baseRoom(), status: 'playing' };
    assert.throws(() => addPlayer(room, { id: 'p2', pseudo: 'B' }), (err) => err.code === 'ROOM_NOT_JOINABLE');
  });
});

describe('removePlayer', () => {
  test('transfère l\'hôte quand celui-ci part', () => {
    let room = addPlayer(baseRoom(), { id: 'p2', pseudo: 'B' });
    room = removePlayer(room, 'p1');
    assert.equal(room.players.length, 1);
    assert.equal(room.hostId, 'p2');
  });
});

describe('statut des joueurs', () => {
  test('marque déconnecté puis reconnecté', () => {
    let room = addPlayer(baseRoom(), { id: 'p2', pseudo: 'B' });
    room = markDisconnected(room, 'p2');
    assert.equal(room.players.find((p) => p.id === 'p2').status, 'disconnected');
    room = markReconnected(room, 'p2');
    assert.equal(room.players.find((p) => p.id === 'p2').status, 'active');
  });

  test('exclure retire le joueur de l\'ordre des tours', () => {
    let room = addPlayer(baseRoom(), { id: 'p2', pseudo: 'B' });
    room = { ...room, turnOrder: ['p1', 'p2'] };
    room = excludePlayer(room, 'p2');
    assert.equal(room.players.find((p) => p.id === 'p2').status, 'left');
    assert.deepEqual(room.turnOrder, ['p1']);
  });

  test('erreur sur joueur inconnu', () => {
    assert.throws(() => markDisconnected(baseRoom(), 'inconnu'), (err) => err.code === 'PLAYER_NOT_FOUND');
  });
});
