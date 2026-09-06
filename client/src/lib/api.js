import { API_URL } from './env.js';

async function request(path, options = {}) {
  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
    });
  } catch {
    const error = new Error('Erreur réseau');
    error.code = 'NETWORK_ERROR';
    throw error;
  }

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const error = new Error(data?.message ?? 'Erreur réseau');
    error.code = data?.code ?? 'NETWORK_ERROR';
    error.details = data?.details ?? null;
    throw error;
  }

  return data;
}

export function register({ pseudo, email, password, langue }) {
  return request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ pseudo, email, password, langue }),
  });
}

export function login({ email, password }) {
  return request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export function fetchMe(token) {
  return request('/api/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function updateLangue(token, langue) {
  return request('/api/auth/langue', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ langue }),
  });
}
