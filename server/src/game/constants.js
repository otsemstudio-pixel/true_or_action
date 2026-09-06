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
