import { useState } from 'react';
import { useAuth } from '../hooks/useAuth.jsx';
import { useRoom } from '../hooks/useRoom.jsx';
import { useI18n } from '../hooks/useI18n.jsx';
import { translateError } from '../i18n/index.js';
import Button from '../components/Button.jsx';
import TextField from '../components/TextField.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import LangueSelector from '../components/LangueSelector.jsx';

const DEFAULT_MAX_TURNS = 10;

function MenuScreen() {
  const { user, logout } = useAuth();
  const { createRoom, joinRoom } = useRoom();
  const { t, langue } = useI18n();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(null); // 'create' | 'join' | null
  const [error, setError] = useState(null);

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
    <div className="screen">
      <header>
        <p className="tagline">{t('menu.salut', { pseudo: user.pseudo })}</p>
        <div className="menu-header-row">
          <LangueSelector />
          <button type="button" className="link-btn" onClick={logout}>
            {t('menu.seDeconnecter')}
          </button>
        </div>
      </header>

      <ErrorBanner>{error}</ErrorBanner>

      <div className="card menu-actions">
        <Button variant="primary" block busy={busy === 'create'} disabled={busy !== null} onClick={handleCreate}>
          {t('menu.creerUnSalon')}
        </Button>
        <p className="menu-item-hint">{t('menu.creerUnSalonHint')}</p>
      </div>

      <form className="card menu-actions" onSubmit={handleJoin}>
        <TextField
          id="room-code"
          label={t('menu.codeDuSalon')}
          placeholder={t('menu.codeDuSalonPlaceholder')}
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
        <Button
          type="submit"
          variant="secondary"
          block
          busy={busy === 'join'}
          disabled={busy !== null || !code.trim()}
        >
          {t('menu.rejoindre')}
        </Button>
      </form>

      <div className="card menu-actions">
        <Button variant="ghost" block disabled>
          {t('menu.gererMesQuestions')}
        </Button>
        <p className="menu-item-hint">{t('menu.bientotDisponible')}</p>
      </div>
    </div>
  );
}

export default MenuScreen;
