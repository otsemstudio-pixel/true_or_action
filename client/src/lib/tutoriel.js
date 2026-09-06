const KEY = 'tord_tutoriel_vu';

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

export function markTutorielSeen() {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    // pas grave si la persistance échoue, la session en cours reste correcte
  }
}
