import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, addPlayer, chooseCarteJoker } from './room.js';
import { REGLES } from './constants.js';
import {
  startGame,
  submitAnswer,
  submitVote,
  voteTimeout,
  submitPass,
  declareBluff,
  submitBluffMise,
  submitSurpriseAnswer,
  submitSurpriseVote,
  handlePlayerLeft,
  questionChoiceTimeout,
} from './turn.js';
import {
  JOKER_IDS,
  fideleBonusDueForNextTurn,
  metronomeStreakBefore,
  hasUsedIncrevable,
  rituelStreakBefore,
  hasUsedMasque,
  limierBonusDueForNextOpportunity,
  sceptiquePerpetuelVoteCount,
} from './jokers.js';

function createSequenceRng(values) {
  let i = 0;
  return () => {
    if (i >= values.length) throw new Error('Séquence rng épuisée');
    return values[i++];
  };
}

const BUCKET_DONT_CARE = 0.5;

// Grands réservoirs : les jokers se testent sur de nombreux tours d'affilée,
// bien plus qu'une partie de test habituelle dans turn.test.js.
function bigPool() {
  const verite = Array.from({ length: 40 }, (_, i) => `v${i}`);
  const action = Array.from({ length: 40 }, (_, i) => `a${i}`);
  return { verite: { top: verite, lower: [] }, action: { top: action, lower: [] }, escalade: { verite: [], action: [] } };
}

// [type, bucket(ignoré), index] — index toujours 0.0 pour piocher le premier
// restant, ordre de tirage donc prévisible (v0, v1, v2... puis a0, a1...
// selon l'alternance vérité/action décidée par le premier chiffre).
function normalTurnRng() {
  return [0.1, BUCKET_DONT_CARE, 0.0];
}

// Un refus (règle A) ouvre un choix parmi 3 questions pour le joueur suivant
// dès que la partie continue : 1 tirage de type + 3 propositions (bucket +
// index chacune), consommés par submitPass lui-même avant même de démarrer
// le tour suivant — jamais les 3 valeurs d'un tirage de tour normal.
function passRng() {
  return [0.1, 0.1, 0.0, 0.1, 0.0, 0.1, 0.0];
}

// Fait jouer et voter tous les joueurs d'un tour normal jusqu'à résolution,
// quel que soit le nombre de joueurs (le vote est sauté à 2, requis à partir
// de 3 — voir submitAnswer/submitVote dans turn.js). `nextTurnRng` alimente
// le tirage du tour suivant, consommé par le dernier vote qui fait atteindre
// le quorum (ou par submitAnswer lui-même à 2 joueurs).
// `mises` : { voterId: { montant, prediction } }, soumises juste après la
// déclaration de bluff (avant les votes) — comme un vrai client le ferait.
function playNormalTurn(room, { text = 'réponse', bluff = false, votes, mises, nextTurnRng = normalTurnRng() } = {}) {
  const activeId = room.currentTurn.activePlayerId;
  const others = room.players.map((p) => p.id).filter((id) => id !== activeId);
  const onlyTwoPlayers = room.turnOrder.length <= 2;

  let cur = submitAnswer(room, { playerId: activeId, text, rng: onlyTwoPlayers ? createSequenceRng(nextTurnRng) : undefined });
  if (onlyTwoPlayers) return cur;

  if (bluff) {
    cur = declareBluff(cur.room, { playerId: activeId });
  }
  for (const [voterId, mise] of Object.entries(mises ?? {})) {
    cur = submitBluffMise(cur.room, { playerId: voterId, montant: mise.montant, prediction: mise.prediction });
  }
  const voteValues = votes ?? others.map(() => 'up');
  for (let i = 0; i < others.length; i++) {
    const isLast = i === others.length - 1;
    cur = submitVote(cur.room, {
      voterId: others[i],
      vote: voteValues[i],
      turnNumber: cur.room.currentTurn.turnNumber,
      rng: isLast ? createSequenceRng(nextTurnRng) : undefined,
    });
  }
  return cur;
}

function withJoker(room, playerId, jokerId) {
  return { ...room, players: room.players.map((p) => (p.id === playerId ? { ...p, carteJoker: jokerId } : p)) };
}

function scoreOf(room, playerId) {
  return room.players.find((p) => p.id === playerId).score;
}

// p1/p2 alternent (salon à 2 joueurs) : le vote est sauté (voir turn.js,
// room.turnOrder.length <= 2), chaque réponse résout donc le tour
// immédiatement — la façon la plus simple d'enchaîner de nombreux tours.
function twoPlayerRoom(settings = {}) {
  const room = createRoom({ code: 'ABCD', hostId: 'p1', hostPseudo: 'A', maxTurns: 20, ...settings });
  return addPlayer(room, { id: 'p2', pseudo: 'B' });
}

// Catégorie Bluff et jugement : le bluff assumé exige la phase de vote,
// sautée à 2 joueurs (voir twoPlayerRoom ci-dessus) — il en faut au moins 3.
function threePlayerBluffRoom(settings = {}) {
  let room = createRoom({ code: 'ABCD', hostId: 'p1', hostPseudo: 'A', maxTurns: 20, regles: { bluffAssume: true }, ...settings });
  room = addPlayer(room, { id: 'p2', pseudo: 'B' });
  room = addPlayer(room, { id: 'p3', pseudo: 'C' });
  return room;
}

