import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { inheritQuestionLangue, assertPackQuestionLangue, assertQuestionNotBanned } from './language.js';

describe('inheritQuestionLangue', () => {
  test('reprend la langue d\'interface si supportée', () => {
    assert.equal(inheritQuestionLangue('en'), 'en');
    assert.equal(inheritQuestionLangue('fr'), 'fr');
  });

  test('retombe sur fr si la langue d\'interface est inconnue', () => {
    assert.equal(inheritQuestionLangue('de'), 'fr');
    assert.equal(inheritQuestionLangue(undefined), 'fr');
  });
});

describe('assertPackQuestionLangue', () => {
  test('accepte une question de la même langue que le pack', () => {
    assert.doesNotThrow(() => assertPackQuestionLangue('fr', 'fr'));
  });

  test('refuse une question d\'une autre langue que le pack', () => {
    assert.throws(
      () => assertPackQuestionLangue('fr', 'en'),
      (err) => err.code === 'PACK_LANGUE_MISMATCH'
    );
  });
});

describe('assertQuestionNotBanned', () => {
  test('accepte un contenu propre', () => {
    assert.doesNotThrow(() => assertQuestionNotBanned('Quelle est ta série préférée ?', 'fr'));
  });

  test('rejette un contenu filtré par la modération', () => {
    assert.throws(
      () => assertQuestionNotBanned('Cliquez ici pour gagner', 'fr'),
      (err) => err.code === 'QUESTION_REJECTED_MODERATION'
    );
  });
});
