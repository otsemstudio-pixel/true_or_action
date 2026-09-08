import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, addPlayer } from '../game/room.js';
import { startGame, submitAnswer, submitVote, activateJokerPublic, returnQuestion, declareBluff } from '../game/turn.js';
import { buildHistoryFromRows, buildCurrentNormalTurnFromRow } from './turnReconstruction.js';
import { hasUsedMasque, limierBonusDueForNextOpportunity, sceptiquePerpetuelVoteCount } from '../game/jokers.js';

function createSequenceRngForBluff(values) {
  let i = 0;
  return () => {
    if (i >= values.length) throw new Error('Séquence rng épuisée');
    return values[i++];
  };
}
function bluffPool() {
  return {
    verite: { top: ['v0', 'v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7'], lower: [] },
    action: { top: ['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'], lower: [] },
    escalade: { verite: [], action: [] },
  };
}
const BLUFF_TURN_RNG = [0.1, 0.5, 0.0]; // type, panier (ignoré), index

// Ids numériques (chaînes) plutôt que 'p1'/'p2' comme dans turn.test.js : ici
// on simule des lignes de base réelles, où player_id/voter_id sont toujours
// des entiers convertis en chaîne côté mémoire (voir String(...) partout
// dans reconstruct.js) — le round-trip n'a de sens qu'avec ce même format.

function pool() {
  return {
    verite: { top: ['v0', 'v1'], lower: [] },
    action: { top: ['a0', 'a1'], lower: [] },
    escalade: { verite: [], action: [] },
  };
}

function createSequenceRng(values) {
  let i = 0;
  return () => {
    if (i >= values.length) throw new Error('Séquence rng épuisée');
    return values[i++];
  };
}

const BUCKET_DONT_CARE = 0.5;

