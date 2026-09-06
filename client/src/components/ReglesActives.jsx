import { useI18n } from '../hooks/useI18n.jsx';

export const REGLE_KEYS = ['refusCouteux', 'doubleOuRien', 'questionRetournee', 'tourSurprise', 'pariMutuel'];

// Résumé compact des règles actives — visible par tous les joueurs, dans le
// salon d'attente comme pendant la partie.
function ReglesActives({ regles }) {
  const { t } = useI18n();
  const active = REGLE_KEYS.filter((key) => regles?.[key]);

  if (active.length === 0) {
    return <p className="menu-item-hint">{t('salon.aucuneRegleActive')}</p>;
  }

  return (
    <div className="regles-actives">
      {active.map((key) => (
        <span key={key} className="regle-badge">
          {t(`regles.${key}.nom`)}
        </span>
      ))}
    </div>
  );
}

export default ReglesActives;
