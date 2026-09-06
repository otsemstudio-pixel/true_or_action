import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validatePseudo, validateEmail, validatePassword, validateLangue } from './validate.js';

describe('validatePseudo', () => {
  test('accepte un pseudo valide', () => {
    assert.equal(validatePseudo('  Joueur_1  '), 'Joueur_1');
  });

  test('refuse trop court', () => {
    assert.throws(() => validatePseudo('ab'), (err) => err.code === 'INVALID_PSEUDO');
  });

  test('refuse les caractères spéciaux', () => {
    assert.throws(() => validatePseudo('joueur!'), (err) => err.code === 'INVALID_PSEUDO');
  });
});

describe('validateEmail', () => {
  test('accepte et normalise en minuscules', () => {
    assert.equal(validateEmail('  Test@Example.COM '), 'test@example.com');
  });

  test('refuse un email invalide', () => {
    assert.throws(() => validateEmail('pas-un-email'), (err) => err.code === 'INVALID_EMAIL');
  });
});

describe('validatePassword', () => {
  test('accepte 8 caractères ou plus', () => {
    assert.equal(validatePassword('motdepasse'), 'motdepasse');
  });

  test('refuse moins de 8 caractères', () => {
    assert.throws(() => validatePassword('court1'), (err) => err.code === 'INVALID_PASSWORD');
  });
});

describe('validateLangue', () => {
  test('accepte fr et en', () => {
    assert.equal(validateLangue('fr'), 'fr');
    assert.equal(validateLangue('en'), 'en');
  });

  test('retombe sur fr par défaut si absente', () => {
    assert.equal(validateLangue(undefined), 'fr');
    assert.equal(validateLangue(null), 'fr');
  });

  test('refuse une langue non supportée', () => {
    assert.throws(() => validateLangue('de'), (err) => err.code === 'INVALID_LANGUE');
  });
});
