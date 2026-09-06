export const POINTS = {
  verite: 1,
  action: 2,
};

export const VOTE_BONUS = 1;

export const TIMERS = {
  answerMs: 90_000,
  voteMs: 30_000,
  disconnectGraceMs: 120_000,
};

export const PLAYERS = {
  min: 2,
  max: 8,
};

export const CHAT = {
  maxLength: 300,
  rateLimit: { count: 5, windowMs: 10_000 },
};

// Règles optionnelles (point 3) : constantes de score et de timing propres à
// chacune. Regroupées ici plutôt que dispersées dans turn.js pour que les
// valeurs (malus, multiplicateur, fenêtres de temps) restent visibles d'un
// coup d'œil et faciles à ajuster.
export const REGLES = {
  refusMalus: -2,
  doubleOuRienMultiplicateur: 2,
  tourSurpriseChance: 0.2, // 1 tour sur 5 en moyenne
  tourSurprisePointsGagnant: 3,
  tourSurprisePointsParticipant: 1,
  pariMutuelPoints: 2,
};

export const REGLES_TIMERS = {
  niveauChoiceMs: 15_000, // fenêtre pour accepter/refuser le double ou rien
  questionChoiceMs: 20_000, // fenêtre pour choisir parmi les 3 questions proposées
  jugementMs: 20_000, // fenêtre pour juger le pari mutuel ("vu juste" / "à côté")
};
