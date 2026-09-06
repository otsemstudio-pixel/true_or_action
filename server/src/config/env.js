import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variable d'environnement manquante: ${name}`);
  }
  return value;
}

const DEFAULT_CLIENT_ORIGIN = 'http://localhost:5173';

// Une ou plusieurs origines séparées par des virgules (ex: domaine de prod
// et sa variante www) — jamais une seule origine figée, pour ne pas avoir à
// choisir entre elles au déploiement.
function parseClientOrigins(raw) {
  return (raw || DEFAULT_CLIENT_ORIGIN)
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

export const env = {
  port: Number(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  clientOrigins: parseClientOrigins(process.env.CLIENT_ORIGIN),
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),
};

// CLIENT_ORIGIN oublié en production retombe silencieusement sur localhost :
// le vrai frontend se fait alors rejeter par CORS (HTTP) et par Socket.io
// (handshake), avec des symptômes qui ressemblent à un problème réseau plutôt
// qu'à ce réglage manquant. Un avertissement explicite au démarrage coûte
// moins cher qu'un diagnostic à l'aveugle après coup.
if (env.nodeEnv === 'production' && env.clientOrigins.includes(DEFAULT_CLIENT_ORIGIN)) {
  console.warn(
    `ATTENTION : CLIENT_ORIGIN n'est pas défini (ou inclut encore ${DEFAULT_CLIENT_ORIGIN}) en production. ` +
      "L'origine du vrai frontend déployé doit être ajoutée, sans quoi CORS et le handshake Socket.io le rejetteront."
  );
}
