import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { parseApiError } from '@/lib/errorUtils';
import yaml from 'js-yaml';
import agentApi from '@/lib/api';
import { DEFAULT_AGENT } from '@/lib/constants';
import { useCapabilities } from '@/hooks/useCapabilities';
import { ReadOnlyBanner } from '@/components/agents/ReadOnlyBanner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { UnsavedDot } from '@/components/agents/UnsavedDot';
import { useUnsavedChangesGuard, UnsavedChangesDialog } from '@/components/agents/UnsavedChangesGuard';
import GeneralTab from '@/components/agents/GeneralTab';
import ModelTab from '@/components/agents/ModelTab';
import ToolsetsTab from '@/components/agents/ToolsetsTab';
import OverridesTab from '@/components/agents/OverridesTab';
import RuntimeTab from '@/components/agents/RuntimeTab';
import HooksTab from '@/components/agents/HooksTab';
import RawYamlTab from '@/components/agents/RawYamlTab';
import { Save, ArrowLeft, Download, Copy, History, Loader2, AlertTriangle, Lock } from 'lucide-react';

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export default function AgentEditor({ isClone = false }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id;
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState(deepClone(DEFAULT_AGENT));
  const [originalConfig, setOriginalConfig] = useState(null);
  const [activeTab, setActiveTab] = useState('general');
  const [allAgentIds, setAllAgentIds] = useState([]);
  const { capabilities } = useCapabilities();
  const isGlobalReadOnly = capabilities?.read_only === true;
  // Per-agent restriction: filesystem agents in Builder mode are read-only
  const isFilesystemAgent = config?.source === 'filesystem';
  const isReadOnly = isGlobalReadOnly || isFilesystemAgent;

  // Fetch agent data
  useEffect(() => {
    if (isNew) {
      setOriginalConfig(deepClone(DEFAULT_AGENT));
      return;
    }
    const fetchData = async () => {
      try {
        setLoading(true);
        const agent = await agentApi.get(id);
        if (isClone) {
          agent.name = `${agent.name}_copy`;
          agent.id = `${slugify(agent.name)}-${slugify(agent.model?.model_id || 'default')}`;
          agent.version = 1;
        }
        setConfig(agent);
        setOriginalConfig(deepClone(agent));
      } catch (err) {
        toast.error('Failed to load agent');
        navigate('/');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [id, isNew, isClone, navigate]);

  // Fetch all agent ids for subagent validation
  useEffect(() => {
    agentApi.list().then(agents => {
      setAllAgentIds(agents.map(a => a.id));
    }).catch(() => {});
  }, []);

  const isDirty = useMemo(() => {
    if (!originalConfig) return false;
    return JSON.stringify(config) !== JSON.stringify(originalConfig);
  }, [config, originalConfig]);

  // Navigation guard for unsaved changes
  const { showDialog, confirmLeave, cancelLeave, bypassBlock } = useUnsavedChangesGuard(isDirty);

  const autoGenerateId = useCallback(() => {
    const name = config.name || '';
    const modelId = config.model?.model_id || 'default';
    return `${slugify(name)}-${slugify(modelId)}`;
  }, [config.name, config.model?.model_id]);

  const updateConfig = useCallback((path, value) => {
    setConfig(prev => {
      const next = deepClone(prev);
      const keys = path.split('.');
      let obj = next;
      for (let i = 0; i < keys.length - 1; i++) {
        if (obj[keys[i]] === undefined) obj[keys[i]] = {};
        obj = obj[keys[i]];
      }
      obj[keys[keys.length - 1]] = value;
      return next;
    });
  }, []);

  const handleSave = async () => {
    if (!config.name) {
      toast.error('Agent name is required');
      setActiveTab('general');
      return;
    }

    setSaving(true);
    try {
      const saveData = { ...config };
      if (!saveData.id) {
        saveData.id = autoGenerateId();
      }

      if (isNew || isClone) {
        const result = await agentApi.create(saveData);
        toast.success(`Agent "${result.name}" created (v${result.version})`);
        bypassBlock();
        navigate(`/agents/${encodeURIComponent(result.id)}/edit`);
      } else {
        const result = await agentApi.update(id, saveData);
        setConfig(result);
        setOriginalConfig(deepClone(result));
        toast.success(`Saved v${result.version}`);
      }
    } catch (err) {
      toast.error(parseApiError(err, 'Failed to save agent'));
    } finally {
      setSaving(false);
    }
  };

  const handleExport = () => {
    const { last_modified, created_at, ...exportData } = config;
    const yamlStr = yaml.dump(exportData, { lineWidth: 120, noRefs: true });
    const blob = new Blob([yamlStr], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${config.id || 'agent'}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('YAML exported');
  };

  const handleClone = async () => {
    if (id) {
      navigate(`/agents/${encodeURIComponent(id)}/clone`);
    }
  };

  const handleImportYaml = (yamlStr) => {
    try {
      const parsed = yaml.load(yamlStr);
      if (parsed && typeof parsed === 'object') {
        const merged = { ...deepClone(DEFAULT_AGENT), ...parsed };
        setConfig(merged);
        toast.success('YAML imported successfully');
      } else {
        toast.error('Invalid YAML structure');
      }
    } catch (err) {
      toast.error(`YAML parse error: ${err.message}`);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const tabProps = { config, updateConfig: isReadOnly ? () => {} : updateConfig, allAgentIds };

  return (
    <div className="space-y-4">
      {/* Read-only banner */}
      {isReadOnly && (
        <ReadOnlyBanner message={
          isFilesystemAgent
            ? "This is a filesystem agent managed externally. Clone it to create an editable copy."
            : "You are viewing this agent in read-only mode. Switch to MongoDB to edit."
        } />
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/')} className="h-8 w-8">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold tracking-tight">
                {isNew ? 'New Agent' : isClone ? 'Clone Agent' : config.name || 'Untitled'}
              </h1>
              {isDirty && !isReadOnly && <UnsavedDot show={true} />}
              {config.version && !isNew && (
                <Badge variant="secondary" className="text-xs font-mono">v{config.version}</Badge>
              )}
              {isReadOnly && (
                <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 dark:text-amber-400 dark:border-amber-700 flex items-center gap-1">
                  <Lock className="w-2.5 h-2.5" />
                  {isFilesystemAgent ? 'Filesystem' : 'Read-only'}
                </Badge>
              )}
            </div>
            {config.id && (
              <p className="text-xs text-muted-foreground font-mono mt-0.5">{config.id}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!isNew && !isClone && (
            <Button variant="outline" size="sm" onClick={handleClone} data-testid="agent-editor-clone-button">
              <Copy className="w-3.5 h-3.5 mr-1" /> Clone
            </Button>
          )}
          {!isNew && !isClone && !isReadOnly && (
            <Button variant="outline" size="sm" onClick={() => navigate(`/agents/${encodeURIComponent(id)}/history`)}>
              <History className="w-3.5 h-3.5 mr-1" /> History
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={handleExport} data-testid="agent-editor-export-yaml-button">
            <Download className="w-3.5 h-3.5 mr-1" /> Export
          </Button>
          {!isReadOnly && (
            <Button size="sm" onClick={handleSave} disabled={saving} data-testid="agent-editor-save-button">
              {saving ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1" />}
              Save
            </Button>
          )}
        </div>
      </div>

      {/* Unsaved warning */}
      {isDirty && !isReadOnly && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-amber-50 border border-amber-200">
          <AlertTriangle className="w-4 h-4 text-amber-700" />
          <span className="text-sm text-amber-700 font-medium">You have unsaved changes</span>
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} data-testid="agent-editor-tabs">
        <TabsList className="bg-secondary border border-border rounded-lg p-1 h-auto flex-wrap">
          {[
            { value: 'general', label: 'General' },
            { value: 'model', label: 'Model' },
            { value: 'toolsets', label: 'Toolsets' },
            { value: 'overrides', label: 'Overrides' },
            { value: 'runtime', label: 'Runtime' },
            { value: 'hooks', label: 'Hooks' },
            { value: 'raw-yaml', label: 'Raw YAML' },
          ].map(tab => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="text-sm data-[state=active]:bg-card data-[state=active]:border data-[state=active]:border-slate-200 rounded-md px-3 py-1.5"
              data-testid={`agent-editor-tab-${tab.value}`}
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="mt-4">
          <TabsContent value="general" className="mt-0">
            <GeneralTab {...tabProps} autoGenerateId={autoGenerateId} />
          </TabsContent>
          <TabsContent value="model" className="mt-0">
            <ModelTab {...tabProps} />
          </TabsContent>
          <TabsContent value="toolsets" className="mt-0">
            <ToolsetsTab {...tabProps} />
          </TabsContent>
          <TabsContent value="overrides" className="mt-0">
            <OverridesTab {...tabProps} />
          </TabsContent>
          <TabsContent value="runtime" className="mt-0">
            <RuntimeTab {...tabProps} />
          </TabsContent>
          <TabsContent value="hooks" className="mt-0">
            <HooksTab {...tabProps} />
          </TabsContent>
          <TabsContent value="raw-yaml" className="mt-0">
            <RawYamlTab config={config} onImport={handleImportYaml} />
          </TabsContent>
        </div>
      </Tabs>

      {/* Unsaved changes navigation guard dialog */}
      <UnsavedChangesDialog
        open={showDialog}
        onConfirm={confirmLeave}
        onCancel={cancelLeave}
      />
    </div>
  );
}
