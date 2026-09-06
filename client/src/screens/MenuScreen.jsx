import { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth.jsx';
import { useRoom } from '../hooks/useRoom.jsx';
import { useI18n } from '../hooks/useI18n.jsx';
import { translateError } from '../i18n/index.js';
import Button from '../components/Button.jsx';
import TextField from '../components/TextField.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import LangueSelector from '../components/LangueSelector.jsx';
import ThemeSelector from '../components/ThemeSelector.jsx';
import Tutoriel from '../components/Tutoriel.jsx';
import { hasTutorielSeen, markTutorielSeen } from '../lib/tutoriel.js';

const DEFAULT_MAX_TURNS = 10;

function MenuScreen() {
  const { user, logout } = useAuth();
  const { createRoom, joinRoom } = useRoom();
  const { t, langue } = useI18n();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(null); // 'create' | 'join' | null
  const [error, setError] = useState(null);
  const [tutorielOpen, setTutorielOpen] = useState(false);

  // Proposé automatiquement une seule fois, avant la première partie du
  // joueur : le booléen en localStorage suffit, pas besoin de le stocker
  // côté serveur.
  useEffect(() => {
    if (!hasTutorielSeen()) setTutorielOpen(true);
  }, []);

  const closeTutoriel = () => {
    markTutorielSeen();
    setTutorielOpen(false);
  };

  const handleCreate = async () => {
    setError(null);
    setBusy('create');
    try {
      await createRoom({ maxTurns: DEFAULT_MAX_TURNS, langue });
    } catch (err) {
      setError(translateError(t, err));
    } finally {
      setBusy(null);
    }
  };

  const handleJoin = async (e) => {
    e.preventDefault();
    if (!code.trim()) return;
    setError(null);
    setBusy('join');
    try {
      await joinRoom(code.trim().toUpperCase());
    } catch (err) {
      setError(translateError(t, err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="screen menu-screen">
      <div className="menu-toolbar">
        <LangueSelector />
        <ThemeSelector />
      </div>

      <div className="menu-header-row">
        <button type="button" className="link-btn" onClick={() => setTutorielOpen(true)}>
          {t('menu.commentJouer')}
        </button>
        <button type="button" className="link-btn" onClick={logout}>
          {t('menu.seDeconnecter')}
        </button>
      </div>

      <h1 className="menu-greeting">{t('menu.salut', { pseudo: user.pseudo })}</h1>

      <ErrorBanner>{error}</ErrorBanner>

      <div className="menu-block menu-block--action">
        <Button variant="dark" block arrow busy={busy === 'create'} disabled={busy !== null} onClick={handleCreate}>
          {t('menu.creerUnSalon')}
        </Button>
        <p className="menu-block-hint">{t('menu.creerUnSalonHint')}</p>
      </div>

      <form className="menu-block menu-block--verite" onSubmit={handleJoin}>
        <TextField
          id="room-code"
          label={t('menu.codeDuSalon')}
          placeholder={t('menu.codeDuSalonPlaceholder')}
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
        <Button type="submit" variant="dark" block arrow busy={busy === 'join'} disabled={busy !== null || !code.trim()}>
          {t('menu.rejoindre')}
        </Button>
      </form>

      <div className="menu-block menu-block--muted">
        <Button variant="ghost" block disabled>
          {t('menu.gererMesQuestions')}
        </Button>
        <p className="menu-block-hint">{t('menu.bientotDisponible')}</p>
      </div>

      <Tutoriel open={tutorielOpen} onClose={closeTutoriel} />
    </div>
  );
}

export default MenuScreen;