describe('buildHistoryFromRows : reconstruction de room.history depuis la base', () => {
  // Ce test aurait attrapé le bug de production : reconstruct.js
  // réinitialisait toujours room.history à [] plutôt que de le reconstruire,
  // rendant "la question retournée" et le joker inversé (effet "question
  // précédente") indisponibles après la moindre reconnexion ou redémarrage
  // serveur, alors qu'un vrai tour précédent existait.
  test('un tour normal résolu avec des votes redevient exploitable par la question retournée et le joker inversé, exactement comme avant une reconnexion', () => {
    let room = createRoom({
      code: 'ABCD',
      hostId: '101',
      hostPseudo: 'A',
      maxTurns: 2,
      regles: { questionRetournee: true, jokerPublic: true, jokerInverse: true },
    });
    room = addPlayer(room, { id: '102', pseudo: 'B' });
    room = addPlayer(room, { id: '103', pseudo: 'C' });

    const start = startGame(room, {
      questionPool: pool(),
      rng: createSequenceRng([0.1, BUCKET_DONT_CARE, 0.0]),
    });
    const turn1QuestionId = start.room.currentTurn.questionId;
    const turn1Type = start.room.currentTurn.type;

    const answered = submitAnswer(start.room, { playerId: '101', text: 'réponse 1' });
    const voted1 = submitVote(answered.room, { voterId: '102', vote: 'up', turnNumber: 1 });
    const resolved = submitVote(voted1.room, { voterId: '103', vote: 'down', turnNumber: 1 });

    // Vérité de référence : ce que resolveTurn produit réellement en mémoire
    // (le tour 2 a déjà démarré, l'historique du tour 1 est déjà accumulé).
    const realEntry = resolved.room.history[0];
    assert.equal(realEntry.mode, 'normal');
    assert.equal(realEntry.questionId, turn1QuestionId);

    // Lignes telles qu'une vraie requête en base les renverrait pour ce même
    // tour (voir repository.js fetchTurnHistory / fetchVotesForTurnsWithVoter).
    const fakeTurnRow = {
      id: 555,
      numero: 1,
      player_id: 101,
      question_id: turn1QuestionId,
      type: turn1Type,
      reponse: 'réponse 1',
      points: realEntry.points,
      status: 'done',
      double_ou_rien: false,
      returned_from_player_id: null,
      joker_inverse: false,
    };
    const fakeVotesRows = [
      { turn_id: 555, voter_id: 102, valeur: 1 },
      { turn_id: 555, voter_id: 103, valeur: -1 },
    ];

    const reconstructedHistory = buildHistoryFromRows([fakeTurnRow], fakeVotesRows, []);
    assert.equal(reconstructedHistory.length, 1);
    assert.equal(reconstructedHistory[0].mode, 'normal');
    assert.equal(reconstructedHistory[0].questionId, turn1QuestionId);
    assert.equal(reconstructedHistory[0].type, turn1Type);
    assert.deepEqual(reconstructedHistory[0].votes, { '102': 'up', '103': 'down' });

    // Un salon "juste reconstruit" : le tour 2 est déjà en cours (comme en
    // mémoire), mais l'historique vient de la reconstruction plutôt que
    // d'une continuité mémoire — exactement la situation d'une reconnexion
    // ou d'un redémarrage serveur.
    const afterReconnect = { ...resolved.room, history: reconstructedHistory };

    // La question retournée doit retrouver "102" (le seul votant "up").
    const returned = returnQuestion(afterReconnect, { playerId: afterReconnect.currentTurn.activePlayerId });
    assert.equal(returned.room.currentTurn.activePlayerId, '102');

    // Le joker inversé, effet "question précédente", doit retrouver la
    // question du tour 1 — c'est exactement ce que le bug empêchait.
    const activated = activateJokerPublic(afterReconnect, { playerId: '103', effect: 'questionPrecedente' });
    assert.equal(activated.room.currentTurn.questionId, turn1QuestionId);
    assert.equal(activated.room.currentTurn.type, turn1Type);
  });

  test('un tour surprise résolu reste bien mode: "surprise" après reconstruction, jamais confondu avec un tour normal réutilisable', () => {
    const fakeTurnRow = {
      id: 777,
      numero: 1,
      player_id: 101,
      question_id: 'v0',
      type: 'verite',
      reponse: null,
      points: 0,
      status: 'done',
      double_ou_rien: false,
      returned_from_player_id: null,
      joker_inverse: false,
    };
    const fakeSurpriseRows = [
      { turn_id: 777, player_id: 101, reponse: 'r1', votes_recus: 2, points: 3 },
      { turn_id: 777, player_id: 102, reponse: 'r2', votes_recus: 0, points: 1 },
    ];

    const history = buildHistoryFromRows([fakeTurnRow], [], fakeSurpriseRows);
    assert.equal(history.length, 1);
    assert.equal(history[0].mode, 'surprise');
    assert.deepEqual(history[0].results, [
      { playerId: '101', answer: 'r1', votesRecus: 2, points: 3 },
      { playerId: '102', answer: 'r2', votesRecus: 0, points: 1 },
    ]);
  });

  test('sans tour résolu (partie qui vient de commencer), reconstruit un historique vide sans planter', () => {
    assert.deepEqual(buildHistoryFromRows([], [], []), []);
  });

  // Trouvé en construisant Le fidèle (jokers.js), qui a besoin de savoir si
  // un tour PASSÉ était sincère bien après sa résolution : bluffAssume était
  // toujours remis à null ici, quel que soit ce qui s'était réellement passé
  // — un bluff déclaré redevenait "sincère" à la moindre reconnexion, ce qui
  // aurait faussé silencieusement le compteur. Seul .declared est reconstruit
  // (fooled/voterResults/miseResults restent hors de portée, jamais relus
  // ailleurs dans l'app depuis l'historique — vérifié avant ce correctif).
  test('bluffAssume.declared survit à une reconnexion sur un tour normal passé, pour Le fidèle (jokers.js)', () => {
    const bluffDeclaredRow = {
      id: 901,
      numero: 1,
      player_id: 101,
      question_id: 'v0',
      type: 'verite',
      reponse: 'réponse',
      points: 2,
      status: 'done',
      double_ou_rien: false,
      returned_from_player_id: null,
      joker_inverse: false,
      bluff_declare: true,
    };
    const sincereRow = { ...bluffDeclaredRow, id: 902, numero: 2, bluff_declare: false };
    const neverPersistedRow = { ...bluffDeclaredRow, id: 903, numero: 3 };
    delete neverPersistedRow.bluff_declare;

    const history = buildHistoryFromRows([bluffDeclaredRow, sincereRow, neverPersistedRow], [], []);
    assert.equal(history[0].bluffAssume?.declared, true, 'un bluff réellement déclaré doit rester détectable après reconstruction');
    assert.equal(history[1].bluffAssume?.declared, undefined, 'un tour sincère ne doit jamais réapparaître comme un bluff après reconstruction');
    assert.equal(history[2].bluffAssume, null, 'colonne absente (règle jamais activée) : traité comme sincère, jamais une erreur');
  });
});

