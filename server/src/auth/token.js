import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

const EXPIRES_IN = '30d';

export function signToken(user) {
  return jwt.sign({ pseudo: user.pseudo }, env.jwtSecret, {
    subject: String(user.id),
    expiresIn: EXPIRES_IN,
  });
}

export function verifyToken(token) {
  const payload = jwt.verify(token, env.jwtSecret);
  return { id: Number(payload.sub), pseudo: payload.pseudo };
}
