import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { containsBannedContent, findBannedPattern } from './filtres.js';

describe('containsBannedContent', () => {
  test('détecte un motif interdit en français', () => {
    assert.equal(containsBannedContent('Cliquez ici pour gagner un cadeau', 'fr'), true);
  });

  test('ignore les accents et la casse', () => {
    assert.equal(containsBannedContent('NUMÉRO DE CARTE BANCAIRE svp', 'fr'), true);
  });

  test('ne filtre pas un texte anodin', () => {
    assert.equal(containsBannedContent('Quelle est ta série préférée ?', 'fr'), false);
  });

  test('détecte un motif interdit en anglais', () => {
    assert.equal(containsBannedContent('Please click here to win now', 'en'), true);
  });

  test('un motif français ne filtre pas une question anglaise', () => {
    assert.equal(containsBannedContent('cliquez ici pour gagner', 'en'), false);
  });

  test('une langue inconnue retombe sur la liste française', () => {
    assert.equal(containsBannedContent('cliquez ici pour gagner', 'de'), true);
  });
});

describe('findBannedPattern', () => {
  test('renvoie le motif trouvé', () => {
    assert.equal(findBannedPattern('appel au meurtre contre X', 'fr'), 'appel au meurtre');
  });

  test('renvoie null si rien trouvé', () => {
    assert.equal(findBannedPattern('Action ou vérité ?', 'fr'), null);
  });
});
