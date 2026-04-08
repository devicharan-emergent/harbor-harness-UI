import { useEffect, useState } from 'react';
import { checkEvalHealth } from '@/services/evalApi';
import { checkBuilderHealth } from '@/services/builderApi';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Activity } from 'lucide-react';

export function ApiHealthIndicator() {
  const [evalHealth, setEvalHealth] = useState({ healthy: null, checking: true });
  const [builderHealth, setBuilderHealth] = useState({ healthy: null, checking: true });

  const checkHealth = async () => {
    const [evalResult, builderResult] = await Promise.all([
      checkEvalHealth(),
      checkBuilderHealth()
    ]);
    setEvalHealth({ ...evalResult, checking: false });
    setBuilderHealth({ ...builderResult, checking: false });
  };

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  const allHealthy = evalHealth.healthy && builderHealth.healthy;
  const anyDown = evalHealth.healthy === false || builderHealth.healthy === false;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-2 px-2.5 py-2 text-xs" data-testid="api-health-indicator">
            <Activity className="w-3.5 h-3.5 text-muted-foreground" />
            <div className="flex items-center gap-1.5">
              <div className={`w-1.5 h-1.5 rounded-full ${
                evalHealth.checking ? 'bg-slate-400' :
                evalHealth.healthy ? 'bg-emerald-500' : 'bg-red-500'
              }`} />
              <div className={`w-1.5 h-1.5 rounded-full ${
                builderHealth.checking ? 'bg-slate-400' :
                builderHealth.healthy ? 'bg-emerald-500' : 'bg-red-500'
              }`} />
            </div>
            <span className="text-muted-foreground">
              {allHealthy ? 'ok' : anyDown ? 'degraded' : 'checking...'}
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${
                evalHealth.healthy ? 'bg-emerald-500' : 'bg-red-500'
              }`} />
              <span>Eval API: {evalHealth.healthy ? 'healthy' : 'down'}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${
                builderHealth.healthy ? 'bg-emerald-500' : 'bg-red-500'
              }`} />
              <span>Builder API: {builderHealth.healthy ? 'healthy' : 'down'}</span>
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
