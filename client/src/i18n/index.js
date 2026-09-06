import fr from './fr.js';
import en from './en.js';

export const DICTIONARIES = { fr, en };
export const SUPPORTED_LANGUES = ['fr', 'en'];
export const DEFAULT_LANGUE = 'fr';

// Toujours affiché dans sa propre langue, indépendamment de la langue active
// (convention standard des sélecteurs de langue).
export const LANGUE_NATIVE_NAMES = { fr: 'Français', en: 'English' };

function getPath(obj, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function interpolate(str, params = {}) {
  return str.replace(/\{\{(\w+)\}\}/g, (_, key) => (params[key] ?? ''));
}

// Crée une fonction t(key, params?, fallback?) pour un dictionnaire donné.
// - key : chemin en notation pointée, ex. "salon.finDePartie" ou "niveau.label.2"
// - params.count : sélectionne la forme one/other si la valeur à cette clé est
//   un objet { one, other } (pluriel simple, suffisant pour fr/en)
// - fallback : utilisé si la clé est introuvable (sinon la clé elle-même est
//   renvoyée, pour repérer facilement une traduction manquante)
export function createTranslator(dict) {
  return function t(key, params = {}, fallback) {
    const raw = getPath(dict, key);
    if (raw == null) return fallback ?? key;

    let str = raw;
    if (typeof raw === 'object') {
      const isOne = params.count === 1;
      str = isOne ? raw.one : raw.other;
      if (str == null) return fallback ?? key;
    }
    return interpolate(str, params);
  };
}

// Traduit une erreur renvoyée par le serveur (GameError/AuthError : { code,
// message, details }) à partir de son code plutôt que du message brut en
// français. Si le code est inconnu de ce dictionnaire, on retombe sur le
// message serveur pour ne jamais afficher un écran vide.
export function translateError(t, err) {
  if (!err) return null;
  const d = err.details ?? {};
  const params = {
    min: d.min,
    max: d.max,
    maxTurns: d.maxTurns,
    missingVerite: d.missing?.verite,
    missingAction: d.missing?.action,
    maxLength: d.maxLength,
    minLength: d.minLength,
    type: d.type,
  };
  return t(`erreurs.${err.code}`, params, err.message);
}

export function detectLangueFromNavigator() {
  if (typeof navigator === 'undefined') return DEFAULT_LANGUE;
  const raw = navigator.language || navigator.languages?.[0] || '';
  const prefix = raw.slice(0, 2).toLowerCase();
  return SUPPORTED_LANGUES.includes(prefix) ? prefix : DEFAULT_LANGUE;
}
