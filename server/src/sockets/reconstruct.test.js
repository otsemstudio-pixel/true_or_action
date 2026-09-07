import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, addPlayer } from '../game/room.js';
import { startGame, submitAnswer, submitVote, activateJokerPublic, returnQuestion, declareBluff } from '../game/turn.js';
import { buildHistoryFromRows, buildCurrentNormalTurnFromRow } from './turnReconstruction.js';

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
