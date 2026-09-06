import { Router } from 'express';
import crypto from 'node:crypto';
import { AuthError } from '../auth/errors.js';
import {
  validatePseudo,
  validateEmail,
  validatePassword,
  validateLangue,
  validateTheme,
  suffixedPseudo,
} from '../auth/validate.js';
import { hashPassword, comparePassword } from '../auth/hash.js';
import { signToken } from '../auth/token.js';
import {
  findUserByEmail,
  findUserById,
  createUser,
  updateUserLangue,
  updateUserTheme,
  createGuestUser,
  findUserByGuestToken,
  touchLastSeen,
  convertGuestToFullAccount,
} from '../auth/repository.js';
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
    res.status(201).json({
      token,
      user: { id: user.id, pseudo: user.pseudo, langue: user.langue, theme: user.theme, isGuest: false },
    });
  } catch (err) {
    next(err);
  }
});

// Un invité qui joue régulièrement : ajoute email + mot de passe, conserve
// tout le reste (pseudo, historique, questions, packs — liés par id, jamais
// touchés). Un nouveau token est renvoyé : l'ancien portait isGuest=true.
router.post('/convert', requireAuth, async (req, res, next) => {
  try {
    if (!req.user.isGuest) {
      throw new AuthError('NOT_A_GUEST', "Ce compte n'est pas un compte invité", 400);
    }
    const email = validateEmail(req.body?.email);
    const password = validatePassword(req.body?.password);
    const passwordHash = await hashPassword(password);

    let user;
    try {
      user = await convertGuestToFullAccount(req.user.id, { email, passwordHash });
    } catch (err) {
      if (err.code === '23505') {
        throw new AuthError('EMAIL_TAKEN', 'Cet email est déjà utilisé', 409);
      }
      throw err;
    }

    const token = signToken(user);
    res.json({
      token,
      user: { id: user.id, pseudo: user.pseudo, langue: user.langue, theme: user.theme, isGuest: false },
    });
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
    res.json({
      token,
      user: { id: user.id, pseudo: user.pseudo, langue: user.langue, theme: user.theme, isGuest: false },
    });
  } catch (err) {
    next(err);
  }
});

// Sans mot de passe ni email, un invité ne peut pas se reconnecter comme un
// compte normal : `guestToken` (généré à la création, gardé en localStorage
// côté client) tient ce rôle. Toujours un pseudo unique en trois secondes —
// si celui demandé est pris, une variante est proposée plutôt qu'un refus.
router.post('/guest', async (req, res, next) => {
  try {
    let pseudo = validatePseudo(req.body?.pseudo);
    const langue = validateLangue(req.body?.langue);
    const theme = validateTheme(req.body?.theme);
    const guestToken = crypto.randomBytes(32).toString('hex');

    let user;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        user = await createGuestUser({ pseudo, guestToken, langue, theme });
        break;
      } catch (err) {
        if (err.code === '23505' && err.constraint?.includes('pseudo') && attempt < 4) {
          pseudo = suffixedPseudo(pseudo);
          continue;
        }
        throw err;
      }
    }

    const token = signToken(user);
    res.status(201).json({
      token,
      guestToken,
      user: { id: user.id, pseudo: user.pseudo, langue: user.langue, theme: user.theme, isGuest: true },
    });
  } catch (err) {
    next(err);
  }
});

// Rejoue le rôle d'un identifiant/mot de passe pour un invité dont le JWT a
// expiré (jusqu'à 30 jours) : le jeton invité, lui, ne périme jamais tant
// que le compte n'est pas nettoyé pour inactivité (voir repository.js).
router.post('/guest/resume', async (req, res, next) => {
  try {
    const { guestToken } = req.body ?? {};
    if (typeof guestToken !== 'string' || !guestToken) {
      throw new AuthError('INVALID_GUEST_TOKEN', 'Jeton invité manquant', 401);
    }
    const user = await findUserByGuestToken(guestToken);
    if (!user) {
      throw new AuthError('GUEST_NOT_FOUND', 'Session invité introuvable', 401);
    }
    await touchLastSeen(user.id);

    const token = signToken(user);
    res.json({
      token,
      user: { id: user.id, pseudo: user.pseudo, langue: user.langue, theme: user.theme, isGuest: true },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    // La langue et le thème peuvent avoir changé depuis l'émission du token
    // (jusqu'à 30 jours) : on les relit toujours depuis la base plutôt que de
    // faire confiance au JWT. is_guest aussi (une conversion en compte complet
    // ne doit pas rester masquée tant que le token n'est pas renouvelé).
    const user = await findUserById(req.user.id);
    if (!user) {
      throw new AuthError('UNAUTHORIZED', 'Utilisateur introuvable', 401);
    }
    res.json({
      user: { id: user.id, pseudo: user.pseudo, langue: user.langue, theme: user.theme, isGuest: user.is_guest },
    });
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
