import { useAuth } from './hooks/useAuth.jsx';
import { useRoom } from './hooks/useRoom.jsx';
import { useI18n } from './hooks/useI18n.jsx';
import ConnectionBadge from './components/ConnectionBadge.jsx';
import Spinner from './components/Spinner.jsx';
import AccueilScreen from './screens/AccueilScreen.jsx';
import MenuScreen from './screens/MenuScreen.jsx';
import SalonAttenteScreen from './screens/SalonAttenteScreen.jsx';
import PartieScreen from './screens/PartieScreen.jsx';
import FinScreen from './screens/FinScreen.jsx';

function App() {
  const { status } = useAuth();
  const { room } = useRoom();
  const { t } = useI18n();

  if (status === 'loading') {
    return (
      <div className="loading-screen">
        <Spinner />
        <span>{t('commun.chargement')}</span>
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
      {room.status === 'finished' && <FinScreen />}
      {!['idle', 'waiting', 'playing', 'finished'].includes(room.status) && (
        <div className="screen screen--centered">
          <p>{t('app.etatSalonInconnu')}</p>
        </div>
      )}
    </div>
  );
}

export default App;
