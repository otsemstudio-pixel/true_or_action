export const POINTS = {
  verite: 1,
  action: 2,
};

export const VOTE_BONUS = 1;
// Au-delà, un pouce supplémentaire ne rapporte plus rien : évite qu'un tour
// dans un salon à 20 joueurs ne rapporte des dizaines de points d'un coup.
export const VOTE_BONUS_MAX = 5;

export const TIMERS = {
  // Nouveau défaut : 90s cassait le rythme, surtout à plusieurs joueurs.
  // Réglable par l'hôte (voir game/room.js updateAnswerSec) parmi
  // answerSecOptions ; cette constante ne sert plus que de valeur par défaut
  // à la création d'un salon.
  answerMs: 45_000,
  answerSecOptions: [30, 45, 60, 90],
  // Minuteur de vote : volontairement non réglable (voir tâche).
  voteMs: 30_000,
  disconnectGraceMs: 120_000,
};

export const PLAYERS = {
  min: 2,
  max: 20,
  defaultMax: 8,
  // Le mode couple verrouille le salon à ce nombre exact de joueurs, ni
  // plus ni moins (voir game/room.js updateCategorie/createRoom).
  coupleMax: 2,
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
  // Règle G : le bluff assumé (avec mise collective). Premier bonus versé
  // directement à un VOTANT (pas au joueur actif) dans tout ce fichier —
  // aligné sur pariMutuelPoints, déjà la valeur "devinette correcte"
  // ailleurs, pour ne pas inventer une échelle séparée.
  bluffVoteCorrectPoints: 2,
  bluffLiarMultiplicateur: 2,
};

// Règle G : montants de mise autorisés sur la sincérité du joueur actif.
export const BLUFF_MISE_MONTANTS = [1, 2];

// Règle F : le joker du public — contrainte de style tirée au sort, aucun
// vocabulaire équivalent n'existait ailleurs dans le jeu (vérifié avant
// d'écrire cette liste). Clés stables, jamais affichées brutes : le client
// les traduit via regles.jokerPublic.contraintes.<clé>.
export const JOKER_CONTRAINTES = [
  'phrase',
  'chuchote',
  'rime',
  'yeuxFermes',
  'troisiemePersonne',
  'sansJe',
  'chante',
];

export const REGLES_TIMERS = {
  niveauChoiceMs: 15_000, // fenêtre pour accepter/refuser le double ou rien
  questionChoiceMs: 20_000, // fenêtre pour choisir parmi les 3 questions proposées
  jugementMs: 20_000, // fenêtre pour juger le pari mutuel ("vu juste" / "à côté")
};
