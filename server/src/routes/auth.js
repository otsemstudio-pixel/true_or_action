import { Router } from 'express';
import { AuthError } from '../auth/errors.js';
import { validatePseudo, validateEmail, validatePassword, validateLangue, validateTheme } from '../auth/validate.js';
import { hashPassword, comparePassword } from '../auth/hash.js';
import { signToken } from '../auth/token.js';
import { findUserByEmail, findUserById, createUser, updateUserLangue, updateUserTheme } from '../auth/repository.js';
import { requireAuth } from '../auth/middleware.js';

const router = Router();

router.post('/register', async (req, res, next) => {
  try {
    const pseudo = validatePseudo(req.body?.pseudo);
    const email = validateEmail(req.body?.email);
    const password = validatePassword(req.body?.password);
    const langue = validateLangue(req.body?.langue);
    const theme = validateTheme(req.body?.theme);

    const passwordHash = await hashPassword(password);

    let user;
    try {
      user = await createUser({ pseudo, email, passwordHash, langue, theme });
    } catch (err) {
      if (err.code === '23505') {
        const field = err.constraint?.includes('pseudo') ? 'pseudo' : 'email';
        throw new AuthError(
          field === 'pseudo' ? 'PSEUDO_TAKEN' : 'EMAIL_TAKEN',
          field === 'pseudo' ? 'Ce pseudo est déjà pris' : 'Cet email est déjà utilisé',
          409
        );
      }
      throw err;
    }

    const token = signToken(user);
    res.status(201).json({ token, user: { id: user.id, pseudo: user.pseudo, langue: user.langue, theme: user.theme } });
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const email = validateEmail(req.body?.email);
    const password = req.body?.password;
    if (typeof password !== 'string' || !password) {
      throw new AuthError('INVALID_CREDENTIALS', 'Email ou mot de passe incorrect', 401);
    }

    const user = await findUserByEmail(email);
    if (!user) {
      throw new AuthError('INVALID_CREDENTIALS', 'Email ou mot de passe incorrect', 401);
    }

    const match = await comparePassword(password, user.password_hash);
    if (!match) {
      throw new AuthError('INVALID_CREDENTIALS', 'Email ou mot de passe incorrect', 401);
    }

    const token = signToken(user);
    res.json({ token, user: { id: user.id, pseudo: user.pseudo, langue: user.langue, theme: user.theme } });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    // La langue et le thème peuvent avoir changé depuis l'émission du token
    // (jusqu'à 30 jours) : on les relit toujours depuis la base plutôt que de
    // faire confiance au JWT.
    const user = await findUserById(req.user.id);
    if (!user) {
      throw new AuthError('UNAUTHORIZED', 'Utilisateur introuvable', 401);
    }
    res.json({ user: { id: user.id, pseudo: user.pseudo, langue: user.langue, theme: user.theme } });
  } catch (err) {
    next(err);
  }
});

router.post('/langue', requireAuth, async (req, res, next) => {
  try {
    const langue = validateLangue(req.body?.langue);
    await updateUserLangue(req.user.id, langue);
    res.json({ langue });
  } catch (err) {
    next(err);
  }
});

router.post('/theme', requireAuth, async (req, res, next) => {
  try {
    const theme = validateTheme(req.body?.theme);
    await updateUserTheme(req.user.id, theme);
    res.json({ theme });
  } catch (err) {
    next(err);
  }
});

export default router;
