import { AuthError } from './errors.js';
import { verifyToken } from './token.js';
import { pool } from '../db/pool.js';

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

// Lit is_admin en base à chaque requête plutôt que depuis le token : ce rôle
// est attribué manuellement en base (jamais via l'application, voir
// repository.js), une lecture fraîche évite d'avoir à se reconnecter après
// coup et reflète aussi immédiatement une éventuelle révocation future.
export async function requireAdmin(req, res, next) {
  try {
    const { rows } = await pool.query('SELECT is_admin FROM users WHERE id = $1', [req.user?.id]);
    if (!rows[0]?.is_admin) {
      return next(new AuthError('ADMIN_ONLY', 'Cette action est réservée aux administrateurs', 403));
    }
    next();
  } catch (err) {
    next(err);
  }
}
