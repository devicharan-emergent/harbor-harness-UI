import { useEffect, useCallback, useState, useRef } from 'react';
import { useBlocker } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';

/**
 * Hook that guards against navigation when there are unsaved changes.
 * Handles both in-app navigation (React Router) and browser navigation (beforeunload).
 * Returns a `bypassBlock` function to allow programmatic navigation (e.g. after save).
 */
export function useUnsavedChangesGuard(isDirty) {
  const [showDialog, setShowDialog] = useState(false);
  const bypassRef = useRef(false);

  // Block in-app navigation via React Router
  const blocker = useBlocker(
    useCallback(
      ({ currentLocation, nextLocation }) => {
        if (bypassRef.current) {
          bypassRef.current = false;
          return false;
        }
        return isDirty && currentLocation.pathname !== nextLocation.pathname;
      },
      [isDirty]
    )
  );

  // Show dialog when blocker triggers
  useEffect(() => {
    if (blocker.state === 'blocked') {
      setShowDialog(true);
    }
  }, [blocker.state]);

  // Block browser navigation / tab close
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  const confirmLeave = useCallback(() => {
    setShowDialog(false);
    if (blocker.state === 'blocked') {
      blocker.proceed();
    }
  }, [blocker]);

  const cancelLeave = useCallback(() => {
    setShowDialog(false);
    if (blocker.state === 'blocked') {
      blocker.reset();
    }
  }, [blocker]);

  /** Call before programmatic navigation (e.g. after a successful save) */
  const bypassBlock = useCallback(() => {
    bypassRef.current = true;
  }, []);

  return { showDialog, confirmLeave, cancelLeave, bypassBlock };
}

/**
 * Dialog component for unsaved changes confirmation.
 */
export function UnsavedChangesDialog({ open, onConfirm, onCancel }) {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-amber-50 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-4 h-4 text-amber-700" />
            </div>
            <DialogTitle className="text-base">Unsaved changes</DialogTitle>
          </div>
          <DialogDescription className="pt-2">
            You have unsaved changes that will be lost if you leave this page. Do you want to discard them?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onCancel} data-testid="unsaved-dialog-cancel">
            Keep editing
          </Button>
          <Button variant="destructive" onClick={onConfirm} data-testid="unsaved-dialog-confirm">
            Discard changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