describe('Le fidèle', () => {
  test('le bonus arrive exactement au 4e tour propre du joueur (pas avant, pas après), puis repart de zéro', () => {
    let room = withJoker(twoPlayerRoom(), 'p1', JOKER_IDS.LE_FIDELE);
    let cur = startGame(room, { questionPool: bigPool(), rng: createSequenceRng(normalTurnRng()) });

    // Tours propres de p1 : 1, 3, 5, 7, 9 (p2 joue 2, 4, 6, 8 entre-temps).
    // Aucune règle de bluff active : chaque réponse est trivialement sincère.
    const scoresAfterOwnTurn = [];
    for (let i = 0; i < 5; i++) {
      cur = submitAnswer(cur.room, { playerId: 'p1', text: `p1-${i}` });
      scoresAfterOwnTurn.push(scoreOf(cur.room, 'p1'));
      cur = submitAnswer(cur.room, { playerId: 'p2', text: `p2-${i}`, rng: createSequenceRng(normalTurnRng()) });
    }

    // POINTS.verite = 1 par tour normalement. +1 attendu uniquement au 4e
    // tour propre de p1 (score cumulé : 1,2,3,5,6 — le saut de 3 à 5 marque
    // le bonus), jamais au 3e (fin du premier palier) ni au 5e (déjà consommé).
    const deltas = scoresAfterOwnTurn.map((s, i) => (i === 0 ? s : s - scoresAfterOwnTurn[i - 1]));
    assert.deepEqual(deltas, [1, 1, 1, 2, 1], 'le bonus doit tomber uniquement sur le 4e tour propre (delta 2 = 1 normal + 1 bonus)');
  });

  test('un bluff déclaré casse la série ; un tour passé (refus qui coûte) reste neutre', () => {
    // 3 joueurs : déclarer un bluff exige la phase de vote (voir declareBluff),
    // sautée à 2 joueurs (résolution immédiate après la réponse) — il en faut
    // donc au moins 3 pour que ce scénario soit même atteignable.
    let room = createRoom({
      code: 'ABCD',
      hostId: 'p1',
      hostPseudo: 'A',
      maxTurns: 20,
      regles: { bluffAssume: true, refusCouteux: true },
    });
    room = addPlayer(room, { id: 'p2', pseudo: 'B' });
    room = addPlayer(room, { id: 'p3', pseudo: 'C' });
    room = withJoker(room, 'p1', JOKER_IDS.LE_FIDELE);
    let cur = startGame(room, { questionPool: bigPool(), rng: createSequenceRng(normalTurnRng()) });

    // Tour propre 1 de p1 (sincère), p2 et p3 jouent leur tour normalement.
    cur = playNormalTurn(cur.room, { text: 'sincère' });
    cur = playNormalTurn(cur.room);
    cur = playNormalTurn(cur.room);

    // Tour propre 2 de p1 : bluff déclaré — la série ne doit jamais
    // atteindre 3, le bonus ne doit donc jamais se déclencher.
    cur = playNormalTurn(cur.room, { text: 'menteur', bluff: true, votes: ['down', 'down'] });
    assert.equal(
      fideleBonusDueForNextTurn(cur.room.history, 'p1'),
      false,
      'le tour de bluff vient de casser la série, aucun bonus en attente'
    );
    cur = playNormalTurn(cur.room);
    cur = playNormalTurn(cur.room);

    // Deux tours sincères de p1, puis un REFUS (règle A) : ni pour ni contre,
    // la série (2) doit rester intacte, pas remise à zéro par le refus.
    cur = playNormalTurn(cur.room, { text: 'sincère 2' });
    cur = playNormalTurn(cur.room);
    cur = playNormalTurn(cur.room);
    cur = playNormalTurn(cur.room, { text: 'sincère 3' });
    cur = playNormalTurn(cur.room);
    cur = playNormalTurn(cur.room);
    assert.equal(fideleBonusDueForNextTurn(cur.room.history, 'p1'), false, 'seulement 2 tours sincères pour l’instant');

    const passed = submitPass(cur.room, { playerId: 'p1', rng: createSequenceRng(passRng()) });
    assert.equal(
      fideleBonusDueForNextTurn(passed.room.history, 'p1'),
      false,
      'un refus est neutre : il ne complète jamais la série à lui seul'
    );
  });
});

describe('Le métronome', () => {
  test('+2 immédiats exactement au 5e tour propre sans refus, puis le compteur repart de zéro', () => {
    let room = withJoker(twoPlayerRoom({ regles: { refusCouteux: true } }), 'p1', JOKER_IDS.LE_METRONOME);
    let cur = startGame(room, { questionPool: bigPool(), rng: createSequenceRng(normalTurnRng()) });

    const scores = [];
    for (let i = 0; i < 6; i++) {
      cur = submitAnswer(cur.room, { playerId: 'p1', text: `p1-${i}` });
      scores.push(scoreOf(cur.room, 'p1'));
      cur = submitAnswer(cur.room, { playerId: 'p2', text: `p2-${i}`, rng: createSequenceRng(normalTurnRng()) });
    }
    const deltas = scores.map((s, i) => (i === 0 ? s : s - scores[i - 1]));
    // 5e tour propre (index 4) : delta 3 = 1 normal + 2 bonus. 6e (index 5) :
    // le compteur vient de repartir de zéro, retour à un delta normal de 1.
    assert.deepEqual(deltas, [1, 1, 1, 1, 3, 1]);
  });

  test('un refus remet le compteur à zéro (contrairement à Le fidèle)', () => {
    let room = withJoker(twoPlayerRoom({ regles: { refusCouteux: true } }), 'p1', JOKER_IDS.LE_METRONOME);
    let cur = startGame(room, { questionPool: bigPool(), rng: createSequenceRng(normalTurnRng()) });

    cur = submitAnswer(cur.room, { playerId: 'p1', text: 'p1-0' });
    cur = submitAnswer(cur.room, { playerId: 'p2', text: 'p2-0', rng: createSequenceRng(normalTurnRng()) });
    cur = submitAnswer(cur.room, { playerId: 'p1', text: 'p1-1' });
    cur = submitAnswer(cur.room, { playerId: 'p2', text: 'p2-1', rng: createSequenceRng(normalTurnRng()) });
    assert.equal(metronomeStreakBefore(cur.room.history, 'p1'), 2);

    const passed = submitPass(cur.room, { playerId: 'p1', rng: createSequenceRng(passRng()) });
    assert.equal(metronomeStreakBefore(passed.room.history, 'p1'), 0, 'le refus casse la série (contrairement à Le fidèle)');
  });
});

