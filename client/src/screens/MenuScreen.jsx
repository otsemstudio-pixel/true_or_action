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
import ConvertirCompteModal from '../components/ConvertirCompteModal.jsx';
import MesQuestionsModal from '../components/MesQuestionsModal.jsx';
import AdminModerationModal from '../components/AdminModerationModal.jsx';
import JokersGalleryModal from '../components/JokersGalleryModal.jsx';
import { hasTutorielSeen, shouldShowNouveautes, markTutorielSeen } from '../lib/tutoriel.js';

const DEFAULT_MAX_TURNS = 10;

function MenuScreen() {
  const { user, logout } = useAuth();
  const { createRoom, joinRoom } = useRoom();
  const { t, langue } = useI18n();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(null); // 'create' | 'join' | null
  const [error, setError] = useState(null);
  const [tutorielOpen, setTutorielOpen] = useState(false);
  const [tutorielView, setTutorielView] = useState('full');
  const [convertOpen, setConvertOpen] = useState(false);
  const [mesQuestionsOpen, setMesQuestionsOpen] = useState(false);
  const [moderationOpen, setModerationOpen] = useState(false);
  const [jokersOpen, setJokersOpen] = useState(false);

  // Proposé automatiquement une seule fois avant la première partie (vue
  // complète), puis reproposé sous forme de "Nouveautés" si des sections ont
  // été ajoutées depuis la dernière visite — jamais le didacticiel complet
  // repris depuis le début pour quelqu'un qui l'a déjà vu.
  useEffect(() => {
    if (!hasTutorielSeen()) {
      setTutorielView('full');
      setTutorielOpen(true);
    } else if (shouldShowNouveautes()) {
      setTutorielView('nouveautes');
      setTutorielOpen(true);
    }
  }, []);

  const openFullTutoriel = () => {
    setTutorielView('full');
    setTutorielOpen(true);
  };

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
        <button type="button" className="link-btn" onClick={openFullTutoriel}>
          {t('menu.commentJouer')}
        </button>
        <button type="button" className="link-btn" onClick={logout}>
          {t('menu.seDeconnecter')}
        </button>
      </div>

      <h1 className="menu-greeting">
        {t('menu.salut', { pseudo: user.pseudo })}
        {user.isGuest && <span className="badge-invite">{t('invite.badge')}</span>}
      </h1>

      <ErrorBanner>{error}</ErrorBanner>

      {user.isGuest && (
        <div className="menu-block menu-block--muted">
          <p className="menu-block-hint">{t('invite.creerUnCompteHint')}</p>
          <Button variant="ghost" block onClick={() => setConvertOpen(true)}>
            {t('invite.creerUnCompte')}
          </Button>
        </div>
      )}

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
        <Button variant="ghost" block onClick={() => setMesQuestionsOpen(true)}>
          {t('menu.gererMesQuestions')}
        </Button>
      </div>

      {user.isAdmin && (
        <div className="menu-block menu-block--muted">
          <Button variant="ghost" block onClick={() => setModerationOpen(true)}>
            {t('moderation.titre')}
          </Button>
        </div>
      )}

      <div className="menu-block menu-block--muted">
        <Button variant="ghost" block onClick={() => setJokersOpen(true)}>
          {t('jokers.titre')}
        </Button>
      </div>

      <Tutoriel open={tutorielOpen} initialView={tutorielView} onClose={closeTutoriel} />
      <ConvertirCompteModal open={convertOpen} onClose={() => setConvertOpen(false)} />
      <MesQuestionsModal open={mesQuestionsOpen} onClose={() => setMesQuestionsOpen(false)} />
      {user.isAdmin && <AdminModerationModal open={moderationOpen} onClose={() => setModerationOpen(false)} />}
      <JokersGalleryModal open={jokersOpen} onClose={() => setJokersOpen(false)} />
    </div>
  );
}

export default MenuScreen;
