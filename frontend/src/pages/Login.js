import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LogIn, Sparkles } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Navigate } from 'react-router-dom';

export default function Login() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
        Checking session…
      </div>
    );
  }
  if (user) return <Navigate to="/" replace />;

  const signIn = () => {
    // REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
    const redirectUrl = window.location.origin + '/';
    window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-accent/5 p-6">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="space-y-2 text-center pb-2">
          <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-2">
            <Sparkles className="w-5 h-5 text-primary" />
          </div>
          <CardTitle className="text-2xl">Agent Config Manager</CardTitle>
          <p className="text-sm text-muted-foreground">
            Sign in to manage agents, datasets, and evaluations.
          </p>
        </CardHeader>
        <CardContent className="pt-4 space-y-3">
          <Button
            onClick={signIn}
            className="w-full h-11 text-sm"
            data-testid="login-google-btn"
          >
            <LogIn className="w-4 h-4 mr-2" />
            Sign in with Google
          </Button>
          <p className="text-[11px] text-center text-muted-foreground">
            You'll be redirected to Emergent&apos;s secure sign-in.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