describe("L'increvable", () => {
  test('annule uniquement la toute première perte de points via le refus qui coûte', () => {
    let room = withJoker(twoPlayerRoom({ regles: { refusCouteux: true } }), 'p1', JOKER_IDS.LINCREVABLE);
    const start = startGame(room, { questionPool: bigPool(), rng: createSequenceRng(normalTurnRng()) });

    const firstPass = submitPass(start.room, { playerId: 'p1', rng: createSequenceRng(passRng()) });
    assert.equal(scoreOf(firstPass.room, 'p1'), 0, 'la toute première perte est annulée (0, pas -2)');
    assert.equal(hasUsedIncrevable(firstPass.room.history, 'p1'), true);

    // Un refus force un choix parmi 3 questions pour le joueur suivant (règle
    // A) : p2 doit d'abord recevoir sa question avant de pouvoir répondre.
    const p2Choice = questionChoiceTimeout(firstPass.room, { turnNumber: 2 });
    const p2Turn = submitAnswer(p2Choice.room, { playerId: 'p2', text: 'p2', rng: createSequenceRng(normalTurnRng()) });
    // p1 refuse une seconde fois : cette fois le malus normal s'applique.
    const secondPass = submitPass(p2Turn.room, { playerId: 'p1', rng: createSequenceRng(passRng()) });
    assert.equal(scoreOf(secondPass.room, 'p1'), -2, 'la seconde perte, elle, est bien appliquée normalement');
  });

  test("ne s'applique jamais à un autre joueur que celui qui porte le joker", () => {
    let room = withJoker(twoPlayerRoom({ regles: { refusCouteux: true } }), 'p1', JOKER_IDS.LINCREVABLE);
    const start = startGame(room, { questionPool: bigPool(), rng: createSequenceRng(normalTurnRng()) });
    const p1Turn = submitAnswer(start.room, { playerId: 'p1', text: 'p1', rng: createSequenceRng(normalTurnRng()) });
    const p2Passed = submitPass(p1Turn.room, { playerId: 'p2', rng: createSequenceRng(passRng()) });
    assert.equal(scoreOf(p2Passed.room, 'p2'), -2, "p2 ne porte pas le joker, le malus normal s'applique");
  });
});

describe('Le vétéran', () => {
  test('+1 automatique tous les 5 tours de la partie entière, pas 5 tours du porteur', () => {
    // p1 porte le joker mais ne joue qu'un tour sur trois (salon à 3 joueurs) :
    // le palier de 5 doit quand même tomber sur le tour global n°5, pas
    // attendre que p1 ait lui-même joué 5 fois.
    let room = createRoom({ code: 'ABCD', hostId: 'p1', hostPseudo: 'A', maxTurns: 10 });
    room = addPlayer(room, { id: 'p2', pseudo: 'B' });
    room = addPlayer(room, { id: 'p3', pseudo: 'C' });
    room = withJoker(room, 'p1', JOKER_IDS.LE_VETERAN);

    let cur = startGame(room, { questionPool: bigPool(), rng: createSequenceRng(normalTurnRng()) });
    const scoresBeforeEachTurn = [];
    for (let i = 0; i < 5; i++) {
      scoresBeforeEachTurn.push(scoreOf(cur.room, 'p1'));
      cur = playNormalTurn(cur.room, { text: `t${i}` });
    }
    // Score de p1 avant le tour global n°5 vs juste après : doit inclure +1
    // vétéran en plus de ses gains normaux (que p1 y soit actif ou non — ici
    // p1 joue les tours 1 et 4, le tour global n°5 est donc joué par p2).
    assert.equal(cur.room.history[4].playerId, 'p2', 'vérifie l’hypothèse du test : p1 n’est pas actif sur le tour n°5');
    const beforeTurn5 = scoresBeforeEachTurn[4];
    const afterTurn5 = scoreOf(cur.room, 'p1');
    assert.equal(afterTurn5 - beforeTurn5, 1, 'le tour global n°5 doit verser le bonus vétéran à p1 même si ce n’est pas son tour');
  });

  test('ne verse rien à un porteur qui a quitté le salon', () => {
    // 3 joueurs : p2 (porteur) quitte, la partie continue avec p1/p3 (sinon,
    // à 2 joueurs, le départ de l'un finirait la partie — voir handlePlayerLeft).
    let room = createRoom({ code: 'ABCD', hostId: 'p1', hostPseudo: 'A', maxTurns: 10 });
    room = addPlayer(room, { id: 'p2', pseudo: 'B' });
    room = addPlayer(room, { id: 'p3', pseudo: 'C' });
    room = withJoker(room, 'p2', JOKER_IDS.LE_VETERAN);
    let cur = startGame(room, { questionPool: bigPool(), rng: createSequenceRng(normalTurnRng()) });

    const left = handlePlayerLeft(cur.room, 'p2');
    cur = { room: left.room };
    const scoreP2Before = cur.room.players.find((p) => p.id === 'p2').score;

    for (let i = 0; i < 5; i++) {
      assert.notEqual(cur.room.currentTurn.activePlayerId, 'p2', 'un joueur parti ne doit plus jamais redevenir actif');
      cur = playNormalTurn(cur.room, { text: `t${i}` });
    }
    const p2Final = cur.room.players.find((p) => p.id === 'p2');
    assert.equal(p2Final.score, scoreP2Before, "un joueur parti ne touche jamais le bonus vétéran, même au bon palier de 5");
  });
});

