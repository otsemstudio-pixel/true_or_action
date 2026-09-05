import { useSocketStatus } from '../hooks/useSocketStatus.js';

const LABELS = {
  connected: 'Connecté',
  reconnecting: 'Reconnexion…',
  offline: 'Hors ligne',
};

function ConnectionBadge() {
  const status = useSocketStatus();
  const dotClass = status === 'connected' ? 'connection-dot' : `connection-dot connection-dot--${status}`;

  return (
    <div className="connection-badge" role="status">
      <span className={dotClass} />
      {LABELS[status]}
    </div>
  );
}

export default ConnectionBadge;
