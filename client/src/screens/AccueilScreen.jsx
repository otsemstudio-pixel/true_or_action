import { useState } from 'react';
import { useAuth } from '../hooks/useAuth.jsx';
import { useI18n } from '../hooks/useI18n.jsx';
import { translateError } from '../i18n/index.js';
import TextField from '../components/TextField.jsx';
import Button from '../components/Button.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import LangueSelector from '../components/LangueSelector.jsx';

const EMPTY_FORM = { pseudo: '', email: '', password: '' };

function AccueilScreen() {
  const { register, login } = useAuth();
  const { t } = useI18n();
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
      setError(translateError(t, err));
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
      <LangueSelector />

      <header>
        <h1 className="logo">
          <span className="logo-action">{t('accueil.logoAction')}</span>
          <span className="logo-sep">{t('accueil.logoSep')}</span>
          <span className="logo-verite">{t('accueil.logoVerite')}</span>
        </h1>
        <p className="tagline">{t('accueil.tagline')}</p>
      </header>

      <form className="card" onSubmit={handleSubmit}>
        {mode === 'register' && (
          <TextField
            id="pseudo"
            label={t('accueil.pseudo')}
            autoComplete="nickname"
            value={form.pseudo}
            onChange={setField('pseudo')}
            required
          />
        )}
        <TextField
          id="email"
          label={t('accueil.email')}
          type="email"
          autoComplete="email"
          value={form.email}
          onChange={setField('email')}
          required
        />
        <TextField
          id="password"
          label={t('accueil.motDePasse')}
          type="password"
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          value={form.password}
          onChange={setField('password')}
          required
        />

        <ErrorBanner>{error}</ErrorBanner>

        <Button type="submit" block busy={busy}>
          {mode === 'register' ? t('accueil.sInscrire') : t('accueil.seConnecter')}
        </Button>
      </form>

      <div className="switch-row">
        {mode === 'register' ? t('accueil.dejaUnCompte') : t('accueil.pasEncoreDeCompte')}
        <button type="button" className="link-btn" onClick={switchMode}>
          {mode === 'register' ? t('accueil.seConnecter') : t('accueil.sInscrire')}
        </button>
      </div>
    </div>
  );
}

export default AccueilScreen;
