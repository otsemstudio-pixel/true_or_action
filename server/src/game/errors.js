export class GameError extends Error {
  constructor(code, message, details = null) {
    super(message || code);
    this.name = 'GameError';
    this.code = code;
    this.details = details;
  }
}
