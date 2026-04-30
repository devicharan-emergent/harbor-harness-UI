import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import axios from 'axios';

const AuthContext = createContext(null);

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
// Shared axios instance so withCredentials is always true
export const authAxios = axios.create({ baseURL: API, withCredentials: true });

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  // null = checking, true/false = resolved
  const [loading, setLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    try {
      const { data } = await authAxios.get('/auth/me');
      setUser(data);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // CRITICAL: If returning from OAuth callback, skip the /me check —
    // AuthCallback will exchange the session_id and establish the cookie first.
    if (window.location.hash?.includes('session_id=')) {
      setLoading(false);
      return;
    }
    checkAuth();
  }, [checkAuth]);

  const logout = useCallback(async () => {
    try { await authAxios.post('/auth/logout'); } catch { /* ignore */ }
    setUser(null);
    window.location.href = '/login';
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, logout, refresh: checkAuth, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

// Convenience: stable string threaded through all harness CRUD as created_by.
// We use the user's email (TEXT column accepts it, human-readable in DB).
export function useCreatedBy() {
  const { user } = useAuth();
  return user?.email || null;
}
