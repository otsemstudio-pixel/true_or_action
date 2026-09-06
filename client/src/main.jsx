import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { AuthProvider } from './hooks/useAuth.jsx';
import { RoomProvider } from './hooks/useRoom.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import './index.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <RoomProvider>
          <App />
        </RoomProvider>
      </AuthProvider>
    </ErrorBoundary>
  </StrictMode>
);
