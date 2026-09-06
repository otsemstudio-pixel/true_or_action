import { useSocketStatus } from '../hooks/useSocketStatus.js';
import { useI18n } from '../hooks/useI18n.jsx';

const LABEL_KEYS = {
  connected: 'commun.connecte',
  reconnecting: 'commun.reconnexion',
  offline: 'commun.horsLigne',
};

function ConnectionBadge() {
  const status = useSocketStatus();
  const { t } = useI18n();
  const dotClass = status === 'connected' ? 'connection-dot' : `connection-dot connection-dot--${status}`;

  return (
    <div className="connection-badge" role="status">
      <span className={dotClass} />
      {t(LABEL_KEYS[status])}
    </div>
  );
}

export default ConnectionBadge;