describe('Le rituel', () => {
  // Salon à 2 joueurs en tour surprise : p1 répond systématiquement en
  // premier sur les 3 premiers tours, jamais consécutifs "dans l'ordre de la
  // partie" au sens strict puisque CE SONT tous les tours ici — seul compte
  // l'ordre parmi les tours surprise auxquels p1 participe, comme convenu.
  test('bonus exactement au 3e tour surprise où le porteur répond le premier, jamais avant', () => {
    let room = createRoom({
      code: 'ABCD',
      hostId: 'p1',
      hostPseudo: 'A',
      maxTurns: 3,
      regles: { tourSurprise: true },
    });
    room = addPlayer(room, { id: 'p2', pseudo: 'B' });
    room = withJoker(room, 'p1', JOKER_IDS.LE_RITUEL);

    // Chaque tour : [seuil surprise (<0.2), type, panier, index].
    const start = startGame(room, { questionPool: bigPool(), rng: createSequenceRng([0.1, 0.1, BUCKET_DONT_CARE, 0.0]) });
    assert.equal(start.room.currentTurn.mode, 'surprise');

    function playSurpriseTurn(room, { nextTurnRng = [] } = {}) {
      const a1 = submitSurpriseAnswer(room, { playerId: 'p1', text: 'rp1' }); // p1 toujours premier
      const a2 = submitSurpriseAnswer(a1.room, { playerId: 'p2', text: 'rp2' });
      const v1 = submitSurpriseVote(a2.room, { voterId: 'p1', targetId: 'p2' });
      return submitSurpriseVote(v1.room, { voterId: 'p2', targetId: 'p1', rng: createSequenceRng(nextTurnRng) });
    }

    const scores = [scoreOf(start.room, 'p1')];
    let cur = start;
    for (let i = 0; i < 3; i++) {
      const nextTurnRng = i < 2 ? [0.1, 0.1, BUCKET_DONT_CARE, 0.0] : []; // 3e tour : maxTurns atteint, partie finie, aucun tirage suivant
      cur = playSurpriseTurn(cur.room, { nextTurnRng });
      scores.push(scoreOf(cur.room, 'p1'));
    }

    const deltas = [scores[1] - scores[0], scores[2] - scores[1], scores[3] - scores[2]];
    // Chaque tour verse le même gain de base (les deux joueurs se votent
    // mutuellement, égalité à 2 votes -> tous deux "gagnants" à égalité,
    // peu importe le montant exact) ; seul le 3e doit ajouter +1 de plus.
    assert.equal(deltas[0], deltas[1], 'les deux premiers tours doivent verser exactement le même gain de base (pas encore de bonus)');
    assert.equal(deltas[2], deltas[0] + 1, 'le 3e tour où p1 répond premier doit ajouter le bonus, en plus de son gain normal');
  });

  test('ne se déclenche jamais pour un joueur qui ne répond pas le premier', () => {
    let room = createRoom({
      code: 'ABCD',
      hostId: 'p1',
      hostPseudo: 'A',
      maxTurns: 3,
      regles: { tourSurprise: true },
    });
    room = addPlayer(room, { id: 'p2', pseudo: 'B' });
    room = withJoker(room, 'p2', JOKER_IDS.LE_RITUEL); // p2 porte le joker mais répond toujours en second

    const start = startGame(room, { questionPool: bigPool(), rng: createSequenceRng([0.1, 0.1, BUCKET_DONT_CARE, 0.0]) });

    function playSurpriseTurn(room, { nextTurnRng = [] } = {}) {
      const a1 = submitSurpriseAnswer(room, { playerId: 'p1', text: 'rp1' });
      const a2 = submitSurpriseAnswer(a1.room, { playerId: 'p2', text: 'rp2' }); // p2 toujours second
      const v1 = submitSurpriseVote(a2.room, { voterId: 'p1', targetId: 'p2' });
      return submitSurpriseVote(v1.room, { voterId: 'p2', targetId: 'p1', rng: createSequenceRng(nextTurnRng) });
    }

    let cur = start;
    for (let i = 0; i < 3; i++) {
      const nextTurnRng = i < 2 ? [0.1, 0.1, BUCKET_DONT_CARE, 0.0] : [];
      cur = playSurpriseTurn(cur.room, { nextTurnRng });
    }
    assert.equal(rituelStreakBefore(cur.room.history, 'p2'), 0, 'p2 ne répond jamais premier, la série ne doit jamais progresser');
  });
});

describe('reconnexion : les compteurs de jokers ne se recalculent que depuis room.history', () => {
  // Même vigilance que pour room.history (corrigé précédemment) : ces
  // fonctions ne prennent QUE `history` en paramètre, jamais un état en
  // mémoire à part — un historique reconstruit à l'identique après une
  // reconnexion donne donc, par construction, exactement le même résultat.
  test('un compteur partiel donne le même résultat avant et après un "aller-retour" par une structure équivalente à une reconstruction', () => {
    let room = withJoker(twoPlayerRoom({ regles: { refusCouteux: true } }), 'p1', JOKER_IDS.LE_METRONOME);
    let cur = startGame(room, { questionPool: bigPool(), rng: createSequenceRng(normalTurnRng()) });
    for (let i = 0; i < 3; i++) {
      cur = submitAnswer(cur.room, { playerId: 'p1', text: `p1-${i}` });
      cur = submitAnswer(cur.room, { playerId: 'p2', text: `p2-${i}`, rng: createSequenceRng(normalTurnRng()) });
    }
    const before = metronomeStreakBefore(cur.room.history, 'p1');
    assert.equal(before, 3);

    // "Reconnexion" : un nouvel objet history, structurellement identique
    // mais sans aucune référence partagée avec l'original (voir
    // reconstruct.test.js pour la version qui passe par un vrai round-trip
    // buildHistoryFromRows sur des lignes de base).
    const reconstructed = JSON.parse(JSON.stringify(cur.room.history));
    assert.equal(metronomeStreakBefore(reconstructed, 'p1'), before, 'aucune perte de progression après reconstruction');
  });
});

