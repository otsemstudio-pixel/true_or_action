import { ContentError } from './errors.js';

const TYPES = ['verite', 'action'];
const NIVEAUX = [1, 2, 3];
const CONTENU_MAX_LENGTH = 300;

export function validateQuestionType(type) {
  if (!TYPES.includes(type)) {
    throw new ContentError('INVALID_TYPE', 'Le type doit être verite ou action', { allowed: TYPES });
  }
  return type;
}

export function validateQuestionNiveau(niveau) {
  if (!NIVEAUX.includes(niveau)) {
    throw new ContentError('INVALID_NIVEAU', 'Le niveau doit être 1, 2 ou 3', { allowed: NIVEAUX });
  }
  return niveau;
}

export function validateQuestionContenu(contenu) {
  const trimmed = (contenu ?? '').trim();
  if (!trimmed) {
    throw new ContentError('EMPTY_CONTENU', 'Le texte de la question ne peut pas être vide');
  }
  if (trimmed.length > CONTENU_MAX_LENGTH) {
    throw new ContentError('CONTENU_TOO_LONG', `Le texte dépasse ${CONTENU_MAX_LENGTH} caractères`, {
      maxLength: CONTENU_MAX_LENGTH,
    });
  }
  return trimmed;
}

// packId est optionnel côté route (une proposition peut être autonome) : la
// forme n'est validée ici que quand il est fourni, jamais son existence/sa
// propriété (voir repository.js, vérifié dans la route elle-même).
export function validatePackId(packId) {
  if (packId == null) return null;
  const parsed = Number(packId);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ContentError('INVALID_PACK_ID', 'packId doit être un entier positif');
  }
  return parsed;
}