// Manquait à la liste de tests de l'audit précédent : une reconnexion
// pendant un tour bluff surprise spécifiquement (les autres mécaniques
// avaient chacune leur test de reconnexion dédié, pas celle-ci).
describe('buildCurrentNormalTurnFromRow : reconstruction du tour en cours (bluff surprise)', () => {
  test('tirage "menti" : bluffDeclared et bluffSurprise survivent tous les deux à une reconnexion, le joueur actif ne regagne pas la main', () => {
    let room = createRoom({
      code: 'ABCD',
      hostId: '101',
      hostPseudo: 'A',
      maxTurns: 1,
      regles: { bluffAssume: true, bluffSurprise: true },
    });
    room = addPlayer(room, { id: '102', pseudo: 'B' });
    room = addPlayer(room, { id: '103', pseudo: 'C' });
    room = { ...room, status: 'playing', turnOrder: ['101', '102', '103'] };

    const fakeLatestTurn = {
      numero: 1,
      player_id: 101,
      question_id: 'v0',
      joker_inverse_question_id: null,
      status: 'voting',
      reponse: 'réponse tour 1',
      double_ou_rien: false,
      returned_from_player_id: null,
      joker_inverse: false,
      bluff_declare: true,
      bluff_surprise: true,
    };
    const votesRows = [{ voter_id: 102, valeur: -1 }];
    const bluffMisesRows = [{ voter_id: 103, montant: 2, prediction: 'faux' }];

    const currentTurn = buildCurrentNormalTurnFromRow(fakeLatestTurn, { votesRows, bluffMisesRows, questionType: 'verite' });
    assert.equal(currentTurn.bluffDeclared, true);
    assert.equal(currentTurn.bluffSurprise, true);
    assert.deepEqual(currentTurn.votes, { '102': 'down' });
    assert.deepEqual(currentTurn.bluffMises, { '103': { montant: 2, prediction: 'faux' } });

    const afterReconnect = { ...room, currentTurn };
    assert.throws(
      () => declareBluff(afterReconnect, { playerId: '101' }),
      (err) => err.code === 'BLUFF_DEJA_DECLARE',
      'le joueur actif ne doit jamais pouvoir déclarer par-dessus un bluff surprise déjà tiré, même après une reconnexion'
    );
  });

  test('tirage "sincère" (bluffDeclared faux) : bluffSurprise doit quand même survivre, sinon le joueur regagnerait la main après reconnexion', () => {
    let room = createRoom({
      code: 'ABCD',
      hostId: '101',
      hostPseudo: 'A',
      maxTurns: 1,
      regles: { bluffAssume: true, bluffSurprise: true },
    });
    room = addPlayer(room, { id: '102', pseudo: 'B' });
    room = { ...room, status: 'playing', turnOrder: ['101', '102'] };

    const fakeLatestTurn = {
      numero: 1,
      player_id: 101,
      question_id: 'v0',
      joker_inverse_question_id: null,
      status: 'voting',
      reponse: 'réponse',
      double_ou_rien: false,
      returned_from_player_id: null,
      joker_inverse: false,
      bluff_declare: false,
      bluff_surprise: true,
    };
    const currentTurn = buildCurrentNormalTurnFromRow(fakeLatestTurn, {
      votesRows: [],
      bluffMisesRows: [],
      questionType: 'verite',
    });
    assert.equal(currentTurn.bluffDeclared, false, 'le tirage a décidé "sincère" cette fois');
    assert.equal(
      currentTurn.bluffSurprise,
      true,
      'la marque "décidé par le jeu" doit survivre même quand bluffDeclared est faux'
    );

    const afterReconnect = { ...room, currentTurn };
    assert.throws(
      () => declareBluff(afterReconnect, { playerId: '101' }),
      (err) => err.code === 'BLUFF_DEJA_DECLARE',
      'même avec bluffDeclared=false, le joueur ne doit pas regagner la main après une reconnexion'
    );
  });
});

