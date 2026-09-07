import { Router } from 'express';
import { requireAuth, requireFullAccount } from '../auth/middleware.js';
import { AuthError } from '../auth/errors.js';
import { findUserById } from '../auth/repository.js';
import { validateQuestionType, validateQuestionNiveau, validateQuestionContenu, validatePackId } from '../content/validate.js';
import { inheritQuestionLangue, assertPackQuestionLangue, assertQuestionNotBanned } from '../content/language.js';
import { inheritQuestionCategorie } from '../content/categorie.js';
import {
  findPackById,
  createQuestion,
  attachQuestionToPack,
  listQuestionsByAuthor,
  findOwnQuestionById,
  updateQuestionContent,
  deleteQuestion,
} from '../content/repository.js';

const router = Router();

// Proposition d'une question, seule ou rattachée à un pack existant que
// l'appelant possède. Va toujours directement en file de modération (voir
// createQuestion) : aucun chemin ne rend une question publique sans passage
// par un admin (voir Phase 3, pas encore construite).
router.post('/', requireAuth, requireFullAccount, async (req, res, next) => {
  try {
    const type = validateQuestionType(req.body?.type);
    const contenu = validateQuestionContenu(req.body?.contenu);
    const niveau = validateQuestionNiveau(req.body?.niveau);
    const packId = validatePackId(req.body?.packId);

    let pack = null;
    if (packId != null) {
      pack = await findPackById(packId);
      if (!pack || pack.owner_id !== req.user.id) {
        throw new AuthError('PACK_NOT_OWNED', "Ce pack n'existe pas ou ne vous appartient pas", 403);
      }
    }

    const author = await findUserById(req.user.id);
    const langue = inheritQuestionLangue(author.langue);
    if (pack) {
      assertPackQuestionLangue(pack.langue, langue);
    }
    // packs n'a pas de colonne categorie aujourd'hui (vérifié en base) : hors
    // salon, aucun contexte ne fournit de catégorie, donc DEFAULT_CATEGORIE
    // ('general') s'applique systématiquement ici. Signalé à l'utilisateur.
    const categorie = inheritQuestionCategorie(undefined);

    assertQuestionNotBanned(contenu, langue);

    const question = await createQuestion({ authorId: req.user.id, type, contenu, niveau, langue, categorie });
    if (packId != null) {
      await attachQuestionToPack(packId, question.id);
    }

    res.status(201).json({ question });
  } catch (err) {
    next(err);
  }
});

function parseQuestionId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new AuthError('INVALID_QUESTION_ID', 'Identifiant de question invalide', 400);
  }
  return id;
}

// "Gérer mes questions" : les siennes uniquement, tous statuts confondus —
// un changement de statut fait par un admin (Phase 3) est visible ici sans
// plomberie supplémentaire, c'est la même ligne, seul `moderation` change.
router.get('/mine', requireAuth, requireFullAccount, async (req, res, next) => {
  try {
    const questions = await listQuestionsByAuthor(req.user.id);
    res.json({ questions });
  } catch (err) {
    next(err);
  }
});

// Modifier/retirer ne sont permis que tant qu'aucun admin n'a encore tranché
// (moderation = 'en_attente') : passé ce point, la question a potentiellement
// déjà été vue/jouée ou explicitement rejetée, la rouvrir à la modification
// romprait la trace de ce qui a été validé ou refusé.
router.patch('/:id', requireAuth, requireFullAccount, async (req, res, next) => {
  try {
    const id = parseQuestionId(req.params.id);
    const existing = await findOwnQuestionById(id, req.user.id);
    if (!existing) {
      throw new AuthError('QUESTION_NOT_FOUND', "Cette question n'existe pas ou ne vous appartient pas", 404);
    }
    if (existing.moderation !== 'en_attente') {
      throw new AuthError(
        'QUESTION_NOT_EDITABLE',
        'Cette question a déjà été traitée par la modération et ne peut plus être modifiée',
        409
      );
    }

    const type = validateQuestionType(req.body?.type);
    const contenu = validateQuestionContenu(req.body?.contenu);
    const niveau = validateQuestionNiveau(req.body?.niveau);
    // langue et rattachement à un pack ne changent pas à l'édition : ils ont
    // déjà été validés l'un contre l'autre à la création (voir POST /).
    assertQuestionNotBanned(contenu, existing.langue.trim());

    const question = await updateQuestionContent(id, { type, contenu, niveau });
    res.json({ question });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireAuth, requireFullAccount, async (req, res, next) => {
  try {
    const id = parseQuestionId(req.params.id);
    const existing = await findOwnQuestionById(id, req.user.id);
    if (!existing) {
      throw new AuthError('QUESTION_NOT_FOUND', "Cette question n'existe pas ou ne vous appartient pas", 404);
    }
    if (existing.moderation !== 'en_attente') {
      throw new AuthError(
        'QUESTION_NOT_EDITABLE',
        'Cette question a déjà été traitée par la modération et ne peut plus être retirée',
        409
      );
    }

    await deleteQuestion(id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
