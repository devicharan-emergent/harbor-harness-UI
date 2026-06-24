import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ExternalLink, RefreshCw, Loader2 } from 'lucide-react';

// External tool hosted by the agent-definitions service. It already runs
// behind the same Emergent SSO so an iframe load works without additional
// auth handshakes — we just embed it as-is.
const IFRAME_SRC = 'https://source-view-4.internal.emergent.host/agent-definitions';

export default function AgentPromptManagementPage() {
  const [iframeKey, setIframeKey] = useState(0);
  const [loading, setLoading] = useState(true);

  const reload = () => {
    setLoading(true);
    setIframeKey((k) => k + 1);
  };

  return (
    <div className="space-y-4" data-testid="agent-prompt-management-page">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold leading-tight">Agent & Prompt Management</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Embedded view of the agent-definitions service.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={reload}
            data-testid="agent-prompt-mgmt-reload-btn"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            Reload
          </Button>
          <Button
            variant="outline"
            size="sm"
            asChild
            data-testid="agent-prompt-mgmt-open-new-tab-btn"
          >
            <a href={IFRAME_SRC} target="_blank" rel="noreferrer">
              <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
              Open in new tab
            </a>
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden relative" data-testid="agent-prompt-mgmt-card">
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
          src={IFRAME_SRC}
          title="Agent & Prompt Management"
          className="w-full block border-0"
          style={{ height: 'calc(100vh - 180px)', minHeight: '600px' }}
          onLoad={() => setLoading(false)}
          // sandbox kept permissive — same-origin to *.internal.emergent.host
          // (read: behind our SSO) so we don't strip storage/cookies.
          allow="clipboard-read; clipboard-write"
          data-testid="agent-prompt-mgmt-iframe"
        />
      </Card>
    </div>
  );
}
