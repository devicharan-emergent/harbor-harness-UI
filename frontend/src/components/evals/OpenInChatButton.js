import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import { prepareEvalForUI, buildChatURL } from '@/services/evalApi';

// "Open in Chat" button for harbor eval jobs.
//
// Click → POST /api/eval/jobs/{id}/prepare-for-ui (idempotent) → open the
// returned chat URL in a new tab. Mirrors the harness spec:
//   - if `repaired` is exactly ["already_healthy"]: no toast, just open
//   - otherwise: brief info toast listing what got fixed
//   - 400 (still queued) / 404 / 500 / 503 → spec'd error toast
//
// Props:
//   jobId — the harness eval UUID
//   status — current eval status; while it's `queued` the server hasn't
//            assigned a cortex_job_id yet, so we short-circuit with a
//            friendlier message rather than burning a server roundtrip.
//   variant — passthrough to the shadcn Button (defaults to 'outline')
//   size — passthrough (defaults to 'sm')
//   className — extra classes
//   compact — when true, hides the label and shows just the icon (for list rows)
export function OpenInChatButton({
  jobId,
  status,
  variant = 'outline',
  size = 'sm',
  className = '',
  compact = false,
}) {
  const [busy, setBusy] = useState(false);

  const handleClick = async (e) => {
    // List rows wrap the whole div in a navigate-on-click handler — keep
    // the chat button from navigating away.
    e.stopPropagation();
    e.preventDefault();

    if (status === 'queued') {
      toast.info('Eval still queued — wait until it starts running.');
      return;
    }

    setBusy(true);
    try {
      const data = await prepareEvalForUI(jobId);
      if (!data?.cortex_job_id) {
        toast.error('Harness returned no cortex_job_id — cannot open chat.');
        return;
      }

      // Optional informational toast (per spec — useful while the feature
      // is new). Quiet on the all-healthy path.
      if (!data.repaired?.includes('already_healthy')) {
        toast.info(`Prepared chat (${(data.repaired || []).join(', ') || 'no changes'})`);
      }

      const url = buildChatURL(data.eph || '', data.cortex_job_id);
      if (!url) {
        toast.error('Could not construct chat URL.');
        return;
      }
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      // Surface the harness's 4xx/5xx envelope when present, otherwise the
      // generic axios message. Spec mappings:
      //   400 → still queued
      //   404 → eval not found
      //   503 → harness app DB not configured
      const resp = err?.response;
      const detail = resp?.data?.detail || resp?.data;
      const harnessMsg = detail?.message || detail?.error;
      const httpStatus = resp?.status;
      let msg;
      if (httpStatus === 400) {
        msg = harnessMsg || 'Eval still queued — wait until it starts running.';
      } else if (httpStatus === 404) {
        msg = 'Eval not found.';
      } else if (httpStatus === 503) {
        msg = 'Harness not configured for chat repair yet.';
      } else {
        msg = harnessMsg || err?.message || 'Could not prepare chat.';
      }
      console.error('[OpenInChatButton] prepare-for-ui failed', { httpStatus, detail, err });
      toast.error(`Could not prepare chat: ${msg}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleClick}
      disabled={busy || status === 'queued'}
      title={status === 'queued' ? 'Eval still queued — chat unavailable' : 'Open this eval in the chat UI'}
      className={className}
      data-testid={`open-in-chat-btn-${jobId}`}
    >
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MessageSquare className="w-3.5 h-3.5" />}
      {!compact && <span className="ml-1.5">Open in Chat</span>}
    </Button>
  );
}

export default OpenInChatButton;
