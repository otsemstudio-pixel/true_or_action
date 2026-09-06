export const POINTS = {
  verite: 1,
  action: 2,
};

export const VOTE_BONUS = 1;
// Au-delà, un pouce supplémentaire ne rapporte plus rien : évite qu'un tour
// dans un salon à 20 joueurs ne rapporte des dizaines de points d'un coup.
export const VOTE_BONUS_MAX = 5;

export const TIMERS = {
  answerMs: 90_000,
  voteMs: 30_000,
  disconnectGraceMs: 120_000,
};

export const PLAYERS = {
  min: 2,
  max: 20,
  defaultMax: 8,
};

// Un tour n'attend plus tout le monde pour se résoudre : 60% des votants
// éligibles suffisent (sinon l'expiration du minuteur de vote tranche) — dans
// un salon à 20 joueurs, attendre les 19 votes serait irréaliste.
export const VOTE_QUORUM_RATIO = 0.6;

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
