import { pool } from '../db/pool.js';

export async function findUserByEmail(email) {
  const res = await pool.query(
    'SELECT id, pseudo, email, password_hash, langue, theme FROM users WHERE email = $1',
    [email]
  );
  return res.rows[0] ?? null;
}

export async function findUserById(id) {
  const res = await pool.query('SELECT id, pseudo, langue, theme, is_guest FROM users WHERE id = $1', [id]);
  return res.rows[0] ?? null;
}

export async function createUser({ pseudo, email, passwordHash, langue, theme }) {
  const res = await pool.query(
    'INSERT INTO users (pseudo, email, password_hash, langue, theme) VALUES ($1, $2, $3, $4, $5) RETURNING id, pseudo, email, langue, theme',
    [pseudo, email, passwordHash, langue, theme]
  );
  return res.rows[0];
}

// --- comptes invités ---

export async function createGuestUser({ pseudo, guestToken, langue, theme }) {
  const res = await pool.query(
    `INSERT INTO users (pseudo, is_guest, guest_token, langue, theme, last_seen_at)
     VALUES ($1, true, $2, $3, $4, now())
     RETURNING id, pseudo, langue, theme, is_guest`,
    [pseudo, guestToken, langue, theme]
  );
  return res.rows[0];
}

export async function findUserByGuestToken(guestToken) {
  const res = await pool.query(
    'SELECT id, pseudo, langue, theme, is_guest FROM users WHERE guest_token = $1 AND is_guest = true',
    [guestToken]
  );
  return res.rows[0] ?? null;
}

export async function touchLastSeen(id) {
  await pool.query('UPDATE users SET last_seen_at = now() WHERE id = $1', [id]);
}

// Conserve tout (pseudo, historique, questions, packs — liés par id, jamais
// touchés ici) : seuls l'identifiant invité disparaît et les identifiants de
// compte complet apparaissent.
export async function convertGuestToFullAccount(id, { email, passwordHash }) {
  const res = await pool.query(
    `UPDATE users SET email = $1, password_hash = $2, is_guest = false, guest_token = NULL
     WHERE id = $3
     RETURNING id, pseudo, email, langue, theme, is_guest`,
    [email, passwordHash, id]
  );
  return res.rows[0];
}

// Tâche de nettoyage au démarrage (voir index.js) : un invité inactif depuis
// 90 jours est supprimé, mais jamais au prix d'une partie archivée — les
// références encore NOT NULL (votes, appartenance de salon, usages de
// règles, réponses de tour surprise) sont des lignes annexes propres à
// l'invité et sont supprimées avec lui ; les références nullables sur des
// données partagées (tours, messages, salons, signalements) passent à NULL
// pour que l'historique reste consultable sans jamais cascader sur `turns`.
export async function deleteInactiveGuests(db, { inactiveDays = 90 } = {}) {
  const { rows } = await db.query(
    `SELECT id FROM users WHERE is_guest = true AND last_seen_at < now() - ($1 || ' days')::interval`,
    [inactiveDays]
  );
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return 0;

  await db.query('UPDATE turns SET player_id = NULL WHERE player_id = ANY($1)', [ids]);
  await db.query('UPDATE turns SET returned_from_player_id = NULL WHERE returned_from_player_id = ANY($1)', [ids]);
  await db.query('UPDATE messages SET user_id = NULL WHERE user_id = ANY($1)', [ids]);
  await db.query('UPDATE rooms SET host_id = NULL WHERE host_id = ANY($1)', [ids]);
  await db.query('UPDATE signalements SET user_id = NULL WHERE user_id = ANY($1)', [ids]);
  await db.query('DELETE FROM votes WHERE voter_id = ANY($1)', [ids]);
  await db.query('DELETE FROM room_players WHERE user_id = ANY($1)', [ids]);
  await db.query('DELETE FROM regle_usages WHERE player_id = ANY($1)', [ids]);
  await db.query('DELETE FROM tour_surprise_reponses WHERE player_id = ANY($1)', [ids]);
  // questions.author_id (ON DELETE SET NULL) et packs.owner_id (ON DELETE
  // CASCADE) sont déjà gérés par leurs contraintes de clé étrangère.
  await db.query('DELETE FROM users WHERE id = ANY($1)', [ids]);

  return ids.length;
}

export async function updateUserLangue(id, langue) {
  await pool.query('UPDATE users SET langue = $1 WHERE id = $2', [langue, id]);
}

export async function updateUserTheme(id, theme) {
  await pool.query('UPDATE users SET theme = $1 WHERE id = $2', [theme, id]);
}
