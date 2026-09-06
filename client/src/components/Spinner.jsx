import { useI18n } from '../hooks/useI18n.jsx';

function Spinner({ label }) {
  const { t } = useI18n();
  return <span className="spinner" role="status" aria-label={label ?? t('commun.chargement')} />;
}

export default Spinner;
