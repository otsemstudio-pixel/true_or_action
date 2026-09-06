const KEY = 'tord_tutoriel_vu';
const VERSION_KEY = 'tord_tutoriel_version';

// Incrémenté à chaque ajout de contenu au didacticiel. Un joueur qui revient
// avec une version inférieure à celle-ci s'est vu proposer le didacticiel
// avant que ce contenu n'existe : il a droit à la vue "Nouveautés" plutôt
// qu'un silence total ou qu'un didacticiel complet repris depuis le début.
export const TUTORIEL_VERSION = 2;

// Si le stockage local est indisponible (navigation privée, etc.), on
// considère le didacticiel comme déjà vu plutôt que de risquer de le
// reproposer en boucle à chaque rendu.
export function hasTutorielSeen() {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return true;
  }
}

// Version du didacticiel au moment de la dernière visite. 0 pour un joueur
// qui n'a jamais vu le didacticiel ; 1 pour un joueur qui l'a vu avant
// l'introduction de ce compteur de version (aucune clé stockée à l'époque).
function getSeenVersion() {
  try {
    if (!hasTutorielSeen()) return 0;
    const stored = localStorage.getItem(VERSION_KEY);
    return stored ? Number(stored) : 1;
  } catch {
    return TUTORIEL_VERSION;
  }
}

// Ne concerne que les joueurs qui ont déjà vu une version antérieure : un
// tout premier joueur (jamais vu) reçoit le didacticiel complet, pas les
// nouveautés — il n'a rien à comparer.
export function shouldShowNouveautes() {
  const seen = getSeenVersion();
  return seen > 0 && seen < TUTORIEL_VERSION;
}

export function markTutorielSeen() {
  try {
    localStorage.setItem(KEY, '1');
    localStorage.setItem(VERSION_KEY, String(TUTORIEL_VERSION));
  } catch {
    // pas grave si la persistance échoue, la session en cours reste correcte
  }
}