describe('Phase 3 : acquisition en début de partie', () => {
  test('un joueur peut choisir une carte joker tant que la partie est en attente, et en changer librement', () => {
    let room = createRoom({ code: 'ABCD', hostId: 'p1', hostPseudo: 'A', maxTurns: 3, regles: { carteJoker: true } });
    room = addPlayer(room, { id: 'p2', pseudo: 'B' });

    room = chooseCarteJoker(room, { playerId: 'p1', carteJokerId: JOKER_IDS.LE_FIDELE });
    assert.equal(room.players.find((p) => p.id === 'p1').carteJoker, JOKER_IDS.LE_FIDELE);

    // Changement d'avis avant le lancement : toujours permis.
    room = chooseCarteJoker(room, { playerId: 'p1', carteJokerId: JOKER_IDS.LE_METRONOME });
    assert.equal(room.players.find((p) => p.id === 'p1').carteJoker, JOKER_IDS.LE_METRONOME);
  });

  test('refuse si la règle carteJoker n’est pas activée', () => {
    let room = createRoom({ code: 'ABCD', hostId: 'p1', hostPseudo: 'A', maxTurns: 3 });
    assert.throws(
      () => chooseCarteJoker(room, { playerId: 'p1', carteJokerId: JOKER_IDS.LE_FIDELE }),
      (err) => err.code === 'REGLE_DISABLED'
    );
  });

  test('refuse un identifiant de carte joker inconnu', () => {
    let room = createRoom({ code: 'ABCD', hostId: 'p1', hostPseudo: 'A', maxTurns: 3, regles: { carteJoker: true } });
    assert.throws(
      () => chooseCarteJoker(room, { playerId: 'p1', carteJokerId: 'carteInexistante' }),
      (err) => err.code === 'INVALID_CARTE_JOKER'
    );
  });

  test('refuse tout changement une fois la partie lancée', () => {
    let room = createRoom({ code: 'ABCD', hostId: 'p1', hostPseudo: 'A', maxTurns: 3, regles: { carteJoker: true } });
    room = addPlayer(room, { id: 'p2', pseudo: 'B' });
    room = chooseCarteJoker(room, { playerId: 'p1', carteJokerId: JOKER_IDS.LE_FIDELE });
    room = chooseCarteJoker(room, { playerId: 'p2', carteJokerId: JOKER_IDS.LE_METRONOME });
    const started = startGame(room, { questionPool: bigPool(), rng: createSequenceRng(normalTurnRng()) });

    assert.throws(
      () => chooseCarteJoker(started.room, { playerId: 'p1', carteJokerId: JOKER_IDS.LE_RITUEL }),
      (err) => err.code === 'ROOM_NOT_JOINABLE',
      'aucun changement possible "en cours de route", comme demandé'
    );
  });

  test('le lancement est refusé tant que tous les joueurs n’ont pas choisi', () => {
    let room = createRoom({ code: 'ABCD', hostId: 'p1', hostPseudo: 'A', maxTurns: 3, regles: { carteJoker: true } });
    room = addPlayer(room, { id: 'p2', pseudo: 'B' });
    room = chooseCarteJoker(room, { playerId: 'p1', carteJokerId: JOKER_IDS.LE_FIDELE });
    // p2 n'a encore rien choisi.
    assert.throws(
      () => startGame(room, { questionPool: bigPool(), rng: createSequenceRng(normalTurnRng()) }),
      (err) => err.code === 'CARTE_JOKER_MANQUANTE'
    );

    room = chooseCarteJoker(room, { playerId: 'p2', carteJokerId: JOKER_IDS.LE_VETERAN });
    const started = startGame(room, { questionPool: bigPool(), rng: createSequenceRng(normalTurnRng()) });
    assert.equal(started.room.status, 'playing', 'une fois tout le monde équipé, la partie démarre normalement');
  });

  test('sans la règle carteJoker, le lancement ne dépend jamais du champ (comportement inchangé)', () => {
    let room = createRoom({ code: 'ABCD', hostId: 'p1', hostPseudo: 'A', maxTurns: 3 });
    room = addPlayer(room, { id: 'p2', pseudo: 'B' });
    const started = startGame(room, { questionPool: bigPool(), rng: createSequenceRng(normalTurnRng()) });
    assert.equal(started.room.status, 'playing');
  });
});

// ---------- Catégorie Bluff et jugement ----------
// Voir le préalable du prompt : bluffDeclared est un booléen auto-déclaré,
// jamais vérifié contre une vérité de fond — "deviner juste" ne signifie
// donc jamais rien de plus que "concorder avec bluffDeclared" partout ici.

