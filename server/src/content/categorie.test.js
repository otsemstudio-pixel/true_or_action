import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  inheritQuestionCategorie,
  assertPackQuestionCategorie,
  assertPackSelectableInRoom,
} from './categorie.js';

describe('inheritQuestionCategorie', () => {
  test('reprend la catégorie du contexte si supportée', () => {
    assert.equal(inheritQuestionCategorie('couple'), 'couple');
    assert.equal(inheritQuestionCategorie('general'), 'general');
  });

  test('retombe sur general si le contexte est inconnu', () => {
    assert.equal(inheritQuestionCategorie('exotique'), 'general');
    assert.equal(inheritQuestionCategorie(undefined), 'general');
  });
});

describe('assertPackQuestionCategorie', () => {
  test('accepte une question de la même catégorie que le pack', () => {
    assert.doesNotThrow(() => assertPackQuestionCategorie('couple', 'couple'));
  });

  test("refuse une question d'une autre catégorie que le pack", () => {
    assert.throws(
      () => assertPackQuestionCategorie('general', 'couple'),
      (err) => err.code === 'PACK_CATEGORIE_MISMATCH'
    );
  });
});

describe('assertPackSelectableInRoom', () => {
  test('accepte un pack de la même catégorie que le salon', () => {
    assert.doesNotThrow(() => assertPackSelectableInRoom('couple', 'couple'));
  });

  test("refuse un pack couple dans un salon general, et inversement", () => {
    assert.throws(
      () => assertPackSelectableInRoom('couple', 'general'),
      (err) => err.code === 'PACK_NOT_SELECTABLE_IN_ROOM'
    );
    assert.throws(
      () => assertPackSelectableInRoom('general', 'couple'),
      (err) => err.code === 'PACK_NOT_SELECTABLE_IN_ROOM'
    );
  });
});
