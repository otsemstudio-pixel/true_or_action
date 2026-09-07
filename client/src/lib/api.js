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

export function register({ pseudo, email, password, langue, theme }) {
  return request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ pseudo, email, password, langue, theme }),
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

export function playAsGuest({ pseudo, langue, theme }) {
  return request('/api/auth/guest', {
    method: 'POST',
    body: JSON.stringify({ pseudo, langue, theme }),
  });
}

export function resumeGuest(guestToken) {
  return request('/api/auth/guest/resume', {
    method: 'POST',
    body: JSON.stringify({ guestToken }),
  });
}

export function convertGuest(token, { email, password }) {
  return request('/api/auth/convert', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ email, password }),
  });
}

export function updateLangue(token, langue) {
  return request('/api/auth/langue', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ langue }),
  });
}

export function updateTheme(token, theme) {
  return request('/api/auth/theme', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ theme }),
  });
}

export function fetchMyQuestions(token) {
  return request('/api/questions/mine', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function proposeQuestion(token, { type, contenu, niveau, packId }) {
  return request('/api/questions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ type, contenu, niveau, packId }),
  });
}

export function updateQuestion(token, id, { type, contenu, niveau }) {
  return request(`/api/questions/${id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ type, contenu, niveau }),
  });
}

export function withdrawQuestion(token, id) {
  return request(`/api/questions/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function fetchPendingQuestions(token) {
  return request('/api/admin/questions/en-attente', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function approvePendingQuestion(token, id) {
  return request(`/api/admin/questions/${id}/approve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function rejectPendingQuestion(token, id) {
  return request(`/api/admin/questions/${id}/reject`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function fetchReportedQuestions(token) {
  return request('/api/admin/questions/signalees', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function unpublishQuestion(token, id) {
  return request(`/api/admin/questions/${id}/unpublish`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
}
