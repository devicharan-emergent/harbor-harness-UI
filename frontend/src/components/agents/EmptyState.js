import { Button } from '@/components/ui/button';
import { PackageOpen } from 'lucide-react';

export function EmptyState({ icon: Icon = PackageOpen, title, body, primaryAction, secondaryAction }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card p-8 text-left">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
          <Icon className="w-5 h-5 text-muted-foreground" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {body && <p className="mt-1 text-sm text-muted-foreground max-w-prose">{body}</p>}
          {(primaryAction || secondaryAction) && (
            <div className="mt-4 flex flex-col sm:flex-row gap-2">
              {primaryAction && (
                <Button size="sm" onClick={primaryAction.onClick} data-testid={primaryAction.testId}>
                  {primaryAction.label}
                </Button>
              )}
              {secondaryAction && (
                <Button size="sm" variant="outline" onClick={secondaryAction.onClick} data-testid={secondaryAction.testId}>
                  {secondaryAction.label}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
