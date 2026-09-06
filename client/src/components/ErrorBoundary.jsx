import { Component } from 'react';
import { useI18n } from '../hooks/useI18n.jsx';

class ErrorBoundary extends Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error('Erreur applicative interceptée:', error.message);
  }

  render() {
    if (this.state.hasError) {
      const { t } = this.props;
      return (
        <div className="screen screen--centered">
          <div className="card">
            <h2>{t('erreurLimite.titre')}</h2>
            <p className="menu-item-hint">{t('erreurLimite.description')}</p>
            <button type="button" className="btn btn-primary btn-block" onClick={() => window.location.reload()}>
              {t('erreurLimite.recharger')}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// L'ErrorBoundary de classe ne peut pas appeler useI18n() directement (pas de
// hooks dans les composants classe) : ce petit wrapper fonctionnel lui fournit
// `t` via une prop.
function ErrorBoundaryWithI18n({ children }) {
  const { t } = useI18n();
  return <ErrorBoundary t={t}>{children}</ErrorBoundary>;
}

export default ErrorBoundaryWithI18n;
