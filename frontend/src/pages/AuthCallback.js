import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authAxios, useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';

export default function AuthCallback() {
  const navigate = useNavigate();
  const hasProcessed = useRef(false);
  const { setUser } = useAuth();
  const [error, setError] = useState(null);

  useEffect(() => {
    if (hasProcessed.current) return;
    hasProcessed.current = true;

    const hash = window.location.hash || '';
    const match = hash.match(/session_id=([^&]+)/);
    const sessionId = match?.[1];

    if (!sessionId) {
      navigate('/login', { replace: true });
      return;
    }

    (async () => {
      try {
        const { data } = await authAxios.post('/auth/session', { session_id: sessionId });
        setUser(data);
        // scrub the hash so a reload doesn't re-process it
        window.history.replaceState({}, '', window.location.pathname);
        navigate('/', { replace: true, state: { user: data } });
      } catch (err) {
        // Backend 403 returns { detail: { error, message } } when the email
        // isn't on the allow-list; fall back to a generic message for any
        // other failure. Hop to /login with the message in query so a hard
        // reload still shows the explanation.
        const d = err?.response?.data?.detail;
        const message = (typeof d === 'object' && d?.message)
          ? d.message
          : (typeof d === 'string' ? d : 'Authentication failed');
        // Scrub the session_id hash so it isn't reused on retry.
        window.history.replaceState({}, '', window.location.pathname);
        navigate(`/login?err=${encodeURIComponent(message)}`, { replace: true });
        setError(message);
      }
    })();
  }, [navigate, setUser]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      {error ? (
        <div className="text-center space-y-2">
          <p className="text-sm text-destructive">{error}</p>
          <button
            onClick={() => navigate('/login', { replace: true })}
            className="text-xs underline text-muted-foreground hover:text-foreground"
          >
            Back to sign in
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          Finishing sign-in…
        </div>
      )}
    </div>
  );
}
