import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { register as apiRegister, login as apiLogin, fetchMe } from '../lib/api.js';
import { connectSocket, disconnectSocket } from '../lib/socket.js';

const TOKEN_KEY = 'tord_token';
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | authenticated | anonymous

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setStatus('anonymous');
      return;
    }
    fetchMe(token)
      .then(({ user }) => {
        setUser(user);
        connectSocket(token);
        setStatus('authenticated');
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        setStatus('anonymous');
      });
  }, []);

  const applySession = useCallback(({ token, user }) => {
    localStorage.setItem(TOKEN_KEY, token);
    connectSocket(token);
    setUser(user);
    setStatus('authenticated');
  }, []);

  const register = useCallback(
    async (payload) => {
      const result = await apiRegister(payload);
      applySession(result);
      return result;
    },
    [applySession]
  );

  const login = useCallback(
    async (payload) => {
      const result = await apiLogin(payload);
      applySession(result);
      return result;
    },
    [applySession]
  );

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    disconnectSocket();
    setUser(null);
    setStatus('anonymous');
  }, []);

  return (
    <AuthContext.Provider value={{ user, status, register, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth doit être utilisé à l\'intérieur de AuthProvider');
  }
  return ctx;
}
