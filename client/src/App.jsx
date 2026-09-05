import { useAuth } from './hooks/useAuth.jsx';
import { useRoom } from './hooks/useRoom.jsx';
import ConnectionBadge from './components/ConnectionBadge.jsx';
import Spinner from './components/Spinner.jsx';
import AccueilScreen from './screens/AccueilScreen.jsx';
import MenuScreen from './screens/MenuScreen.jsx';
import SalonAttenteScreen from './screens/SalonAttenteScreen.jsx';
import PartieScreen from './screens/PartieScreen.jsx';

function App() {
  const { status } = useAuth();
  const { room } = useRoom();

  if (status === 'loading') {
    return (
      <div className="loading-screen">
        <Spinner />
        <span>Chargement…</span>
      </div>
    );
  }

  if (status === 'anonymous') {
    return <AccueilScreen />;
  }

  return (
    <div className="app-shell">
      <ConnectionBadge />
      {room.status === 'idle' && <MenuScreen />}
      {room.status === 'waiting' && <SalonAttenteScreen />}
      {room.status === 'playing' && <PartieScreen />}
      {room.status === 'finished' && (
        <div className="screen screen--centered">
          <p>Partie terminée — écran de classement à venir.</p>
        </div>
      )}
    </div>
  );
}

export default App;
