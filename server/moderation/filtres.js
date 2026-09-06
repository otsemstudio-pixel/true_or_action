// Filtre de modération léger, par langue : détecte des motifs indésirables
// dans le texte d'une question ou d'un pack avant publication.
//
// Point de départ volontairement modeste — la liste réelle des motifs à
// bloquer (injures, discours haineux, contenus illégaux...) est une décision
// de modération qui doit être revue et complétée par l'équipe produit au fil
// de l'usage réel ; elle ne doit pas être générée en bloc automatiquement.
// Les catégories ci-dessous illustrent la structure attendue (une entrée par
// motif, en minuscules, sans accents) et couvrent quelques cas évidents.
//
// Chaque langue doit avoir sa propre liste : un motif français ne doit pas
// filtrer une question anglaise et inversement.

export const FILTRES = {
  fr: [
    // Spam / arnaque
    'cliquez ici pour gagner',
    'numero de carte bancaire',
    // Contenu illégal impliquant des mineurs — tolérance zéro
    'contenu pedopornographique',
    // Incitation à la violence
    'appel au meurtre',
  ],
  en: [
    'click here to win',
    'credit card number',
    'child sexual abuse material',
    'call to violence',
  ],
};

const COMBINING_DIACRITICS = /[̀-ͯ]/g;

function normalize(text) {
  return text
    .normalize('NFD')
    .replace(COMBINING_DIACRITICS, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Renvoie le premier motif trouvé (ou null) plutôt qu'un simple booléen, pour
// que l'appelant puisse journaliser/expliquer le rejet sans re-parcourir la liste.
export function findBannedPattern(text, langue) {
  const list = FILTRES[langue] ?? FILTRES.fr;
  const normalized = normalize(text ?? '');
  return list.find((term) => normalized.includes(normalize(term))) ?? null;
}

export function containsBannedContent(text, langue) {
  return findBannedPattern(text, langue) !== null;
}
