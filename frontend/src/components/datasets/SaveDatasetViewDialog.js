import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { createDatasetView } from '@/services/evalApi';
import { parseApiError } from '@/lib/errorUtils';

/**
 * Save-as-view modal. `items` should be an array of `{dataset_type,
 * instance_id}` describing the current selection. On success calls
 * `onSaved(view)` with the canonical server response.
 */
export function SaveDatasetViewDialog({ open, onClose, items, onSaved }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName('');
      setDescription('');
      setSaving(false);
    }
  }, [open]);

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('Name is required');
      return;
    }
    if (!items || items.length === 0) {
      toast.error('Select at least one dataset row before saving a view');
      return;
    }
    setSaving(true);
    try {
      const view = await createDatasetView({
        name: trimmed,
        description: description.trim(),
        items,
      });
      toast.success(`Saved view "${view.name}" (${view.items.length} items)`);
      onSaved?.(view);
      onClose();
    } catch (err) {
      toast.error(parseApiError(err, 'Failed to save view'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !saving) onClose(); }}>
      <DialogContent className="sm:max-w-md" data-testid="save-view-dialog">
        <DialogHeader>
          <DialogTitle>Save as dataset view</DialogTitle>
          <DialogDescription>
            Pin {items?.length || 0} selected row{items?.length === 1 ? '' : 's'} into
            a named, shareable view. You'll be able to load it from the Datasets page
            or the Run Eval modal.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label htmlFor="save-view-name" className="text-xs">Name</Label>
            <Input
              id="save-view-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Smoke pack — sonnet-4-5"
              disabled={saving}
              className="mt-1.5"
              data-testid="save-view-name-input"
            />
          </div>
          <div>
            <Label htmlFor="save-view-description" className="text-xs">
              Description (optional)
            </Label>
            <Textarea
              id="save-view-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Anything you want others to know about this view…"
              disabled={saving}
              rows={3}
              className="mt-1.5 text-sm"
              data-testid="save-view-description-input"
            />
          </div>
          <div className="text-[10px] text-muted-foreground">
            Views are shared with everyone on this instance. Only you (the author)
            can edit or delete them later.
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={saving}
            data-testid="save-view-cancel-btn"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={saving || !name.trim() || !items?.length}
            data-testid="save-view-confirm-btn"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
            Save view
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
