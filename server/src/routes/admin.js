import { Router } from 'express';
import { requireAuth, requireAdmin } from '../auth/middleware.js';
import { AuthError } from '../auth/errors.js';
import {
  listPendingQuestions,
  approveQuestion,
  rejectQuestion,
  findQuestionById,
  listReportedQuestions,
  unpublishQuestion,
} from '../content/repository.js';

const router = Router();

function parseQuestionId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new AuthError('INVALID_QUESTION_ID', 'Identifiant de question invalide', 400);
  }
  return id;
}

// Chaque route ici est protégée côté serveur par requireAdmin (pas
// seulement masquée côté client) : un compte non-admin qui appelle ces
// routes directement se voit toujours opposer un refus, voir Phase 5.
router.get('/questions/en-attente', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const questions = await listPendingQuestions();
    res.json({ questions });
  } catch (err) {
    next(err);
  }
});

// La clause moderation = 'en_attente' du repository rend approve/reject
// atomiques : 0 ligne affectée peut vouloir dire "n'existe pas" ou "déjà
// traitée" — distingué ici par une relecture, seulement dans ce cas rare.
async function resolveQuestionAction(id, action) {
  const question = await action(id);
  if (question) return question;

  const existing = await findQuestionById(id);
  if (!existing) {
    throw new AuthError('QUESTION_NOT_FOUND', "Cette question n'existe pas", 404);
  }
  throw new AuthError('QUESTION_ALREADY_MODERATED', 'Cette question a déjà été traitée par la modération', 409);
}

router.post('/questions/:id/approve', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = parseQuestionId(req.params.id);
    const question = await resolveQuestionAction(id, approveQuestion);
    res.json({ question });
  } catch (err) {
    next(err);
  }
});

router.post('/questions/:id/reject', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = parseQuestionId(req.params.id);
    const question = await resolveQuestionAction(id, rejectQuestion);
    res.json({ question });
  } catch (err) {
    next(err);
  }
});

router.get('/questions/signalees', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const questions = await listReportedQuestions();
    res.json({ questions });
  } catch (err) {
    next(err);
  }
});

router.post('/questions/:id/unpublish', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = parseQuestionId(req.params.id);
    const question = await resolveQuestionAction(id, unpublishQuestion);
    res.json({ question });
  } catch (err) {
    next(err);
  }
});

export default router;
