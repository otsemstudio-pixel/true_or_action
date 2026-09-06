// Règles de langue pour le contenu créé par les utilisateurs (questions,
// packs). Aucune fonctionnalité de création n'existe encore côté socket/HTTP
// — ce module prépare le terrain (logique pure, testable) pour quand elle
// sera construite, comme demandé.
import { ContentError } from './errors.js';
import { SUPPORTED_LANGUES, DEFAULT_LANGUE } from '../config/langues.js';
import { findBannedPattern } from '../../moderation/filtres.js';

// Une question créée hérite par défaut de la langue d'interface de son
// auteur au moment de la soumission.
export function inheritQuestionLangue(interfaceLangue) {
  return SUPPORTED_LANGUES.includes(interfaceLangue) ? interfaceLangue : DEFAULT_LANGUE;
}

// Un pack a une langue ; toutes ses questions doivent être de cette langue.
export function assertPackQuestionLangue(packLangue, questionLangue) {
  if (packLangue !== questionLangue) {
    throw new ContentError(
      'PACK_LANGUE_MISMATCH',
      `Une question en "${questionLangue}" ne peut pas être ajoutée à un pack en "${packLangue}"`,
      { packLangue, questionLangue }
    );
  }
}

export function assertQuestionNotBanned(contenu, langue) {
  const pattern = findBannedPattern(contenu, langue);
  if (pattern) {
    throw new ContentError('QUESTION_REJECTED_MODERATION', 'Ce texte contient un motif non autorisé', {
      pattern,
    });
  }
}
