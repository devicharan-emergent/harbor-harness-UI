import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { setCreatedBy } from '@/services/apiHelpers';

const AuthContext = createContext(null);

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
// Shared axios instance so withCredentials is always true
export const authAxios = axios.create({ baseURL: API, withCredentials: true });

export function AuthProvider({ children }) {
  const [user, setUserState] = useState(null);
  // null = checking, true/false = resolved
  const [loading, setLoading] = useState(true);

  // Wrap setUser so every state change mirrors into the ownership helper.
  const setUser = useCallback((next) => {
    setUserState(next);
    setCreatedBy(next?.user_id || null);
  }, []);

  const checkAuth = useCallback(async () => {
    try {
      const { data } = await authAxios.get('/auth/me');
      setUser(data);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [setUser]);

  useEffect(() => {
    // Emergent OAuth returns to `${origin}/` with `#session_id=<token>` in
    // the URL hash. We must exchange it BEFORE any gated route decides to
    // redirect to /login, otherwise the hash is lost.
    const hashMatch = (window.location.hash || '').match(/session_id=([^&]+)/);
    if (hashMatch) {
      const sid = hashMatch[1];
      (async () => {
        try {
          const { data } = await authAxios.post('/auth/session', { session_id: sid });
          setUser(data);
        } catch {
          setUser(null);
        } finally {
          // Scrub hash so a reload doesn't re-process it.
          window.history.replaceState({}, '', window.location.pathname + window.location.search);
          setLoading(false);
        }
      })();
      return;
    }
    checkAuth();
  }, [checkAuth, setUser]);

  const logout = useCallback(async () => {
    try { await authAxios.post('/auth/logout'); } catch { /* ignore */ }
    setUser(null);
    window.location.href = '/login';
  }, [setUser]);

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

// Convenience: stable UUID threaded through all harness CRUD as created_by.
// We use the internal user_id (UUID) — never email, which can change.
export function useCreatedBy() {
  const { user } = useAuth();
  return user?.user_id || null;
}