describe('Le parieur', () => {
  test('une mise correcte sur le bluff d’un autre rapporte le double du gain normal', () => {
    let room = withJoker(threePlayerBluffRoom(), 'p2', JOKER_IDS.LE_PARIEUR);
    let cur = startGame(room, { questionPool: bigPool(), rng: createSequenceRng(normalTurnRng()) });

    const before = scoreOf(cur.room, 'p2');
    // p1 actif ment ; p2 mise 2 sur "faux" (il pense qu'il a menti = deviné juste).
    cur = playNormalTurn(cur.room, {
      text: 'menteur',
      bluff: true,
      mises: { p2: { montant: 2, prediction: 'faux' } },
      votes: ['up', 'up'], // p2 puis p3, sans rapport avec la mise elle-même
    });
    const after = scoreOf(cur.room, 'p2');
    assert.equal(after - before, 4, 'gain normal +2 (le montant) ; avec Le parieur, +4 (le double)');
  });

  test('une mise incorrecte fait perdre le double de la mise, y compris en score négatif', () => {
    let room = withJoker(threePlayerBluffRoom(), 'p2', JOKER_IDS.LE_PARIEUR);
    let cur = startGame(room, { questionPool: bigPool(), rng: createSequenceRng(normalTurnRng()) });

    // p2 mise 2 sur "vrai" (il pense qu'il est sincère) alors que p1 ment : deviné faux.
    cur = playNormalTurn(cur.room, {
      text: 'menteur',
      bluff: true,
      mises: { p2: { montant: 2, prediction: 'vrai' } },
      votes: ['up', 'up'],
    });
    const after = scoreOf(cur.room, 'p2');
    // Aucun autre gain pour p2 sur ce tour (il n'est pas l'actif, son vote de
    // qualité n'a pas d'effet distinct ici) : le score reflète uniquement la
    // perte doublée, déjà négative depuis un score de départ à 0.
    assert.equal(after, -4, 'perte normale -2 (la mise) ; avec Le parieur, -4 (le double) — score négatif, comme ailleurs dans le jeu (règle A)');
  });

  test('ne double jamais la mise d’un joueur qui ne porte pas ce joker', () => {
    const room = threePlayerBluffRoom(); // personne ne porte Le parieur
    let cur = startGame(room, { questionPool: bigPool(), rng: createSequenceRng(normalTurnRng()) });
    cur = playNormalTurn(cur.room, {
      text: 'menteur',
      bluff: true,
      mises: { p2: { montant: 2, prediction: 'faux' } },
      votes: ['up', 'up'],
    });
    assert.equal(scoreOf(cur.room, 'p2'), 2, 'gain normal, non doublé, sans le joker');
  });
});

describe('Le semeur de doute', () => {
  test('deviner juste sur le vote public rapporte +1 en plus du gain normal, seulement pour le porteur', () => {
    let room = withJoker(threePlayerBluffRoom(), 'p2', JOKER_IDS.LE_SEMEUR_DE_DOUTE);
    let cur = startGame(room, { questionPool: bigPool(), rng: createSequenceRng(normalTurnRng()) });

    const beforeP2 = scoreOf(cur.room, 'p2');
    const beforeP3 = scoreOf(cur.room, 'p3');
    // p1 actif ment ; p2 (porteur) et p3 (sans le joker) votent tous deux "down" (deviné juste).
    cur = playNormalTurn(cur.room, { text: 'menteur', bluff: true, votes: ['down', 'down'] });
    assert.equal(scoreOf(cur.room, 'p2') - beforeP2, 3, 'gain normal +2, plus 1 grâce au joker');
    assert.equal(scoreOf(cur.room, 'p3') - beforeP3, 2, 'gain normal seul, p3 ne porte pas le joker');
  });

  test('aucun bonus si le porteur devine faux', () => {
    let room = withJoker(threePlayerBluffRoom(), 'p2', JOKER_IDS.LE_SEMEUR_DE_DOUTE);
    let cur = startGame(room, { questionPool: bigPool(), rng: createSequenceRng(normalTurnRng()) });
    const before = scoreOf(cur.room, 'p2');
    // p2 vote "up" (croit p1 sincère) alors qu'il ment : deviné faux.
    cur = playNormalTurn(cur.room, { text: 'menteur', bluff: true, votes: ['up', 'down'] });
    assert.equal(scoreOf(cur.room, 'p2') - before, 0, 'ni gain normal ni bonus sur une mauvaise réponse');
  });
});

describe('Le masque', () => {
  test('une fois par partie, un mensonge qui dupe la majorité voit son gain déjà doublé encore doublé', () => {
    let room = withJoker(threePlayerBluffRoom(), 'p1', JOKER_IDS.LE_MASQUE);
    let cur = startGame(room, { questionPool: bigPool(), rng: createSequenceRng(normalTurnRng()) });

    const before1 = scoreOf(cur.room, 'p1');
    // Tour 1 (p1 actif) : ment, majorité dupée (p2 et p3 votent "up").
    cur = playNormalTurn(cur.room, { text: 'menteur 1', bluff: true, votes: ['up', 'up'] });
    // POINTS.verite (1) x bluffLiarMultiplicateur (2, règle de base) x 2 (Le masque) = 4.
    assert.equal(scoreOf(cur.room, 'p1') - before1, 4, 'x4 par rapport à un tour normal, la toute première fois');

    // Tour 2 (p2) et tour 3 (p3) : sans bluff, pour faire revenir la main à p1.
    cur = playNormalTurn(cur.room, {});
    cur = playNormalTurn(cur.room, {});

    const before2 = scoreOf(cur.room, 'p1');
    // Tour 4 (p1 actif de nouveau) : reproduit exactement les mêmes conditions.
    cur = playNormalTurn(cur.room, { text: 'menteur 2', bluff: true, votes: ['up', 'up'] });
    // Seule la règle de base s'applique cette fois : x2, pas x4.
    assert.equal(scoreOf(cur.room, 'p1') - before2, 2, 'déjà déclenché une fois : seul le doublement de base s’applique');
  });

  test('ne se déclenche jamais pour un joueur qui ne porte pas ce joker', () => {
    const room = threePlayerBluffRoom();
    let cur = startGame(room, { questionPool: bigPool(), rng: createSequenceRng(normalTurnRng()) });
    const before = scoreOf(cur.room, 'p1');
    cur = playNormalTurn(cur.room, { text: 'menteur', bluff: true, votes: ['up', 'up'] });
    assert.equal(scoreOf(cur.room, 'p1') - before, 2, 'seul le doublement de base, jamais x4 sans le joker');
  });
});

