import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Database, Cloud, Loader2, Lock } from 'lucide-react';
import axios from 'axios';
import { toast } from 'sonner';
import { parseApiError } from '@/lib/errorUtils';
import { useCapabilities } from '@/hooks/useCapabilities';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || '';

export function DataSourceIndicator() {
  const { capabilities, loading, refresh } = useCapabilities();
  const [switching, setSwitching] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  if (loading || !capabilities) return null;

  const isMongoDB = capabilities.data_source === 'mongodb';
  const isReadOnly = capabilities.read_only === true;
  const Icon = switching ? Loader2 : (isMongoDB ? Database : Cloud);
  const label = isMongoDB ? 'MongoDB' : 'Builder API';
  const colorClass = isMongoDB
    ? 'text-emerald-600 dark:text-emerald-400'
    : 'text-blue-600 dark:text-blue-400';

  const handleToggle = async () => {
    const newSource = isMongoDB ? 'builder_api' : 'mongodb';
    setSwitching(true);
    setShowConfirm(false);

    try {
      await axios.post(`${BACKEND_URL}/api/config/data-source`, { data_source: newSource });
      toast.success(`Switched to ${newSource === 'mongodb' ? 'MongoDB' : 'Builder API'}`);
      await refresh();

      // Reload page to refresh data
      setTimeout(() => {
        window.location.reload();
      }, 500);
    } catch (error) {
      toast.error(parseApiError(error, 'Failed to switch data source'));
    } finally {
      setSwitching(false);
    }
  };

  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setShowConfirm(true)}
              disabled={switching}
              className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-accent/50 rounded-md transition-colors w-full"
              data-testid="data-source-indicator"
            >
              <Icon className={`w-3.5 h-3.5 ${colorClass} ${switching ? 'animate-spin' : ''}`} />
              <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                {label}
              </span>
              {isReadOnly && (
                <Lock className="w-2.5 h-2.5 text-muted-foreground ml-auto" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            <p>Data source: {label}</p>
            <p className="text-[10px] text-muted-foreground mt-1">
              {isMongoDB
                ? 'Full CRUD access via local MongoDB'
                : 'Full CRUD via Builder API (filesystem agents read-only)'}
            </p>
            <p className="text-[10px] text-blue-600 dark:text-blue-400 mt-1">
              Click to switch
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch Data Source?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                You're about to switch from <span className="font-mono font-bold">{label}</span> to{' '}
                <span className="font-mono font-bold">{isMongoDB ? 'Builder API' : 'MongoDB'}</span>.
              </p>
              {isMongoDB ? (
                <>
                  <p className="text-xs text-blue-600 dark:text-blue-400">
                    Builder API provides access to 110+ remote agents. Agents marked 'filesystem' are read-only.
                  </p>
                  <p className="text-xs">
                    You can create, edit, and delete database-backed agents in Builder mode.
                  </p>
                </>
              ) : (
                <p className="text-xs text-emerald-600 dark:text-emerald-400">
                  Switching back to MongoDB will restore your local agents with full version history.
                </p>
              )}
              <p className="text-xs text-muted-foreground mt-2">
                The page will reload after switching.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleToggle} data-testid="confirm-switch-data-source">
              Switch to {isMongoDB ? 'Builder API' : 'MongoDB'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
