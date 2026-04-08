import { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued';
import yaml from 'js-yaml';
import agentApi from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/agents/EmptyState';
import { ArrowLeft, GitCompare, Loader2 } from 'lucide-react';

export default function CompareView() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [agentA, setAgentA] = useState(searchParams.get('a') || '');
  const [agentB, setAgentB] = useState(searchParams.get('b') || '');
  const [configA, setConfigA] = useState(null);
  const [configB, setConfigB] = useState(null);
  const [diffOnly, setDiffOnly] = useState(false);

  useEffect(() => {
    agentApi.list().then(data => {
      setAgents(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (agentA) {
      agentApi.get(agentA).then(setConfigA).catch(() => setConfigA(null));
    } else {
      setConfigA(null);
    }
  }, [agentA]);

  useEffect(() => {
    if (agentB) {
      agentApi.get(agentB).then(setConfigB).catch(() => setConfigB(null));
    } else {
      setConfigB(null);
    }
  }, [agentB]);

  const yamlA = useMemo(() => {
    if (!configA) return '';
    const { last_modified, created_at, ...data } = configA;
    return yaml.dump(data, { lineWidth: 120, noRefs: true });
  }, [configA]);

  const yamlB = useMemo(() => {
    if (!configB) return '';
    const { last_modified, created_at, ...data } = configB;
    return yaml.dump(data, { lineWidth: 120, noRefs: true });
  }, [configB]);

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
        <Button variant="ghost" size="icon" onClick={() => navigate('/')} className="h-8 w-8">
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Compare Agents</h1>
          <p className="text-sm text-muted-foreground mt-1">Side-by-side configuration comparison</p>
        </div>
      </div>

      {/* Agent selectors */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">Agent A</Label>
          <Select value={agentA} onValueChange={setAgentA}>
            <SelectTrigger data-testid="compare-agent-a-select">
              <SelectValue placeholder="Select first agent..." />
            </SelectTrigger>
            <SelectContent>
              {agents.map(a => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name} (v{a.version})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">Agent B</Label>
          <Select value={agentB} onValueChange={setAgentB}>
            <SelectTrigger data-testid="compare-agent-b-select">
              <SelectValue placeholder="Select second agent..." />
            </SelectTrigger>
            <SelectContent>
              {agents.map(a => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name} (v{a.version})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Controls */}
      {configA && configB && (
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch
              checked={diffOnly}
              onCheckedChange={setDiffOnly}
              data-testid="diff-show-differences-toggle"
            />
            <Label className="text-sm">Show differences only</Label>
          </div>
        </div>
      )}

      {/* Diff viewer */}
      {configA && configB ? (
        <Card>
          <CardContent className="p-0 overflow-auto">
            <div className="diff-viewer-wrapper">
              <ReactDiffViewer
                oldValue={yamlA}
                newValue={yamlB}
                splitView={true}
                showDiffOnly={diffOnly}
                extraLinesSurroundingDiff={3}
                compareMethod={DiffMethod.LINES}
                leftTitle={configA?.name || 'Agent A'}
                rightTitle={configB?.name || 'Agent B'}
                styles={{
                  variables: {
                    light: {
                      diffViewerBackground: '#f8fafc',
                      addedBackground: '#ecfdf5',
                      removedBackground: '#fef2f2',
                      wordAddedBackground: '#d1fae5',
                      wordRemovedBackground: '#fecaca',
                      addedGutterBackground: '#d1fae5',
                      removedGutterBackground: '#fecaca',
                      gutterBackground: '#f1f5f9',
                      gutterBackgroundDark: '#e2e8f0',
                      codeFoldGutterBackground: '#f1f5f9',
                      codeFoldBackground: '#f8fafc',
                    },
                  },
                  contentText: {
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: '12px',
                  },
                  line: {
                    padding: '2px 8px',
                  },
                }}
              />
            </div>
          </CardContent>
        </Card>
      ) : (
        !agentA && !agentB && (
          <EmptyState
            icon={GitCompare}
            title="Select two agents to compare"
            body="Choose agents from the dropdowns above to see a side-by-side YAML diff."
          />
        )
      )}
    </div>
  );
}
