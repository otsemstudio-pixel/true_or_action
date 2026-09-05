import { useState } from 'react';
import { useAuth } from '../hooks/useAuth.jsx';
import TextField from '../components/TextField.jsx';
import Button from '../components/Button.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';

const EMPTY_FORM = { pseudo: '', email: '', password: '' };

function AccueilScreen() {
  const { register, login } = useAuth();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const setField = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));

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

  const switchMode = () => {
    setMode((m) => (m === 'register' ? 'login' : 'register'));
    setError(null);
  };

  return (
    <div className="screen screen--centered">
      <header>
        <h1 className="logo">
          <span className="logo-action">Action</span>
          <span className="logo-sep">ou</span>
          <span className="logo-verite">Vérité</span>
        </h1>
        <p className="tagline">Salons privés, en temps réel, entre amis.</p>
      </header>

      <form className="card" onSubmit={handleSubmit}>
        {mode === 'register' && (
          <TextField
            id="pseudo"
            label="Pseudo"
            autoComplete="nickname"
            value={form.pseudo}
            onChange={setField('pseudo')}
            required
          />
        )}
        <TextField
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          value={form.email}
          onChange={setField('email')}
          required
        />
        <TextField
          id="password"
          label="Mot de passe"
          type="password"
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          value={form.password}
          onChange={setField('password')}
          required
        />

        <ErrorBanner>{error}</ErrorBanner>

        <Button type="submit" block busy={busy}>
          {mode === 'register' ? "S'inscrire" : 'Se connecter'}
        </Button>
      </form>

      <div className="switch-row">
        {mode === 'register' ? 'Déjà un compte ?' : 'Pas encore de compte ?'}
        <button type="button" className="link-btn" onClick={switchMode}>
          {mode === 'register' ? 'Se connecter' : "S'inscrire"}
        </button>
      </div>
    </div>
  );
}

export default AccueilScreen;
