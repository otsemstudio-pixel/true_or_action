import { useState } from 'react';
import { useAuth } from '../hooks/useAuth.jsx';
import { useRoom } from '../hooks/useRoom.jsx';
import Button from '../components/Button.jsx';
import TextField from '../components/TextField.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';

function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  return Promise.reject(new Error('Presse-papiers indisponible'));
}

function SalonAttenteScreen() {
  const { user } = useAuth();
  const { room, leaveRoom, updateRoomSettings, startGame } = useRoom();
  const isHost = String(user.id) === room.hostId;

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

  const canStart = room.players.length >= 3;

  const applySettings = async (nextMode, value) => {
    setError(null);
    try {
      if (nextMode === 'turns') {
        await updateRoomSettings({ maxTurns: value, targetScore: null });
      } else {
        await updateRoomSettings({ maxTurns: null, targetScore: value });
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleModeSwitch = (nextMode) => {
    setMode(nextMode);
    applySettings(nextMode, nextMode === 'turns' ? maxTurns : targetScore);
  };

  const handleCopy = async () => {
    try {
      await copyToClipboard(room.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Impossible de copier automatiquement, notez le code manuellement.");
    }
  };

  const handleStart = async () => {
    setError(null);
    setBusy(true);
    try {
      await startGame();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen">
      <div className="room-code">
        <span className="room-code-value">{room.code}</span>
        <Button variant="ghost" onClick={handleCopy}>
          {copied ? 'Copié !' : 'Copier'}
        </Button>
      </div>

      <ErrorBanner>{error}</ErrorBanner>

      <div className="card">
        <h2>Joueurs ({room.players.length}/8)</h2>
        <ul className="player-list">
          {room.players.map((p) => (
            <li key={p.id} className="player-row">
              <span className="player-name">
                <span className={`status-dot${p.status !== 'active' ? ' status-dot--disconnected' : ''}`} />
                {p.pseudo}
              </span>
              {p.id === room.hostId && <span className="player-badge-host">Hôte</span>}
            </li>
          ))}
        </ul>
        {room.players.length < 3 && (
          <p className="menu-item-hint">Encore {3 - room.players.length} joueur(s) pour pouvoir lancer.</p>
        )}
      </div>

      <div className="card">
        <h2>Fin de partie</h2>
        {isHost ? (
          <>
            <div className="settings-mode">
              <button
                type="button"
                className={`btn btn-ghost${mode === 'turns' ? ' btn-mode-active' : ''}`}
                onClick={() => handleModeSwitch('turns')}
              >
                Tours
              </button>
              <button
                type="button"
                className={`btn btn-ghost${mode === 'score' ? ' btn-mode-active' : ''}`}
                onClick={() => handleModeSwitch('score')}
              >
                Score
              </button>
            </div>
            {mode === 'turns' ? (
              <TextField
                id="max-turns"
                label="Nombre de tours"
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
                label="Score cible"
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
              ? `Score cible : ${room.settings.targetScore} points`
              : `${room.settings?.maxTurns ?? '—'} tours`}
          </p>
        )}
      </div>

      {isHost ? (
        <Button block busy={busy} disabled={!canStart} onClick={handleStart}>
          Lancer la partie
        </Button>
      ) : (
        <p className="menu-item-hint">En attente que l'hôte lance la partie…</p>
      )}

      <Button variant="danger-ghost" onClick={leaveRoom}>
        Quitter le salon
      </Button>
    </div>
  );
}

export default SalonAttenteScreen;
