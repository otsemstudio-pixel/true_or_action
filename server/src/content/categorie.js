// Catégorie du contenu créé par les utilisateurs (questions, packs), en
// miroir de language.js pour la langue. Aucune fonctionnalité de création
// n'existe encore côté socket/HTTP — ce module prépare le terrain (logique
// pure, testable) pour quand elle sera construite.
import { ContentError } from './errors.js';
import { SUPPORTED_CATEGORIES, DEFAULT_CATEGORIE } from '../config/categories.js';

// Une question créée hérite de la catégorie du contexte de création (le
// salon, ou le pack, dans lequel elle est proposée) — jamais choisie à part.
export function inheritQuestionCategorie(contextCategorie) {
  return SUPPORTED_CATEGORIES.includes(contextCategorie) ? contextCategorie : DEFAULT_CATEGORIE;
}

// Un pack a une catégorie ; toutes ses questions doivent être de cette
// catégorie (pas de mélange 'general'/'couple' au sein d'un même pack).
export function assertPackQuestionCategorie(packCategorie, questionCategorie) {
  if (packCategorie !== questionCategorie) {
    throw new ContentError(
      'PACK_CATEGORIE_MISMATCH',
      `Une question en catégorie "${questionCategorie}" ne peut pas être ajoutée à un pack en catégorie "${packCategorie}"`,
      { packCategorie, questionCategorie }
    );
  }
}

// Un pack 'couple' n'est sélectionnable que dans un salon en catégorie
// couple (et un pack 'general' seulement dans un salon general) : la même
// règle d'exclusivité que pour le tirage lui-même, appliquée au choix du pack.
export function assertPackSelectableInRoom(packCategorie, roomCategorie) {
  if (packCategorie !== roomCategorie) {
    throw new ContentError(
      'PACK_NOT_SELECTABLE_IN_ROOM',
      `Ce pack (catégorie "${packCategorie}") n'est pas sélectionnable dans un salon en catégorie "${roomCategorie}"`,
      { packCategorie, roomCategorie }
    );
  }
}
