import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import yaml from 'js-yaml';
import agentApi from '@/lib/api';
import { useCapabilities } from '@/hooks/useCapabilities';
import { ReadOnlyBanner } from '@/components/agents/ReadOnlyBanner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { EmptyState } from '@/components/agents/EmptyState';
import { ArrowLeft, RotateCcw, Eye, Clock, Loader2, History } from 'lucide-react';

export default function VersionHistory() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [versions, setVersions] = useState([]);
  const [agentName, setAgentName] = useState('');
  const [loading, setLoading] = useState(true);
  const [viewVersion, setViewVersion] = useState(null);
  const [restoreVersion, setRestoreVersion] = useState(null);
  const [restoring, setRestoring] = useState(false);
  const { capabilities } = useCapabilities();
  const isReadOnly = capabilities?.read_only === true;

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [vers, agent] = await Promise.all([
          agentApi.listVersions(id),
          agentApi.get(id),
        ]);
        setVersions(vers);
        setAgentName(agent.name);
      } catch (err) {
        toast.error('Failed to load version history');
        navigate('/');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [id, navigate]);

  const handleRestore = async () => {
    if (!restoreVersion) return;
    setRestoring(true);
    try {
      const result = await agentApi.restoreVersion(id, restoreVersion.version);
      toast.success(`Restored to v${restoreVersion.version} (now v${result.version})`);
      setRestoreVersion(null);
      // Refresh
      const vers = await agentApi.listVersions(id);
      setVersions(vers);
    } catch (err) {
      toast.error('Failed to restore version');
    } finally {
      setRestoring(false);
    }
  };

  const formatTimestamp = (ts) => {
    if (!ts) return '';
    try {
      return new Date(ts).toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch {
      return ts;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(`/agents/${encodeURIComponent(id)}/edit`)} className="h-8 w-8">
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Version History</h1>
          <p className="text-sm text-muted-foreground mt-1">{agentName} — {versions.length} version{versions.length !== 1 ? 's' : ''}</p>
        </div>
      </div>

      {versions.length === 0 ? (
        <EmptyState
          icon={History}
          title="No versions yet"
          body="Save the agent to create the first version snapshot."
        />
      ) : (
        <div className="space-y-3">
          {versions.map((ver, idx) => (
            <Card key={ver.version}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge variant={idx === 0 ? 'default' : 'secondary'} className="text-xs font-mono">
                        v{ver.version}
                      </Badge>
                      {idx === 0 && (
                        <Badge variant="outline" className="text-xs text-emerald-700 border-emerald-200 bg-emerald-50">
                          Current
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm mt-2 text-foreground">{ver.change_summary}</p>
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <Clock className="w-3 h-3 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">{formatTimestamp(ver.timestamp)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setViewVersion(ver)}
                      data-testid="version-history-view-button"
                    >
                      <Eye className="w-3.5 h-3.5 mr-1" /> View
                    </Button>
                    {idx !== 0 && !isReadOnly && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setRestoreVersion(ver)}
                        data-testid="version-history-restore-button"
                      >
                        <RotateCcw className="w-3.5 h-3.5 mr-1" /> Restore
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* View Version Dialog */}
      <Dialog open={!!viewVersion} onOpenChange={() => setViewVersion(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Version {viewVersion?.version} Configuration</DialogTitle>
            <DialogDescription>
              {viewVersion?.change_summary} — {formatTimestamp(viewVersion?.timestamp)}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="h-[60vh]">
            <pre className="yaml-preview p-4 bg-secondary rounded-lg text-sm">
              {viewVersion?.config
                ? yaml.dump(viewVersion.config, { lineWidth: 120, noRefs: true })
                : ''}
            </pre>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Restore Confirm Dialog */}
      <Dialog open={!!restoreVersion} onOpenChange={() => setRestoreVersion(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore Version {restoreVersion?.version}?</DialogTitle>
            <DialogDescription>
              This will create a new version with the configuration from v{restoreVersion?.version}.
              The current version will be preserved in history.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestoreVersion(null)}>Cancel</Button>
            <Button onClick={handleRestore} disabled={restoring}>
              {restoring ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <RotateCcw className="w-4 h-4 mr-1" />}
              Restore
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
