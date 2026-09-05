import { useState } from 'react';
import { useAuth } from '../hooks/useAuth.jsx';
import { useRoom } from '../hooks/useRoom.jsx';
import Button from '../components/Button.jsx';
import TextField from '../components/TextField.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';

const DEFAULT_MAX_TURNS = 10;

function MenuScreen() {
  const { user, logout } = useAuth();
  const { createRoom, joinRoom } = useRoom();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(null); // 'create' | 'join' | null
  const [error, setError] = useState(null);

  const handleCreate = async () => {
    setError(null);
    setBusy('create');
    try {
      await createRoom({ maxTurns: DEFAULT_MAX_TURNS });
    } catch (err) {
      setError(err.message);
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
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="screen">
      <header>
        <p className="tagline">Salut {user.pseudo} !</p>
        <button type="button" className="link-btn" onClick={logout}>
          Se déconnecter
        </button>
      </header>

      <ErrorBanner>{error}</ErrorBanner>

      <div className="card menu-actions">
        <Button variant="primary" block busy={busy === 'create'} disabled={busy !== null} onClick={handleCreate}>
          Créer un salon
        </Button>
        <p className="menu-item-hint">Vous devenez l'hôte et choisissez les réglages ensuite.</p>
      </div>

      <form className="card menu-actions" onSubmit={handleJoin}>
        <TextField
          id="room-code"
          label="Code du salon"
          placeholder="ABCDEF"
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
          Rejoindre
        </Button>
      </form>

      <div className="card menu-actions">
        <Button variant="ghost" block disabled>
          Gérer mes questions
        </Button>
        <p className="menu-item-hint">Bientôt disponible.</p>
      </div>
    </div>
  );
}

export default MenuScreen;
