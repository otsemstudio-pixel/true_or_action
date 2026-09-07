import { pool } from '../db/pool.js';

export async function findPackById(id) {
  const res = await pool.query('SELECT id, owner_id, langue FROM packs WHERE id = $1', [id]);
  return res.rows[0] ?? null;
}

// moderation/is_public fixés explicitement plutôt que laissés aux valeurs par
// défaut de la colonne (moderation vaut 'prive' par défaut, pas 'en_attente')
// : une question proposée entre toujours directement dans la file de
// modération, jamais dans un état "privé" intermédiaire.
export async function createQuestion({ authorId, type, contenu, niveau, langue, categorie }) {
  const res = await pool.query(
    `INSERT INTO questions (author_id, type, contenu, niveau, langue, categorie, is_public, moderation)
     VALUES ($1, $2, $3, $4, $5, $6, false, 'en_attente')
     RETURNING id, author_id, type, contenu, niveau, langue, categorie, is_public, moderation, created_at`,
    [authorId, type, contenu, niveau, langue, categorie]
  );
  return res.rows[0];
}

export async function attachQuestionToPack(packId, questionId) {
  await pool.query('INSERT INTO pack_questions (pack_id, question_id) VALUES ($1, $2)', [packId, questionId]);
}

export async function listQuestionsByAuthor(authorId) {
  const res = await pool.query(
    `SELECT id, type, contenu, niveau, langue, categorie, is_public, moderation, votes_positifs, parties_jouees, created_at
     FROM questions WHERE author_id = $1 ORDER BY created_at DESC`,
    [authorId]
  );
  return res.rows;
}

// Filtré par auteur dès la requête (pas juste vérifié après coup) : une
// question qui ne matche pas les deux n'existe tout simplement pas pour cet
// appelant, jamais une histoire de permission à part.
export async function findOwnQuestionById(id, authorId) {
  const res = await pool.query('SELECT * FROM questions WHERE id = $1 AND author_id = $2', [id, authorId]);
  return res.rows[0] ?? null;
}

export async function updateQuestionContent(id, { type, contenu, niveau }) {
  const res = await pool.query(
    `UPDATE questions SET type = $1, contenu = $2, niveau = $3 WHERE id = $4
     RETURNING id, author_id, type, contenu, niveau, langue, categorie, is_public, moderation, created_at`,
    [type, contenu, niveau, id]
  );
  return res.rows[0];
}

// pack_questions et signalements référençant cette question sont en CASCADE
// (vérifié en base) : rien d'autre à nettoyer explicitement ici.
export async function deleteQuestion(id) {
  await pool.query('DELETE FROM questions WHERE id = $1', [id]);
}

// --- modération (admin) ---

// Sans filtre auteur (contrairement à findOwnQuestionById) : un admin doit
// pouvoir retrouver n'importe quelle question pour distinguer "n'existe pas"
// de "déjà traitée" après un approve/reject qui n'a touché aucune ligne.
export async function findQuestionById(id) {
  const res = await pool.query('SELECT * FROM questions WHERE id = $1', [id]);
  return res.rows[0] ?? null;
}

// pseudo de l'auteur joint pour l'affichage admin (repérer un compte qui
// propose beaucoup de contenu refusé) ; LEFT JOIN pour ne pas faire
// disparaître une question dont l'auteur invité a depuis été nettoyé
// (author_id passe à NULL, voir deleteInactiveGuests).
export async function listPendingQuestions() {
  const res = await pool.query(
    `SELECT q.id, q.author_id, u.pseudo AS author_pseudo, q.type, q.contenu, q.niveau, q.langue, q.categorie, q.created_at
     FROM questions q LEFT JOIN users u ON u.id = q.author_id
     WHERE q.moderation = 'en_attente'
     ORDER BY q.created_at ASC`
  );
  return res.rows;
}

// La clause moderation = 'en_attente' dans le WHERE (pas juste un check après
// coup) rend l'opération atomique : si un autre admin a déjà tranché entre
// temps, cette requête ne touche aucune ligne plutôt que d'écraser sa décision.
export async function approveQuestion(id) {
  const res = await pool.query(
    `UPDATE questions SET moderation = 'public', is_public = true
     WHERE id = $1 AND moderation = 'en_attente'
     RETURNING id, author_id, type, contenu, niveau, langue, categorie, is_public, moderation, created_at`,
    [id]
  );
  return res.rows[0] ?? null;
}

export async function rejectQuestion(id) {
  const res = await pool.query(
    `UPDATE questions SET moderation = 'rejete'
     WHERE id = $1 AND moderation = 'en_attente'
     RETURNING id, author_id, type, contenu, niveau, langue, categorie, is_public, moderation, created_at`,
    [id]
  );
  return res.rows[0] ?? null;
}

// --- signalements (admin) ---

// JOIN (pas LEFT JOIN) sur signalements : seules les questions ayant au
// moins un signalement nous intéressent ici, le group by + count s'en charge
// naturellement. LEFT JOIN sur rooms : un salon peut avoir été nettoyé depuis
// (room_id passe alors à NULL, voir la contrainte ON DELETE SET NULL) sans
// que le signalement lui-même ne doive disparaître de l'historique.
export async function listReportedQuestions() {
  const res = await pool.query(
    `SELECT q.id, q.type, q.contenu, q.niveau, q.langue, q.categorie, q.is_public, q.moderation,
            COUNT(s.id)::int AS signalement_count,
            json_agg(json_build_object('roomCode', r.code, 'createdAt', s.created_at) ORDER BY s.created_at DESC) AS signalements
     FROM questions q
     JOIN signalements s ON s.question_id = q.id
     LEFT JOIN rooms r ON r.id = s.room_id
     GROUP BY q.id
     ORDER BY COUNT(s.id) DESC, MAX(s.created_at) DESC`
  );
  return res.rows;
}

// Dépublication : une question déjà publique qu'on retire suite à des
// signalements. Distinct de rejectQuestion (qui ne s'applique qu'à
// 'en_attente') — le WHERE moderation = 'public' rend celle-ci atomique de
// la même façon. is_public repasse à false immédiatement : seuls les FUTURS
// tirages excluent la question (fetchQuestionBank filtre sur is_public),
// un tour déjà en cours qui l'a déjà tirée garde sa référence par id et n'est
// jamais affecté rétroactivement (vérifié en direct, voir rapport de phase).
export async function unpublishQuestion(id) {
  const res = await pool.query(
    `UPDATE questions SET moderation = 'rejete', is_public = false
     WHERE id = $1 AND moderation = 'public'
     RETURNING id, author_id, type, contenu, niveau, langue, categorie, is_public, moderation, created_at`,
    [id]
  );
  return res.rows[0] ?? null;
}
