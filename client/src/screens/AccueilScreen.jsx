import { useState } from 'react';
import { useAuth } from '../hooks/useAuth.jsx';
import { useI18n } from '../hooks/useI18n.jsx';
import { translateError } from '../i18n/index.js';
import TextField from '../components/TextField.jsx';
import Button from '../components/Button.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import LangueSelector from '../components/LangueSelector.jsx';
import ThemeSelector from '../components/ThemeSelector.jsx';

const EMPTY_FORM = { pseudo: '', email: '', password: '' };

function AccueilScreen() {
  const { register, login, playAsGuest } = useAuth();
  const { t } = useI18n();
  const [mode, setMode] = useState('login'); // login | register | guest
  const [form, setForm] = useState(EMPTY_FORM);
  const [guestPseudo, setGuestPseudo] = useState('');
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
      } else if (mode === 'guest') {
        await playAsGuest(guestPseudo);
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

  const toggleGuestMode = () => {
    setMode((m) => (m === 'guest' ? 'login' : 'guest'));
    setError(null);
  };

  return (
    <div className="screen screen--centered accueil-screen">
      <div className="accueil-toolbar">
        <LangueSelector />
        <ThemeSelector />
      </div>

      <header className="accueil-header">
        <h1 className="accueil-title">
          <span className="accueil-title-line accueil-title-line--action">{t('accueil.logoAction')}</span>
          <span className="accueil-title-sep">{t('accueil.logoSep')}</span>
          <span className="accueil-title-line accueil-title-line--verite">{t('accueil.logoVerite')}</span>
        </h1>
        <svg className="accueil-squiggle" viewBox="0 0 160 16" aria-hidden="true">
          <path d="M2 10 C 20 2, 40 2, 58 10 S 96 18, 114 10 S 142 2, 158 10" />
        </svg>
        <p className="tagline accueil-tagline">{t('accueil.tagline')}</p>
      </header>

      <form className="accueil-card" onSubmit={handleSubmit}>
        {mode === 'guest' ? (
          <TextField
            id="guest-pseudo"
            label={t('accueil.pseudo')}
            autoComplete="nickname"
            value={guestPseudo}
            onChange={(e) => setGuestPseudo(e.target.value)}
            required
          />
        ) : (
          <>
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
              hint={mode === 'register' ? t('accueil.motDePasseHint') : undefined}
              required
            />
          </>
        )}

        <ErrorBanner>{error}</ErrorBanner>

        <Button type="submit" variant="dark" block arrow busy={busy}>
          {mode === 'guest' ? t('accueil.jouer') : mode === 'register' ? t('accueil.sInscrire') : t('accueil.seConnecter')}
        </Button>
      </form>

      {mode === 'guest' ? (
        <div className="switch-row">
          <button type="button" className="link-btn" onClick={toggleGuestMode}>
            {t('accueil.revenirConnexion')}
          </button>
        </div>
      ) : (
        <>
          <div className="switch-row">
            {mode === 'register' ? t('accueil.dejaUnCompte') : t('accueil.pasEncoreDeCompte')}
            <button type="button" className="link-btn" onClick={switchMode}>
              {mode === 'register' ? t('accueil.seConnecter') : t('accueil.sInscrire')}
            </button>
          </div>
          <Button type="button" variant="ghost" block onClick={toggleGuestMode}>
            {t('accueil.jouerSansCompte')}
          </Button>
        </>
      )}
    </div>
  );
}

export default AccueilScreen;
