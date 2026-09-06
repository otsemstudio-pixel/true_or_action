export class ContentError extends Error {
  constructor(code, message, details = null) {
    super(message || code);
    this.name = 'ContentError';
    this.code = code;
    this.details = details;
  }
}
