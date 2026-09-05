import { CHAT } from './constants.js';
import { GameError } from './errors.js';

export function validateMessageText(text) {
  const trimmed = (text ?? '').trim();
  if (!trimmed) {
    throw new GameError('EMPTY_MESSAGE', 'Le message ne peut pas être vide');
  }
  if (trimmed.length > CHAT.maxLength) {
    throw new GameError('MESSAGE_TOO_LONG', `Le message dépasse ${CHAT.maxLength} caractères`);
  }
  return trimmed;
}

export function isWithinRateLimit(recentTimestamps, now = Date.now()) {
  const windowStart = now - CHAT.rateLimit.windowMs;
  const withinWindow = recentTimestamps.filter((t) => t > windowStart);
  return withinWindow.length < CHAT.rateLimit.count;
}
