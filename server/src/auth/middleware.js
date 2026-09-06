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

// Un compte invité est traité comme un utilisateur normal partout, sauf là
// où c'est explicitement interdit (aujourd'hui : la file de modération —
// aucune route de ce type n'existe encore, ce garde-fou est prêt pour elle).
export function requireFullAccount(req, res, next) {
  if (req.user?.isGuest) {
    return next(new AuthError('GUEST_NOT_ALLOWED', 'Cette action est réservée aux comptes complets', 403));
  }
  next();
}
