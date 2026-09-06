import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { I18nProvider } from './hooks/useI18n.jsx';
import { AuthProvider } from './hooks/useAuth.jsx';
import { RoomProvider } from './hooks/useRoom.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import './index.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <I18nProvider>
      <ErrorBoundary>
        <AuthProvider>
          <RoomProvider>
            <App />
          </RoomProvider>
        </AuthProvider>
      </ErrorBoundary>
    </I18nProvider>
  </StrictMode>
);
