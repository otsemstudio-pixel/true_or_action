import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRoom,
  updateSettings,
  updateNiveauMax,
  updateMaxPlayers,
  updateLangue,
  addPlayer,
  removePlayer,
  restartRoom,
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

  test('niveau 1 par défaut', () => {
    assert.equal(baseRoom().niveauMax, 1);
  });

  test('rejette un niveau invalide', () => {
    assert.throws(
      () => createRoom({ code: 'ABCD', hostId: 'p1', hostPseudo: 'Hôte', maxTurns: 5, niveauMax: 4 }),
      (err) => err.code === 'INVALID_NIVEAU'
    );
  });

  test('langue fr par défaut', () => {
    assert.equal(baseRoom().langue, 'fr');
  });

  test('accepte la langue en à la création', () => {
    const room = createRoom({ code: 'ABCD', hostId: 'p1', hostPseudo: 'Hôte', maxTurns: 5, langue: 'en' });
    assert.equal(room.langue, 'en');
  });

  test('rejette une langue invalide', () => {
    assert.throws(
      () => createRoom({ code: 'ABCD', hostId: 'p1', hostPseudo: 'Hôte', maxTurns: 5, langue: 'de' }),
      (err) => err.code === 'INVALID_LANGUE'
    );
  });
});

describe('updateLangue', () => {
  test('change la langue tant que le salon attend', () => {
    const room = updateLangue(baseRoom(), 'en');
    assert.equal(room.langue, 'en');
  });

  test('refuse une langue hors fr/en', () => {
    assert.throws(() => updateLangue(baseRoom(), 'de'), (err) => err.code === 'INVALID_LANGUE');
  });

  test('refuse après le lancement de la partie', () => {
    const room = { ...baseRoom(), status: 'playing' };
    assert.throws(() => updateLangue(room, 'en'), (err) => err.code === 'ROOM_NOT_JOINABLE');
  });
});

describe('updateNiveauMax', () => {
  test('change le niveau tant que le salon attend', () => {
    const room = updateNiveauMax(baseRoom(), 2);
    assert.equal(room.niveauMax, 2);
  });

  test('refuse un niveau hors de 1, 2, 3', () => {
    assert.throws(() => updateNiveauMax(baseRoom(), 0), (err) => err.code === 'INVALID_NIVEAU');
    assert.throws(() => updateNiveauMax(baseRoom(), 5), (err) => err.code === 'INVALID_NIVEAU');
  });

  test('refuse après le lancement de la partie', () => {
    const room = { ...baseRoom(), status: 'playing' };
    assert.throws(() => updateNiveauMax(room, 2), (err) => err.code === 'ROOM_NOT_JOINABLE');
  });
});

describe('updateMaxPlayers', () => {
  test('augmente la limite tant que le salon attend', () => {
    const room = updateMaxPlayers(baseRoom(), 20);
    assert.equal(room.maxPlayers, 20);
  });

  test('refuse une limite hors de [2, 20]', () => {
    assert.throws(() => updateMaxPlayers(baseRoom(), 1), (err) => err.code === 'INVALID_MAX_PLAYERS');
    assert.throws(() => updateMaxPlayers(baseRoom(), 21), (err) => err.code === 'INVALID_MAX_PLAYERS');
  });

  test('refuse de descendre sous le nombre de joueurs déjà présents', () => {
    let room = baseRoom();
    room = addPlayer(room, { id: 'p2', pseudo: 'B' });
    room = addPlayer(room, { id: 'p3', pseudo: 'C' });
    assert.throws(() => updateMaxPlayers(room, 2), (err) => err.code === 'MAX_PLAYERS_BELOW_CURRENT');
    // Mais rester à 3 pile, ou monter, reste permis.
    assert.equal(updateMaxPlayers(room, 3).maxPlayers, 3);
  });

  test('refuse après le lancement de la partie', () => {
    const room = { ...baseRoom(), status: 'playing' };
    assert.throws(() => updateMaxPlayers(room, 10), (err) => err.code === 'ROOM_NOT_JOINABLE');
  });
});

describe('updateSettings', () => {
  test('change le mode de fin de partie tant que le salon attend', () => {
    const room = updateSettings(baseRoom(), { targetScore: 20 });
    assert.deepEqual(room.settings, { maxTurns: null, targetScore: 20 });
  });

  test('refuse si aucun des deux réglages n\'est fourni', () => {
    assert.throws(
      () => updateSettings(baseRoom(), {}),
      (err) => err.code === 'INVALID_SETTINGS'
    );
  });

  test('refuse après le lancement de la partie', () => {
    const room = { ...baseRoom(), status: 'playing' };
    assert.throws(
      () => updateSettings(room, { maxTurns: 5 }),
      (err) => err.code === 'ROOM_NOT_JOINABLE'
    );
  });
});

