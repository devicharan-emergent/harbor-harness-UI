import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import yaml from 'js-yaml';
import agentApi from '@/lib/api';
import { PROVIDERS } from '@/lib/constants';
import { useCapabilities } from '@/hooks/useCapabilities';
import { ReadOnlyBanner } from '@/components/agents/ReadOnlyBanner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/agents/EmptyState';
import { RunEvalModal } from '@/components/evals/RunEvalModal';
import { Search, Plus, MoreHorizontal, Pencil, Copy, GitCompare, Download, Bot, Loader2, X, Rocket, Cloud, Lock, HardDrive, Trash2 } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { parseApiError } from '@/lib/errorUtils';

export default function AgentList() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [providerFilter, setProviderFilter] = useState('all');
  const [selectedIds, setSelectedIds] = useState([]);
  const [evalModalOpen, setEvalModalOpen] = useState(false);
  const [evalAgentId, setEvalAgentId] = useState(null);
  const [evalAgentName, setEvalAgentName] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const { capabilities } = useCapabilities();
  const isReadOnly = capabilities?.read_only === true;
  const isBuilderMode = capabilities?.data_source === 'builder_api';

  const fetchAgents = useCallback(async () => {
    try {
      setLoading(true);
      const params = {};
      if (search) params.search = search;
      if (providerFilter && providerFilter !== 'all') params.provider = providerFilter;
      const data = await agentApi.list(params);
      setAgents(data);
    } catch (err) {
      console.error('Failed to fetch agents:', err);
      toast.error('Failed to load agents');
    } finally {
      setLoading(false);
    }
  }, [search, providerFilter]);

  useEffect(() => {
    const timer = setTimeout(fetchAgents, 300);
    return () => clearTimeout(timer);
  }, [fetchAgents]);

  const handleClone = async (id) => {
    try {
      const cloned = await agentApi.clone(id);
      toast.success(`Cloned as "${cloned.name}"`);
      fetchAgents();
    } catch (err) {
      toast.error('Failed to clone agent');
    }
  };

  const handleExportYaml = async (id) => {
    try {
      const agent = await agentApi.get(id);
      const { last_modified, created_at, ...config } = agent;
      const yamlStr = yaml.dump(config, { lineWidth: 120, noRefs: true });
      const blob = new Blob([yamlStr], { type: 'text/yaml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${id}.yaml`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('YAML exported');
    } catch (err) {
      toast.error('Failed to export YAML');
    }
  };

  const handleRunEval = (agent) => {
    setEvalAgentId(agent.id);
    setEvalAgentName(agent.name);
    setEvalModalOpen(true);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await agentApi.delete(deleteTarget.id);
      toast.success(`Deleted agent: ${deleteTarget.name}`);
      setDeleteTarget(null);
      fetchAgents();
    } catch (err) {
      toast.error(parseApiError(err, 'Failed to delete agent'));
    } finally {
      setDeleting(false);
    }
  };

  const handleCompareSelected = () => {
    if (selectedIds.length === 2) {
      navigate(`/compare?a=${encodeURIComponent(selectedIds[0])}&b=${encodeURIComponent(selectedIds[1])}`);
    }
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : prev.length < 2 ? [...prev, id] : [prev[1], id]
    );
  };

  const formatDate = (d) => {
    if (!d) return '—';
    try {
      return new Date(d).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
      });
    } catch {
      return d;
    }
  };

  return (
    <div className="space-y-6">
      {/* Read-only banner - only shown when capabilities say globally read-only */}
      {isReadOnly && (
        <ReadOnlyBanner
          message={capabilities?.message || 'This data source is in read-only mode.'}
        />
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {agents.length} agent{agents.length !== 1 ? 's' : ''} configured
            {isBuilderMode && <span className="ml-1 text-blue-600 dark:text-blue-400">(Builder API)</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.length === 2 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleCompareSelected}
              data-testid="agent-list-compare-button"
            >
              <GitCompare className="w-4 h-4 mr-1" />
              Compare ({selectedIds.length})
            </Button>
          )}
          {!isReadOnly && (
            <Button
              onClick={() => navigate('/agents/new')}
              size="sm"
              data-testid="agent-list-new-agent-button"
            >
              <Plus className="w-4 h-4 mr-1" />
              New Agent
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search agents..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-9"
            data-testid="agent-list-search-input"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <Select value={providerFilter} onValueChange={setProviderFilter}>
          <SelectTrigger className="w-[180px] h-9" data-testid="agent-list-provider-filter">
            <SelectValue placeholder="All providers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All providers</SelectItem>
            {PROVIDERS.map(p => (
              <SelectItem key={p} value={p}>
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : agents.length === 0 ? (
        <EmptyState
          icon={Bot}
          title="No agents yet"
          body={isBuilderMode
            ? "No agents found on Builder API. Create your first agent to get started."
            : "Create your first agent or import a YAML config to get started."
          }
          primaryAction={{ label: 'Create Agent', onClick: () => navigate('/agents/new'), testId: 'empty-create-agent' }}
        />
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-10"></TableHead>
                <TableHead className="text-xs font-medium text-muted-foreground">Name</TableHead>
                <TableHead className="text-xs font-medium text-muted-foreground">Provider / Model</TableHead>
                <TableHead className="text-xs font-medium text-muted-foreground">Version</TableHead>
                <TableHead className="text-xs font-medium text-muted-foreground">Tags</TableHead>
                <TableHead className="text-xs font-medium text-muted-foreground">Last Modified</TableHead>
                <TableHead className="text-xs font-medium text-muted-foreground w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agents.map(agent => {
                const isFilesystem = agent.source === 'filesystem';
                const canEdit = !isReadOnly && !isFilesystem;
                const canDelete = !isReadOnly && !isFilesystem;
                const canClone = !isReadOnly;

                return (
                <TableRow
                  key={agent.id}
                  className="cursor-pointer hover:bg-muted/50"
                  data-testid={`agent-row-${agent.id}`}
                >
                  <TableCell className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selectedIds.includes(agent.id)}
                      onCheckedChange={() => toggleSelect(agent.id)}
                      aria-label={`Select ${agent.name}`}
                    />
                  </TableCell>
                  <TableCell
                    className="py-3 px-4 font-medium text-sm"
                    onClick={() => navigate(`/agents/${encodeURIComponent(agent.id)}/edit`)}
                  >
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-foreground">{agent.name}</span>
                        {isFilesystem && (
                          <Lock className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <p className="text-xs text-muted-foreground font-mono truncate max-w-[180px]">{agent.id}</p>
                        {isBuilderMode && agent.source && (
                          <Badge
                            variant="outline"
                            className={`text-[9px] px-1 py-0 ${
                              isFilesystem
                                ? 'text-amber-600 border-amber-300 dark:text-amber-400 dark:border-amber-700'
                                : 'text-emerald-600 border-emerald-300 dark:text-emerald-400 dark:border-emerald-700'
                            }`}
                            data-testid={`source-badge-${agent.id}`}
                          >
                            {isFilesystem ? 'fs' : 'db'}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell
                    className="py-3 px-4 text-sm"
                    onClick={() => navigate(`/agents/${encodeURIComponent(agent.id)}/edit`)}
                  >
                    <div>
                      <Badge variant="secondary" className="text-xs font-mono">
                        {agent.model?.provider || '—'}
                      </Badge>
                      <p className="text-xs text-muted-foreground mt-1 font-mono">
                        {agent.model?.model_id || '—'}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell
                    className="py-3 px-4 text-sm font-mono"
                    onClick={() => navigate(`/agents/${encodeURIComponent(agent.id)}/edit`)}
                  >
                    v{agent.version}
                  </TableCell>
                  <TableCell
                    className="py-3 px-4"
                    onClick={() => navigate(`/agents/${encodeURIComponent(agent.id)}/edit`)}
                  >
                    <div className="flex flex-wrap gap-1">
                      {(agent.tags || []).slice(0, 2).map(tag => (
                        <Badge key={tag} variant="outline" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                      {(agent.tags || []).length > 2 && (
                        <Badge variant="outline" className="text-xs">
                          +{agent.tags.length - 2}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell
                    className="py-3 px-4 text-xs text-muted-foreground"
                    onClick={() => navigate(`/agents/${encodeURIComponent(agent.id)}/edit`)}
                  >
                    {formatDate(agent.last_modified)}
                  </TableCell>
                  <TableCell className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => navigate(`/agents/${encodeURIComponent(agent.id)}/edit`)}>
                          <Pencil className="w-3.5 h-3.5 mr-2" /> {canEdit ? 'Edit' : 'View'}
                        </DropdownMenuItem>
                        {canClone && (
                          <DropdownMenuItem onClick={() => handleClone(agent.id)}>
                            <Copy className="w-3.5 h-3.5 mr-2" /> Clone
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => handleRunEval(agent)}>
                          <Rocket className="w-3.5 h-3.5 mr-2" /> Run Eval
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleExportYaml(agent.id)}>
                          <Download className="w-3.5 h-3.5 mr-2" /> Export YAML
                        </DropdownMenuItem>
                        {canEdit && !isBuilderMode && (
                          <DropdownMenuItem onClick={() => navigate(`/agents/${encodeURIComponent(agent.id)}/history`)}>
                            <GitCompare className="w-3.5 h-3.5 mr-2" /> Version History
                          </DropdownMenuItem>
                        )}
                        {canDelete && (
                          <DropdownMenuItem
                            onClick={() => setDeleteTarget(agent)}
                            className="text-destructive focus:text-destructive"
                            data-testid={`delete-agent-${agent.id}`}
                          >
                            <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      
      {/* Run Eval Modal */}
      <RunEvalModal
        open={evalModalOpen}
        onClose={() => {
          setEvalModalOpen(false);
          setEvalAgentId(null);
          setEvalAgentName(null);
        }}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent data-testid="delete-agent-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Agent</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <span className="font-mono font-medium">{deleteTarget?.name}</span>? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting} data-testid="cancel-delete-agent">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="confirm-delete-agent"
            >
              {deleting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
