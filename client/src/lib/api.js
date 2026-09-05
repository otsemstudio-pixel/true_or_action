const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

async function request(path, options = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const error = new Error(data?.message ?? 'Erreur réseau');
    error.code = data?.code ?? 'NETWORK_ERROR';
    throw error;
  }

  return data;
}

export function register({ pseudo, email, password }) {
  return request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ pseudo, email, password }),
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
