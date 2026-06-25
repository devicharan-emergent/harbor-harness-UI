import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ExternalLink, RefreshCw, Loader2, Sun, Moon } from 'lucide-react';

// External tool hosted by the agent-definitions service. It already runs
// behind the same Emergent SSO so an iframe load works without additional
// auth handshakes — we just embed it as-is.
const IFRAME_BASE = 'https://source-view-4.internal.emergent.host/agent-definitions';
const STORAGE_KEY = 'acm_agent_prompt_iframe_theme';

export default function AgentPromptManagementPage() {
  const [iframeKey, setIframeKey] = useState(0);
  const [loading, setLoading] = useState(true);
  // Default iframe theme = light: the embedded Cortex Admin reads cleaner
  // on a light surface inside our dark shell. Persist user override.
  const [iframeTheme, setIframeTheme] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || 'light';
    } catch {
      return 'light';
    }
  });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, iframeTheme); } catch { /* ignore */ }
  }, [iframeTheme]);

  // Build src with a ?theme= hint — best-effort: if the embedded app reads
  // it, great; if not, the `color-scheme` CSS prop below still nudges its
  // form controls + scrollbar palette to match.
  const iframeSrc = `${IFRAME_BASE}?theme=${iframeTheme}`;
  const surfaceBg = iframeTheme === 'dark' ? '#0b0f17' : '#ffffff';

  const reload = () => {
    setLoading(true);
    setIframeKey((k) => k + 1);
  };

  const toggleTheme = () => {
    setIframeTheme((t) => (t === 'light' ? 'dark' : 'light'));
    setLoading(true);
    setIframeKey((k) => k + 1); // remount so the ?theme= hint takes effect
  };

  return (
    <div className="space-y-4" data-testid="agent-prompt-management-page">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold">Agent &amp; Prompt Management</h1>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={toggleTheme}
            data-testid="agent-prompt-mgmt-theme-toggle-btn"
            title={`Switch embedded view to ${iframeTheme === 'light' ? 'dark' : 'light'} theme`}
          >
            {iframeTheme === 'light' ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={reload}
            data-testid="agent-prompt-mgmt-reload-btn"
            title="Reload embedded view"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            asChild
            data-testid="agent-prompt-mgmt-open-new-tab-btn"
          >
            <a href={iframeSrc} target="_blank" rel="noreferrer" title="Open in new tab">
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </Button>
        </div>
      </div>

      <Card
        className="overflow-hidden relative border-border/60"
        style={{ background: surfaceBg }}
        data-testid="agent-prompt-mgmt-card"
      >
        {loading && (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 backdrop-blur-sm pointer-events-none"
            data-testid="agent-prompt-mgmt-loading"
          >
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        )}
        <iframe
          key={iframeKey}
          src={iframeSrc}
          title="Agent & Prompt Management"
          className="w-full block border-0"
          // `color-scheme` is a CSS hint that nudges form controls, scrollbars
          // and `prefers-color-scheme` inside the iframe so the embedded
          // page stops fighting our wrapper's contrast.
          style={{
            height: 'calc(100vh - 120px)',
            minHeight: '600px',
            colorScheme: iframeTheme,
            background: surfaceBg,
          }}
          onLoad={() => setLoading(false)}
          allow="clipboard-read; clipboard-write"
          data-testid="agent-prompt-mgmt-iframe"
        />
      </Card>
    </div>
  );
}
