import { pool } from '../db/pool.js';

export async function fetchQuestionBank({ niveauMax = 1 } = {}) {
  const res = await pool.query(
    `SELECT id, type, contenu FROM questions WHERE is_public = true AND niveau <= $1`,
    [niveauMax]
  );

  const questionPool = { verite: [], action: [] };
  const byId = new Map();

  for (const row of res.rows) {
    questionPool[row.type].push(row.id);
    byId.set(row.id, row.contenu);
  }

  return { questionPool, byId };
}
