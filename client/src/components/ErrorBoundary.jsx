import { Component } from 'react';

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
      return (
        <div className="screen screen--centered">
          <div className="card">
            <h2>Un problème est survenu</h2>
            <p className="menu-item-hint">
              Quelque chose s'est mal passé. Rechargez la page pour continuer — votre partie
              reprendra là où elle en était.
            </p>
            <button type="button" className="btn btn-primary btn-block" onClick={() => window.location.reload()}>
              Recharger
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
