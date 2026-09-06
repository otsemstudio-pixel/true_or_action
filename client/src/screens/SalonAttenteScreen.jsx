import { useState } from 'react';
import { useAuth } from '../hooks/useAuth.jsx';
import { useRoom } from '../hooks/useRoom.jsx';
import { useI18n } from '../hooks/useI18n.jsx';
import { translateError, SUPPORTED_LANGUES, LANGUE_NATIVE_NAMES } from '../i18n/index.js';
import Button from '../components/Button.jsx';
import TextField from '../components/TextField.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import Tutoriel from '../components/Tutoriel.jsx';
import ReglesActives, { REGLE_KEYS } from '../components/ReglesActives.jsx';
import { NIVEAUX } from '../lib/niveau.js';
import { markTutorielSeen } from '../lib/tutoriel.js';

const MIN_PLAYERS = 2;

function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  return Promise.reject(new Error('Presse-papiers indisponible'));
}

function SalonAttenteScreen() {
  const { user } = useAuth();
  const {
    room,
    leaveRoom,
    updateRoomSettings,
    updateNiveauMax,
    updateMaxPlayers,
    updateRoomLangue,
    updateRoomRegles,
    startGame,
  } = useRoom();
  const { t } = useI18n();
  const isHost = String(user.id) === room.hostId;
  const [niveauBusy, setNiveauBusy] = useState(false);
  const [langueBusy, setLangueBusy] = useState(false);
  const [reglesBusy, setReglesBusy] = useState(false);
  const [maxPlayersBusy, setMaxPlayersBusy] = useState(false);

  // Champs d'édition locaux à l'hôte : initialisés une fois depuis les réglages du
  // salon, puis pilotés uniquement par la saisie locale. Les réglages de room ne
  // peuvent changer que par nos propres appels ci-dessous (seul l'hôte édite ici) :
  // les resynchroniser en réaction à l'écho serveur créerait une course avec la frappe.
  const [mode, setMode] = useState(room.settings?.targetScore != null ? 'score' : 'turns');
  const [maxTurns, setMaxTurns] = useState(room.settings?.maxTurns ?? 10);
  const [targetScore, setTargetScore] = useState(room.settings?.targetScore ?? 20);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [tutorielOpen, setTutorielOpen] = useState(false);

  const canStart = room.players.length >= MIN_PLAYERS;

  const applySettings = async (nextMode, value) => {
    setError(null);
    try {
      if (nextMode === 'turns') {
        await updateRoomSettings({ maxTurns: value, targetScore: null });
      } else {
        await updateRoomSettings({ maxTurns: null, targetScore: value });
      }
    } catch (err) {
      setError(translateError(t, err));
    }
  };

  const handleModeSwitch = (nextMode) => {
    setMode(nextMode);
    applySettings(nextMode, nextMode === 'turns' ? maxTurns : targetScore);
  };

  const handleNiveauChange = async (niveau) => {
    if (niveau === room.niveauMax) return;
    setError(null);
    setNiveauBusy(true);
    try {
      await updateNiveauMax(niveau);
    } catch (err) {
      setError(translateError(t, err));
    } finally {
      setNiveauBusy(false);
    }
  };

  const handleMaxPlayersChange = async (value) => {
    if (value === room.maxPlayers) return;
    setError(null);
    setMaxPlayersBusy(true);
    try {
      await updateMaxPlayers(value);
    } catch (err) {
      setError(translateError(t, err));
    } finally {
      setMaxPlayersBusy(false);
    }
  };

  const handleLangueChange = async (langue) => {
    if (langue === room.langue) return;
    setError(null);
    setLangueBusy(true);
    try {
      await updateRoomLangue(langue);
    } catch (err) {
      setError(translateError(t, err));
    } finally {
      setLangueBusy(false);
    }
  };

  const handleToggleRegle = async (key) => {
    setError(null);
    setReglesBusy(true);
    try {
      await updateRoomRegles({ [key]: !room.regles[key] });
    } catch (err) {
      setError(translateError(t, err));
    } finally {
      setReglesBusy(false);
    }
  };

  const handleCopy = async () => {
    try {
      await copyToClipboard(room.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(t('salon.copieImpossible'));
    }
  };

  const handleStart = async () => {
    setError(null);
    setBusy(true);
    try {
      await startGame();
    } catch (err) {
      setError(translateError(t, err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen">
      <div className="room-code">
        <span className="room-code-label">{t('salon.codeLabel')}</span>
        <span className="room-code-value">{room.code}</span>
        <Button variant="ghost" onClick={handleCopy}>
          {copied ? t('commun.copie') : t('commun.copier')}
        </Button>
      </div>

      <Button variant="ghost" onClick={() => setTutorielOpen(true)}>
        {t('salon.commentJouer')}
      </Button>

      <ErrorBanner>{error}</ErrorBanner>

      <div className="card">
        <h2>{t('salon.joueurs', { count: room.players.length, max: room.maxPlayers })}</h2>
        {isHost && (
          <div className="field">
            <label htmlFor="max-players">{t('salon.nombreMaxJoueurs')}</label>
            <select
              id="max-players"
              value={room.maxPlayers}
              disabled={maxPlayersBusy}
              onChange={(e) => handleMaxPlayersChange(Number(e.target.value))}
            >
              {Array.from(
                { length: 20 - Math.max(MIN_PLAYERS, room.players.length) + 1 },
                (_, i) => Math.max(MIN_PLAYERS, room.players.length) + i
              ).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        )}
        <ul className="player-list player-list--scrollable">
          {room.players.map((p) => (
            <li key={p.id} className="player-row">
              <span className="player-name">
                <span className="player-avatar" aria-hidden="true">
                  {p.pseudo.charAt(0).toUpperCase()}
                </span>
                <span className={`status-dot${p.status !== 'active' ? ' status-dot--disconnected' : ''}`} />
                {p.pseudo}
              </span>
              {p.id === room.hostId && <span className="player-badge-host">{t('commun.hote')}</span>}
            </li>
          ))}
        </ul>
        {room.players.length < MIN_PLAYERS && (
          <p className="menu-item-hint">
            {t('salon.encoreJoueurs', { count: MIN_PLAYERS - room.players.length })}
          </p>
        )}
      </div>

      <div className="card">
        <h2>{t('salon.finDePartie')}</h2>
        {isHost ? (
          <>
            <div className="settings-mode">
              <button
                type="button"
                className={`btn btn-ghost${mode === 'turns' ? ' btn-mode-active' : ''}`}
                onClick={() => handleModeSwitch('turns')}
              >
                {t('salon.tours')}
              </button>
              <button
                type="button"
                className={`btn btn-ghost${mode === 'score' ? ' btn-mode-active' : ''}`}
                onClick={() => handleModeSwitch('score')}
              >
                {t('salon.score')}
              </button>
            </div>
            {mode === 'turns' ? (
              <TextField
                id="max-turns"
                label={t('salon.nombreDeTours')}
                type="number"
                min={1}
                max={50}
                value={maxTurns}
                onChange={(e) => setMaxTurns(Number(e.target.value))}
                onBlur={(e) => applySettings('turns', Math.max(1, Number(e.target.value) || 1))}
              />
            ) : (
              <TextField
                id="target-score"
                label={t('salon.scoreCible')}
                type="number"
                min={1}
                max={200}
                value={targetScore}
                onChange={(e) => setTargetScore(Number(e.target.value))}
                onBlur={(e) => applySettings('score', Math.max(1, Number(e.target.value) || 1))}
              />
            )}
          </>
        ) : (
          <p>
            {room.settings?.targetScore != null
              ? t('salon.scoreCibleAffiche', { score: room.settings.targetScore })
              : t('salon.toursAffiche', { count: room.settings?.maxTurns ?? 0 })}
          </p>
        )}
      </div>

      <div className="card">
        <h2>{t('salon.niveauDesQuestions')}</h2>
        {isHost ? (
          <>
            <div className="settings-mode settings-mode--niveau">
              {NIVEAUX.map((niveau) => (
                <button
                  key={niveau}
                  type="button"
                  className={`btn btn-ghost${room.niveauMax === niveau ? ' btn-mode-active' : ''}`}
                  disabled={niveauBusy}
                  onClick={() => handleNiveauChange(niveau)}
                >
                  {t(`niveau.label.${niveau}`)}
                </button>
              ))}
            </div>
            <p className="menu-item-hint">{t(`niveau.description.${room.niveauMax}`)}</p>
          </>
        ) : (
          <>
            <p>{t(`niveau.label.${room.niveauMax}`)}</p>
            <p className="menu-item-hint">{t(`niveau.description.${room.niveauMax}`)}</p>
          </>
        )}

        <h2>{t('salon.langueDesQuestions')}</h2>
        {isHost ? (
          <div className="settings-mode settings-mode--langue">
            {SUPPORTED_LANGUES.map((code) => (
              <button
                key={code}
                type="button"
                className={`btn btn-ghost${room.langue === code ? ' btn-mode-active' : ''}`}
                disabled={langueBusy}
                onClick={() => handleLangueChange(code)}
              >
                {LANGUE_NATIVE_NAMES[code]}
              </button>
            ))}
          </div>
        ) : (
          <p>{LANGUE_NATIVE_NAMES[room.langue]}</p>
        )}
      </div>

      <div className="card">
        <h2>{t('salon.reglesDuJeu')}</h2>
        {isHost ? (
          <div className="regle-list">
            {REGLE_KEYS.filter((key) => key !== 'pariMutuel' || room.players.length === 2).map((key) => (
              <div key={key} className="regle-row">
                <div className="regle-info">
                  <span className="regle-nom">{t(`regles.${key}.nom`)}</span>
                  <span className="regle-description">{t(`regles.${key}.description`)}</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={room.regles[key]}
                  aria-label={t(`regles.${key}.nom`)}
                  disabled={reglesBusy}
                  className={`regle-switch${room.regles[key] ? ' regle-switch--active' : ''}`}
                  onClick={() => handleToggleRegle(key)}
                >
                  <span className="regle-switch-knob" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <ReglesActives regles={room.regles} />
        )}
      </div>

      {isHost ? (
        <Button variant="dark" block arrow busy={busy} disabled={!canStart} onClick={handleStart}>
          {t('salon.lancerLaPartie')}
        </Button>
      ) : (
        <p className="menu-item-hint">{t('salon.enAttenteHoteLance')}</p>
      )}

      <Button variant="danger-ghost" onClick={leaveRoom}>
        {t('salon.quitterLeSalon')}
      </Button>

      <Tutoriel
        open={tutorielOpen}
        regles={room.regles}
        onClose={() => {
          markTutorielSeen();
          setTutorielOpen(false);
        }}
      />
    </div>
  );
}

export default SalonAttenteScreen;
