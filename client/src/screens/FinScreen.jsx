import { useState } from 'react';
import { useAuth } from '../hooks/useAuth.jsx';
import { useRoom } from '../hooks/useRoom.jsx';
import Button from '../components/Button.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';

const MEDALS = ['🥇', '🥈', '🥉'];

function FinScreen() {
  const { user } = useAuth();
  const { room, restartGame, leaveRoom } = useRoom();
  const myId = String(user.id);
  const isHost = room.hostId === myId;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const ranking = room.ranking ?? [];

  const handleRestart = async () => {
    setError(null);
    setBusy(true);
    try {
      await restartGame();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen">
      <header>
        <h1 className="fin-title">Partie terminée</h1>
      </header>

      <ErrorBanner>{error}</ErrorBanner>

      <ol className="ranking-list">
        {ranking.map((r, index) => {
          const player = room.players.find((p) => p.id === r.playerId);
          return (
            <li
              key={r.playerId}
              className={`ranking-row${index === 0 ? ' ranking-row--winner' : ''}`}
            >
              <span className="ranking-position">{MEDALS[index] ?? index + 1}</span>
              <span className="ranking-name">{player?.pseudo ?? '—'}</span>
              <span className="ranking-score">{r.score}</span>
            </li>
          );
        })}
        {ranking.length === 0 && <p className="menu-item-hint">Classement indisponible.</p>}
      </ol>

      {isHost ? (
        <Button block busy={busy} onClick={handleRestart}>
          Rejouer
        </Button>
      ) : (
        <p className="menu-item-hint">En attente que l'hôte relance une partie…</p>
      )}

      <Button variant="danger-ghost" onClick={leaveRoom}>
        Quitter
      </Button>
    </div>
  );
}

export default FinScreen;
