export class AuthError extends Error {
  constructor(code, message, status = 400, details = null) {
    super(message || code);
    this.name = 'AuthError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
