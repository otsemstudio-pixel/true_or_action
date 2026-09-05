import { pool } from '../db/pool.js';

export async function findUserByEmail(email) {
  const res = await pool.query(
    'SELECT id, pseudo, email, password_hash FROM users WHERE email = $1',
    [email]
  );
  return res.rows[0] ?? null;
}

export async function createUser({ pseudo, email, passwordHash }) {
  const res = await pool.query(
    'INSERT INTO users (pseudo, email, password_hash) VALUES ($1, $2, $3) RETURNING id, pseudo, email',
    [pseudo, email, passwordHash]
  );
  return res.rows[0];
}