describe('Le limier', () => {
  test('après 3 votes d’authenticité corrects d’affilée (sur les tours des autres, jamais le sien), le 4e est crédité automatiquement sans voter', () => {
    let room = withJoker(threePlayerBluffRoom(), 'p3', JOKER_IDS.LE_LIMIER);
    let cur = startGame(room, { questionPool: bigPool(), rng: createSequenceRng(normalTurnRng()) });

    // Tour 1 (p1 actif) : p3 vote juste (down). Série : 1.
    cur = playNormalTurn(cur.room, { bluff: true, votes: ['up', 'down'] });
    assert.equal(limierBonusDueForNextOpportunity(cur.room.history, 'p3'), false);

    // Tour 2 (p2 actif) : p3 vote juste. Série : 2.
    cur = playNormalTurn(cur.room, { bluff: true, votes: ['up', 'down'] });
    assert.equal(limierBonusDueForNextOpportunity(cur.room.history, 'p3'), false);

    // Tour 3 (p3 lui-même actif) : aucun vote possible sur son propre tour,
    // totalement neutre pour sa propre série (voir jokers.js).
    cur = playNormalTurn(cur.room, {});

    // Tour 4 (p1 actif) : p3 vote juste une 3e fois d'affilée. Série : 3,
    // remise à zéro, bonus désormais en attente pour la PROCHAINE occasion.
    const beforeTurn4 = scoreOf(cur.room, 'p3');
    cur = playNormalTurn(cur.room, { bluff: true, votes: ['up', 'down'] });
    assert.equal(scoreOf(cur.room, 'p3') - beforeTurn4, 2, 'ce 3e vote reste un gain normal, pas encore le bonus automatique');
    assert.equal(limierBonusDueForNextOpportunity(cur.room.history, 'p3'), true);

    // Tour 5 (p2 actif) : p3 NE VOTE PAS DU TOUT (résolu par voteTimeout) —
    // et touche quand même le gain d'un vote juste, automatiquement.
    const beforeTurn5 = scoreOf(cur.room, 'p3');
    let step = submitAnswer(cur.room, { playerId: 'p2', text: 'menteur' });
    step = declareBluff(step.room, { playerId: 'p2' });
    step = submitVote(step.room, { voterId: 'p1', vote: 'up', turnNumber: step.room.currentTurn.turnNumber });
    step = voteTimeout(step.room, {
      turnNumber: step.room.currentTurn.turnNumber,
      rng: createSequenceRng(normalTurnRng()),
    });
    assert.equal(
      scoreOf(step.room, 'p3') - beforeTurn5,
      REGLES.bluffVoteCorrectPoints,
      'crédité automatiquement du gain normal d’un vote juste, sans avoir voté'
    );
  });

  test('un vote faux casse la série avant qu’elle n’atteigne 3', () => {
    let room = withJoker(threePlayerBluffRoom(), 'p3', JOKER_IDS.LE_LIMIER);
    let cur = startGame(room, { questionPool: bigPool(), rng: createSequenceRng(normalTurnRng()) });
    cur = playNormalTurn(cur.room, { bluff: true, votes: ['up', 'down'] }); // p3 juste
    cur = playNormalTurn(cur.room, { bluff: true, votes: ['up', 'up'] }); // p3 faux : série cassée
    assert.equal(limierBonusDueForNextOpportunity(cur.room.history, 'p3'), false);
  });
});

