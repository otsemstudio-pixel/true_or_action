import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateMessageText, isWithinRateLimit } from './chat.js';
import { CHAT } from './constants.js';

describe('validateMessageText', () => {
  test('refuse un message vide', () => {
    assert.throws(() => validateMessageText('   '), (err) => err.code === 'EMPTY_MESSAGE');
  });

  test('refuse un message trop long', () => {
    const tooLong = 'a'.repeat(CHAT.maxLength + 1);
    assert.throws(() => validateMessageText(tooLong), (err) => err.code === 'MESSAGE_TOO_LONG');
  });

  test('accepte et découpe les espaces superflus', () => {
    assert.equal(validateMessageText('  salut  '), 'salut');
  });
});

describe('isWithinRateLimit', () => {
  test('autorise sous la limite', () => {
    const now = 10_000;
    const timestamps = [now - 1000, now - 2000];
    assert.equal(isWithinRateLimit(timestamps, now), true);
  });

  test('bloque à la limite atteinte', () => {
    const now = 10_000;
    const timestamps = [now - 100, now - 200, now - 300, now - 400, now - 500];
    assert.equal(isWithinRateLimit(timestamps, now), false);
  });

  test('ignore les messages hors fenêtre', () => {
    const now = 20_000;
    const timestamps = [0, 1000, 2000, 3000, 4000]; // tous hors de la fenêtre de 10s
    assert.equal(isWithinRateLimit(timestamps, now), true);
  });
});
