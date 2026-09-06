import { pool } from '../db/pool.js';

export async function findUserByEmail(email) {
  const res = await pool.query(
    'SELECT id, pseudo, email, password_hash, langue FROM users WHERE email = $1',
    [email]
  );
  return res.rows[0] ?? null;
}

export async function findUserById(id) {
  const res = await pool.query('SELECT id, pseudo, langue FROM users WHERE id = $1', [id]);
  return res.rows[0] ?? null;
}

export async function createUser({ pseudo, email, passwordHash, langue }) {
  const res = await pool.query(
    'INSERT INTO users (pseudo, email, password_hash, langue) VALUES ($1, $2, $3, $4) RETURNING id, pseudo, email, langue',
    [pseudo, email, passwordHash, langue]
  );
  return res.rows[0];
}

export async function updateUserLangue(id, langue) {
  await pool.query('UPDATE users SET langue = $1 WHERE id = $2', [langue, id]);
}