describe('addPlayer', () => {
  test('peut lancer dès 2 joueurs (minimum abaissé)', () => {
    const room = addPlayer(baseRoom(), { id: 'p2', pseudo: 'B' });
    assert.equal(room.players.length, 2);
    assert.equal(canStart(room), true);
  });

  test('ne peut pas lancer à 1 seul joueur', () => {
    assert.equal(canStart(baseRoom()), false);
  });

  test('refuse un joueur déjà présent', () => {
    const room = addPlayer(baseRoom(), { id: 'p2', pseudo: 'B' });
    assert.throws(() => addPlayer(room, { id: 'p2', pseudo: 'B' }), (err) => err.code === 'ALREADY_IN_ROOM');
  });

  test('refuse au-delà de 8 joueurs (limite par défaut)', () => {
    let room = baseRoom();
    for (let i = 2; i <= 8; i++) {
      room = addPlayer(room, { id: `p${i}`, pseudo: `J${i}` });
    }
    assert.equal(room.players.length, 8);
    assert.throws(() => addPlayer(room, { id: 'p9', pseudo: 'Trop' }), (err) => err.code === 'ROOM_FULL');
  });

  test("respecte une limite personnalisée jusqu'à 20 joueurs", () => {
    let room = createRoom({ code: 'ABCD', hostId: 'p1', hostPseudo: 'Hôte', maxTurns: 5, maxPlayers: 20 });
    for (let i = 2; i <= 20; i++) {
      room = addPlayer(room, { id: `p${i}`, pseudo: `J${i}` });
    }
    assert.equal(room.players.length, 20);
    assert.throws(() => addPlayer(room, { id: 'p21', pseudo: 'Trop' }), (err) => err.code === 'ROOM_FULL');
  });

  test('refuse une limite personnalisée hors de [2, 20] à la création', () => {
    assert.throws(
      () => createRoom({ code: 'ABCD', hostId: 'p1', hostPseudo: 'Hôte', maxTurns: 5, maxPlayers: 1 }),
      (err) => err.code === 'INVALID_MAX_PLAYERS'
    );
    assert.throws(
      () => createRoom({ code: 'ABCD', hostId: 'p1', hostPseudo: 'Hôte', maxTurns: 5, maxPlayers: 21 }),
      (err) => err.code === 'INVALID_MAX_PLAYERS'
    );
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

  test('refuse de quitter une partie en cours', () => {
    const room = { ...baseRoom(), status: 'playing' };
    assert.throws(() => removePlayer(room, 'p1'), (err) => err.code === 'ROOM_NOT_JOINABLE');
  });

  test('autorise à quitter une partie terminée', () => {
    const room = { ...baseRoom(), status: 'finished' };
    const result = removePlayer(room, 'p1');
    assert.equal(result.players.length, 0);
  });
});

describe('restartRoom', () => {
  test('remet le salon en attente avec les scores à zéro', () => {
    let room = addPlayer(baseRoom(), { id: 'p2', pseudo: 'B' });
    room = {
      ...room,
      status: 'finished',
      players: room.players.map((p) => ({ ...p, score: 42 })),
      turnNumber: 5,
      history: [{ turnNumber: 1 }],
    };

    const restarted = restartRoom(room);
    assert.equal(restarted.status, 'waiting');
    assert.equal(restarted.turnNumber, 0);
    assert.deepEqual(restarted.history, []);
    assert.equal(restarted.currentTurn, null);
    assert.ok(restarted.players.every((p) => p.score === 0));
  });

  test('retire les joueurs ayant quitté (left)', () => {
    let room = addPlayer(baseRoom(), { id: 'p2', pseudo: 'B' });
    room = {
      ...room,
      status: 'finished',
      players: [room.players[0], { ...room.players[1], status: 'left' }],
    };
    const restarted = restartRoom(room);
    assert.equal(restarted.players.length, 1);
  });

  test('refuse si la partie n\'est pas terminée', () => {
    assert.throws(() => restartRoom(baseRoom()), (err) => err.code === 'ROOM_NOT_FINISHED');
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
