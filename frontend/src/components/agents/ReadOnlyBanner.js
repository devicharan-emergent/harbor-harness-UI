import { AlertTriangle, Database } from 'lucide-react';
import { Button } from '@/components/ui/button';
import axios from 'axios';
import { toast } from 'sonner';
import { useCapabilities } from '@/hooks/useCapabilities';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || '';

export function ReadOnlyBanner({ message }) {
  const { refresh } = useCapabilities();

  const handleSwitchToMongo = async () => {
    try {
      await axios.post(`${BACKEND_URL}/api/config/data-source`, { data_source: 'mongodb' });
      toast.success('Switched to MongoDB');
      await refresh();
      window.location.reload();
    } catch (error) {
      toast.error('Failed to switch data source');
    }
  };

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 rounded-lg border border-[hsl(var(--info-bg))] bg-[hsl(var(--info-bg)/0.5)]"
      data-testid="read-only-banner"
    >
      <AlertTriangle className="w-4 h-4 text-[hsl(var(--info-fg))] flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-[hsl(var(--info-fg))] font-medium">
          Read-only mode
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {message || 'Builder API is in read-only mode. Switch to MongoDB for full functionality.'}
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={handleSwitchToMongo}
        className="flex-shrink-0"
        data-testid="switch-to-mongo-button"
      >
        <Database className="w-3.5 h-3.5 mr-1" />
        Switch to MongoDB
      </Button>
    </div>
  );
}
