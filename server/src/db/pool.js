import pg from 'pg';
import { env } from '../config/env.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: env.databaseUrl,
  ssl: { rejectUnauthorized: false },
});

pool.on('error', (err) => {
  console.error('Erreur inattendue du pool pg:', err.code || err.name || 'erreur inconnue');
});
