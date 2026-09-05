import { useState } from 'react';
import { useAuth } from './hooks/useAuth.jsx';

function App() {
  const { user, status, register, login, logout } = useAuth();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ pseudo: '', email: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (status === 'loading') {
    return (
      <main>
        <p>Chargement…</p>
      </main>
    );
  }

  if (status === 'authenticated') {
    return (
      <main>
        <p>Connecté en tant que {user.pseudo} (id {user.id})</p>
        <button type="button" onClick={logout}>
          Se déconnecter
        </button>
      </main>
    );
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'register') {
        await register(form);
      } else {
        await login({ email: form.email, password: form.password });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main>
      <p>Structure d'authentification initialisée (écran provisoire, sera remplacé à l'étape 6).</p>
      <form onSubmit={handleSubmit}>
        {mode === 'register' && (
          <div>
            <label htmlFor="pseudo">Pseudo</label>
            <input
              id="pseudo"
              value={form.pseudo}
              onChange={(e) => setForm({ ...form, pseudo: e.target.value })}
            />
          </div>
        )}
        <div>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </div>
        <div>
          <label htmlFor="password">Mot de passe</label>
          <input
            id="password"
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </div>
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={busy}>
          {mode === 'register' ? "S'inscrire" : 'Se connecter'}
        </button>
      </form>
      <button type="button" onClick={() => setMode(mode === 'register' ? 'login' : 'register')}>
        {mode === 'register' ? "J'ai déjà un compte" : "Créer un compte"}
      </button>
    </main>
  );
}

export default App;
