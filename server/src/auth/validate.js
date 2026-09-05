import { AuthError } from './errors.js';

const PSEUDO_RE = /^[a-zA-Z0-9_-]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validatePseudo(pseudo) {
  const trimmed = (pseudo ?? '').trim();
  if (!PSEUDO_RE.test(trimmed)) {
    throw new AuthError(
      'INVALID_PSEUDO',
      'Le pseudo doit contenir 3 à 20 caractères (lettres, chiffres, _ ou -)'
    );
  }
  return trimmed;
}

export function validateEmail(email) {
  const trimmed = (email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(trimmed)) {
    throw new AuthError('INVALID_EMAIL', 'Adresse email invalide');
  }
  return trimmed;
}

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new AuthError('INVALID_PASSWORD', 'Le mot de passe doit contenir au moins 8 caractères');
  }
  return password;
}
