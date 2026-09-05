import { AuthError } from './errors.js';
import { verifyToken } from './token.js';

export function requireAuth(req, res, next) {
  const header = req.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(new AuthError('UNAUTHORIZED', 'Authentification requise', 401));
  }

  try {
    req.user = verifyToken(token);
    next();
  } catch {
    next(new AuthError('INVALID_TOKEN', 'Token invalide ou expiré', 401));
  }
}