// Trouvé en construisant Le masque et Le limier (jokers.js, catégorie Bluff
// et jugement) : les deux dépendaient initialement de bluffAssume.voterResults
// pour savoir qui avait deviné juste — un champ qui n'existe qu'en mémoire,
// jamais reconstruit (voir buildHistoryFromRows ci-dessus, seul .declared
// survit). Corrigé en redérivant tout depuis `votes` (lui bien reconstruit) :
// ces tests le prouvent en comparant le résultat sur l'historique réel à
// celui obtenu après un vrai aller-retour par des lignes de base simulées.
describe('Le masque, Le limier et Le sceptique perpétuel : les mêmes garanties de reconnexion que room.history', () => {
  function toFakeTurnRow(entry, id) {
    return {
      id,
      numero: entry.turnNumber,
      player_id: Number(entry.playerId),
      question_id: entry.questionId,
      type: entry.type,
      reponse: entry.answer,
      points: entry.points,
      status: 'done',
      double_ou_rien: Boolean(entry.doubleOuRien),
      returned_from_player_id: null,
      joker_inverse: false,
      bluff_declare: Boolean(entry.bluffAssume?.declared),
    };
  }
  function toFakeVotesRows(entry, turnId) {
    return Object.entries(entry.votes ?? {}).map(([voterId, vote]) => ({
      turn_id: turnId,
      voter_id: Number(voterId),
      valeur: vote === 'up' ? 1 : -1,
    }));
  }

  test('hasUsedMasque donne le même résultat avant et après reconstruction', () => {
    let room = createRoom({ code: 'ABCD', hostId: '101', hostPseudo: 'A', maxTurns: 2, regles: { bluffAssume: true } });
    room = addPlayer(room, { id: '102', pseudo: 'B' });
    room = addPlayer(room, { id: '103', pseudo: 'C' });
    let cur = startGame(room, { questionPool: bluffPool(), rng: createSequenceRngForBluff(BLUFF_TURN_RNG) });

    cur = submitAnswer(cur.room, { playerId: '101', text: 'menteur' });
    cur = declareBluff(cur.room, { playerId: '101' });
    cur = submitVote(cur.room, { voterId: '102', vote: 'up', turnNumber: 1 });
    cur = submitVote(cur.room, { voterId: '103', vote: 'up', turnNumber: 1, rng: createSequenceRngForBluff(BLUFF_TURN_RNG) });

    const liveEntry = cur.room.history[0];
    assert.equal(hasUsedMasque(cur.room.history, '101'), true, 'vérité de référence : majorité dupée en direct');

    const fakeRow = toFakeTurnRow(liveEntry, 901);
    const fakeVotes = toFakeVotesRows(liveEntry, 901);
    const reconstructed = buildHistoryFromRows([fakeRow], fakeVotes, []);

    assert.equal(
      hasUsedMasque(reconstructed, '101'),
      true,
      'doit rester vrai après reconstruction, sinon Le masque se redéclencherait après une reconnexion'
    );
  });

  test('limierBonusDueForNextOpportunity donne le même résultat avant et après reconstruction', () => {
    let room = createRoom({ code: 'ABCD', hostId: '101', hostPseudo: 'A', maxTurns: 4, regles: { bluffAssume: true } });
    room = addPlayer(room, { id: '102', pseudo: 'B' });
    room = addPlayer(room, { id: '103', pseudo: 'C' });
    let cur = startGame(room, { questionPool: bluffPool(), rng: createSequenceRngForBluff(BLUFF_TURN_RNG) });

    // Tour 1 (101 actif) : ment, 103 vote juste (down).
    cur = submitAnswer(cur.room, { playerId: '101', text: 't1' });
    cur = declareBluff(cur.room, { playerId: '101' });
    cur = submitVote(cur.room, { voterId: '102', vote: 'down', turnNumber: 1 });
    cur = submitVote(cur.room, { voterId: '103', vote: 'down', turnNumber: 1, rng: createSequenceRngForBluff(BLUFF_TURN_RNG) });

    // Tour 2 (102 actif) : ment, 103 vote juste une 2e fois.
    cur = submitAnswer(cur.room, { playerId: '102', text: 't2' });
    cur = declareBluff(cur.room, { playerId: '102' });
    cur = submitVote(cur.room, { voterId: '101', vote: 'down', turnNumber: 2 });
    cur = submitVote(cur.room, { voterId: '103', vote: 'down', turnNumber: 2, rng: createSequenceRngForBluff(BLUFF_TURN_RNG) });

    // Tour 3 (103 actif lui-même) : sans bluff, neutre pour sa propre série.
    cur = submitAnswer(cur.room, { playerId: '103', text: 't3' });
    cur = submitVote(cur.room, { voterId: '101', vote: 'up', turnNumber: 3 });
    cur = submitVote(cur.room, { voterId: '102', vote: 'up', turnNumber: 3, rng: createSequenceRngForBluff(BLUFF_TURN_RNG) });

    // Tour 4 (101 actif) : ment, 103 vote juste une 3e fois — série complète.
    cur = submitAnswer(cur.room, { playerId: '101', text: 't4' });
    cur = declareBluff(cur.room, { playerId: '101' });
    cur = submitVote(cur.room, { voterId: '102', vote: 'down', turnNumber: 4 });
    cur = submitVote(cur.room, { voterId: '103', vote: 'down', turnNumber: 4 });

    assert.equal(
      limierBonusDueForNextOpportunity(cur.room.history, '103'),
      true,
      'vérité de référence : 3 votes justes d’affilée en direct, bonus en attente'
    );

    const fakeRows = cur.room.history.map((entry, i) => toFakeTurnRow(entry, 900 + i));
    const fakeVotes = cur.room.history.flatMap((entry, i) => toFakeVotesRows(entry, 900 + i));
    const reconstructed = buildHistoryFromRows(fakeRows, fakeVotes, []);

    assert.equal(
      limierBonusDueForNextOpportunity(reconstructed, '103'),
      true,
      'doit rester vrai après reconstruction, sinon le bonus en attente de Le limier serait perdu à la reconnexion'
    );
  });

  test('sceptiquePerpetuelVoteCount donne le même résultat avant et après reconstruction', () => {
    let room = createRoom({ code: 'ABCD', hostId: '101', hostPseudo: 'A', maxTurns: 3, regles: { bluffAssume: true } });
    room = addPlayer(room, { id: '102', pseudo: 'B' });
    room = addPlayer(room, { id: '103', pseudo: 'C' });
    let cur = startGame(room, { questionPool: bluffPool(), rng: createSequenceRngForBluff(BLUFF_TURN_RNG) });

    // Tour 1 (101 actif) : ment, 103 vote juste (down).
    cur = submitAnswer(cur.room, { playerId: '101', text: 't1' });
    cur = declareBluff(cur.room, { playerId: '101' });
    cur = submitVote(cur.room, { voterId: '102', vote: 'down', turnNumber: 1 });
    cur = submitVote(cur.room, { voterId: '103', vote: 'down', turnNumber: 1, rng: createSequenceRngForBluff(BLUFF_TURN_RNG) });

    // Tour 2 (102 actif) : ment, 103 vote juste une 2e fois.
    cur = submitAnswer(cur.room, { playerId: '102', text: 't2' });
    cur = declareBluff(cur.room, { playerId: '102' });
    cur = submitVote(cur.room, { voterId: '101', vote: 'down', turnNumber: 2 });
    cur = submitVote(cur.room, { voterId: '103', vote: 'down', turnNumber: 2, rng: createSequenceRngForBluff(BLUFF_TURN_RNG) });

    // Tour 3 (103 actif lui-même) : sans bluff, neutre pour son propre compte.
    cur = submitAnswer(cur.room, { playerId: '103', text: 't3' });
    cur = submitVote(cur.room, { voterId: '101', vote: 'up', turnNumber: 3 });
    cur = submitVote(cur.room, { voterId: '102', vote: 'up', turnNumber: 3 });

    assert.equal(
      sceptiquePerpetuelVoteCount(cur.room.history, '103'),
      2,
      'vérité de référence : 2 votes down éligibles en direct, son propre tour neutre'
    );

    const fakeRows = cur.room.history.map((entry, i) => toFakeTurnRow(entry, 900 + i));
    const fakeVotes = cur.room.history.flatMap((entry, i) => toFakeVotesRows(entry, 900 + i));
    const reconstructed = buildHistoryFromRows(fakeRows, fakeVotes, []);

    assert.equal(
      sceptiquePerpetuelVoteCount(reconstructed, '103'),
      2,
      'doit rester identique après reconstruction, sinon le compte de Le sceptique perpétuel serait faussé à la reconnexion'
    );
  });
});
