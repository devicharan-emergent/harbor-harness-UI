import { useState, useEffect, createContext, useContext } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Server, Cloud } from 'lucide-react';

const ENVS = {
  dev: {
    label: 'Dev',
    icon: Server,
    cortexUrl: 'http://agentsdk.internal-staging.emergentagent.com',
  },
  ephemeral: {
    label: 'Ephemeral',
    icon: Cloud,
    cortexUrl: '', // dynamically built from eph name
  },
};

const EnvContext = createContext({
  env: 'dev',
  ephName: '',
  cortexUrl: 'http://agentsdk.internal-staging.emergentagent.com',
  setEnv: () => {},
  setEphName: () => {},
});

export function useEnv() {
  return useContext(EnvContext);
}

export function EnvProvider({ children }) {
  const [env, setEnv] = useState(() => localStorage.getItem('acm_env') || 'dev');
  const [ephName, setEphName] = useState(() => localStorage.getItem('acm_eph_name') || '');

  useEffect(() => {
    localStorage.setItem('acm_env', env);
  }, [env]);

  useEffect(() => {
    localStorage.setItem('acm_eph_name', ephName);
  }, [ephName]);

  const cortexUrl = env === 'dev'
    ? ENVS.dev.cortexUrl
    : ephName ? `https://cortex-${ephName}-tit7tznrtq-uc.a.run.app` : '';

  return (
    <EnvContext.Provider value={{ env, ephName, cortexUrl, setEnv, setEphName }}>
      {children}
    </EnvContext.Provider>
  );
}

export function EnvSwitcher() {
  const { env, ephName, setEnv, setEphName, cortexUrl } = useEnv();
  const config = ENVS[env];
  const Icon = config.icon;

  return (
    <div className="px-2.5 space-y-1.5" data-testid="env-switcher">
      <div className="flex items-center gap-1.5">
        <Icon className="w-3 h-3 text-muted-foreground" />
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Environment</Label>
      </div>
      <Select value={env} onValueChange={setEnv}>
        <SelectTrigger className="h-7 text-xs" data-testid="env-select">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="dev">
            <span className="flex items-center gap-1.5">
              <Server className="w-3 h-3" /> Dev
            </span>
          </SelectItem>
          <SelectItem value="ephemeral">
            <span className="flex items-center gap-1.5">
              <Cloud className="w-3 h-3" /> Ephemeral
            </span>
          </SelectItem>
        </SelectContent>
      </Select>
      {env === 'ephemeral' && (
        <Input
          value={ephName}
          onChange={e => setEphName(e.target.value)}
          placeholder="eph name (e.g. builder-1)"
          className="h-7 text-[11px] font-mono"
          data-testid="eph-name-input"
        />
      )}
      {cortexUrl && (
        <p className="text-[9px] font-mono text-muted-foreground/60 truncate" title={cortexUrl}>
          {cortexUrl}
        </p>
      )}
    </div>
  );
}
