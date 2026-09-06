import { AuthError } from './errors.js';
import { SUPPORTED_LANGUES, DEFAULT_LANGUE } from '../config/langues.js';
import { SUPPORTED_THEMES, DEFAULT_THEME } from '../config/themes.js';

const PSEUDO_RE = /^[a-zA-Z0-9_-]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validatePseudo(pseudo) {
  const trimmed = (pseudo ?? '').trim();
  if (!PSEUDO_RE.test(trimmed)) {
    throw new AuthError(
      'INVALID_PSEUDO',
      'Le pseudo doit contenir 3 à 20 caractères (lettres, chiffres, _ ou -)',
      400,
      { min: 3, max: 20 }
    );
  }
  return trimmed;
}

// Pseudo passé au pseudo choisi par un invité quand il est déjà pris
// (comptes complets ET invités partagent la même contrainte d'unicité en
// base) : tronqué pour laisser la place au suffixe plutôt que de dépasser
// la longueur maximale, jamais un simple refus.
export function suffixedPseudo(pseudo) {
  const suffix = String(Math.floor(1000 + Math.random() * 9000));
  const base = pseudo.slice(0, 20 - suffix.length - 1);
  return `${base}_${suffix}`;
}

export function validateEmail(email) {
  const trimmed = (email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(trimmed)) {
    throw new AuthError('INVALID_EMAIL', 'Adresse email invalide');
  }
  return trimmed;
}

const PASSWORD_MIN_LENGTH = 8;

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    throw new AuthError(
      'INVALID_PASSWORD',
      `Le mot de passe doit contenir au moins ${PASSWORD_MIN_LENGTH} caractères`,
      400,
      { minLength: PASSWORD_MIN_LENGTH }
    );
  }
  return password;
}

export function validateLangue(langue) {
  if (langue == null) return DEFAULT_LANGUE;
  if (!SUPPORTED_LANGUES.includes(langue)) {
    throw new AuthError('INVALID_LANGUE', 'La langue doit être fr ou en', 400, { allowed: SUPPORTED_LANGUES });
  }
  return langue;
}

export function validateTheme(theme) {
  if (theme == null) return DEFAULT_THEME;
  if (!SUPPORTED_THEMES.includes(theme)) {
    throw new AuthError('INVALID_THEME', 'Le thème doit être light ou dark', 400, { allowed: SUPPORTED_THEMES });
  }
  return theme;
}