describe('Le sceptique perpétuel', () => {
  test('compte les votes "down" sur les tours de bluff des autres, ignore son propre tour', () => {
    let room = threePlayerBluffRoom();
    let cur = startGame(room, { questionPool: bigPool(), rng: createSequenceRng(normalTurnRng()) });

    // Tour 1 (p1 actif) : p3 vote juste (down).
    cur = playNormalTurn(cur.room, { bluff: true, votes: ['up', 'down'] });
    assert.equal(sceptiquePerpetuelVoteCount(cur.room.history, 'p3'), 1);

    // Tour 2 (p2 actif) : p3 vote encore down.
    cur = playNormalTurn(cur.room, { bluff: true, votes: ['up', 'down'] });
    assert.equal(sceptiquePerpetuelVoteCount(cur.room.history, 'p3'), 2);

    // Tour 3 (p3 lui-même actif) : aucun vote possible sur son propre tour,
    // totalement neutre, le compte ne bouge pas.
    cur = playNormalTurn(cur.room, {});
    assert.equal(sceptiquePerpetuelVoteCount(cur.room.history, 'p3'), 2, 'son propre tour ne progresse ni ne casse le compte');
  });

  test('un seul "up" disqualifie définitivement, sans rattrapage même avec des votes down ensuite', () => {
    let room = threePlayerBluffRoom();
    let cur = startGame(room, { questionPool: bigPool(), rng: createSequenceRng(normalTurnRng()) });

    cur = playNormalTurn(cur.room, { bluff: true, votes: ['up', 'down'] }); // p3 down
    cur = playNormalTurn(cur.room, { bluff: true, votes: ['up', 'up'] }); // p3 up : disqualifié
    assert.equal(sceptiquePerpetuelVoteCount(cur.room.history, 'p3'), null);

    cur = playNormalTurn(cur.room, {}); // p3 lui-même, neutre
    cur = playNormalTurn(cur.room, { bluff: true, votes: ['up', 'down'] }); // p3 down à nouveau
    assert.equal(
      sceptiquePerpetuelVoteCount(cur.room.history, 'p3'),
      null,
      'aucun rattrapage possible une fois disqualifié, même avec des votes down juste après'
    );
  });

  test('un tour sans vote (déconnecté / minuteur expiré) est neutre, ni progression ni rupture', () => {
    let room = threePlayerBluffRoom();
    let cur = startGame(room, { questionPool: bigPool(), rng: createSequenceRng(normalTurnRng()) });

    cur = playNormalTurn(cur.room, { bluff: true, votes: ['up', 'down'] }); // p3 down, compte à 1

    // Tour 2 (p2 actif) : p3 ne vote pas du tout, résolu par voteTimeout.
    let step = submitAnswer(cur.room, { playerId: 'p2', text: 'menteur' });
    step = declareBluff(step.room, { playerId: 'p2' });
    step = submitVote(step.room, { voterId: 'p1', vote: 'up', turnNumber: step.room.currentTurn.turnNumber });
    step = voteTimeout(step.room, {
      turnNumber: step.room.currentTurn.turnNumber,
      rng: createSequenceRng(normalTurnRng()),
    });

    assert.equal(sceptiquePerpetuelVoteCount(step.room.history, 'p3'), 1, 'ni progression ni rupture : le compte reste à 1');
  });

  test('bonus de fin de partie versé une seule fois, à GAME_ENDED, proportionnel au nombre de votes éligibles', () => {
    let room = withJoker(threePlayerBluffRoom({ maxTurns: 4 }), 'p3', JOKER_IDS.LE_SCEPTIQUE_PERPETUEL);
    let cur = startGame(room, { questionPool: bigPool(), rng: createSequenceRng(normalTurnRng()) });

    cur = playNormalTurn(cur.room, { bluff: true, votes: ['up', 'down'] }); // tour 1 (p1) : p3 down, compte 1
    cur = playNormalTurn(cur.room, { bluff: true, votes: ['up', 'down'] }); // tour 2 (p2) : p3 down, compte 2
    cur = playNormalTurn(cur.room, {}); // tour 3 (p3 lui-même) : neutre

    const beforeLastTurn = scoreOf(cur.room, 'p3');
    // Tour 4 (p1) : p3 down une 3e fois, atteint le seuil minimum ET
    // maxTurns=4 déclenche GAME_ENDED sur ce même tour.
    cur = playNormalTurn(cur.room, { bluff: true, votes: ['up', 'down'] });

    const ended = cur.effects.find((e) => e.type === 'GAME_ENDED');
    assert.ok(ended, 'maxTurns=4 doit déclencher la fin de partie à ce tour');

    // Gain normal du 4e vote juste + bonus de fin de partie (3 votes x 3 points).
    const expectedDelta = REGLES.bluffVoteCorrectPoints + 3 * REGLES.sceptiquePerpetuelPointsParVote;
    assert.equal(scoreOf(cur.room, 'p3') - beforeLastTurn, expectedDelta);

    const rankingEntry = ended.ranking.find((r) => r.playerId === 'p3');
    assert.equal(rankingEntry.score, scoreOf(cur.room, 'p3'), 'le classement de fin de partie doit déjà refléter le bonus');
  });

  test('sous le seuil minimum de 3 votes éligibles, aucun bonus même sans disqualification', () => {
    let room = withJoker(threePlayerBluffRoom({ maxTurns: 2 }), 'p3', JOKER_IDS.LE_SCEPTIQUE_PERPETUEL);
    let cur = startGame(room, { questionPool: bigPool(), rng: createSequenceRng(normalTurnRng()) });

    cur = playNormalTurn(cur.room, { bluff: true, votes: ['up', 'down'] }); // tour 1 (p1) : p3 down, compte 1
    const beforeLastTurn = scoreOf(cur.room, 'p3');
    // Tour 2 (p2) : p3 down une 2e fois (sous le seuil de 3) — et maxTurns=2
    // déclenche GAME_ENDED sur ce même tour.
    cur = playNormalTurn(cur.room, { bluff: true, votes: ['up', 'down'] });

    const ended = cur.effects.find((e) => e.type === 'GAME_ENDED');
    assert.ok(ended, 'maxTurns=2 doit déclencher la fin de partie à ce tour');
    assert.equal(
      scoreOf(cur.room, 'p3') - beforeLastTurn,
      REGLES.bluffVoteCorrectPoints,
      'seulement 2 votes éligibles, sous le seuil de 3 : aucun bonus de fin de partie'
    );
  });

  test('une disqualification annule tout bonus, même avec des votes down ensuite et le seuil atteint', () => {
    let room = withJoker(threePlayerBluffRoom({ maxTurns: 4 }), 'p3', JOKER_IDS.LE_SCEPTIQUE_PERPETUEL);
    let cur = startGame(room, { questionPool: bigPool(), rng: createSequenceRng(normalTurnRng()) });

    cur = playNormalTurn(cur.room, { bluff: true, votes: ['up', 'up'] }); // tour 1 (p1) : p3 vote UP -> disqualifié
    cur = playNormalTurn(cur.room, { bluff: true, votes: ['up', 'down'] }); // tour 2 (p2) : p3 down
    cur = playNormalTurn(cur.room, {}); // tour 3 (p3 lui-même) : neutre

    const beforeLastTurn = scoreOf(cur.room, 'p3');
    cur = playNormalTurn(cur.room, { bluff: true, votes: ['up', 'down'] }); // tour 4 (p1) : p3 down, seuil atteint malgré tout

    const ended = cur.effects.find((e) => e.type === 'GAME_ENDED');
    assert.ok(ended);
    assert.equal(
      scoreOf(cur.room, 'p3') - beforeLastTurn,
      REGLES.bluffVoteCorrectPoints,
      'disqualifié dès le tour 1 : seul le gain normal du vote juste du tour 4 est crédité, aucun bonus malgré 3 votes down au total'
    );
  });
});
