import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { MessageSquare, Send, Trash2, Loader2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import {
  listGroupComments,
  createGroupComment,
  deleteGroupComment,
} from '@/services/evalApi';
import { useAuth } from '@/contexts/AuthContext';
import { parseApiError } from '@/lib/errorUtils';

const MAX_LEN = 4000;

/**
 * Inline comments thread for a single group_run_id. Mounted inside an
 * expanded `Collapsible` on /evals — fetches lazily on first render
 * (parent already lazily expands), so the network is only hit when the
 * user actually opens a group.
 *
 * Permissions: anyone authenticated can post a comment; only the author
 * can delete their own comment (server enforces).
 */
export function GroupCommentsPanel({ groupId }) {
  const { user } = useAuth();
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);

  const fetchComments = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listGroupComments(groupId);
      setComments(data?.comments || []);
    } catch (err) {
      // 404/500 shouldn't blow up the parent expand; surface a single
      // toast and leave the panel empty.
      toast.error(parseApiError(err, 'Failed to load comments'));
      setComments([]);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => { fetchComments(); }, [fetchComments]);

  const handlePost = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (trimmed.length > MAX_LEN) {
      toast.error(`Comment exceeds ${MAX_LEN} chars`);
      return;
    }
    setPosting(true);
    try {
      const created = await createGroupComment(groupId, trimmed);
      // Append optimistically so the new row appears at the bottom
      // without a refetch round-trip.
      setComments((prev) => [...prev, created]);
      setText('');
    } catch (err) {
      const msg = parseApiError(err, 'Failed to post comment');
      if ((err?.response?.status) === 401) {
        toast.error('Sign in to post a comment');
      } else {
        toast.error(msg);
      }
    } finally {
      setPosting(false);
    }
  };

  const handleDelete = async (commentId) => {
    try {
      await deleteGroupComment(groupId, commentId);
      setComments((prev) => prev.filter((c) => c.comment_id !== commentId));
      toast.success('Comment deleted');
    } catch (err) {
      toast.error(parseApiError(err, 'Failed to delete comment'));
    }
  };

  const myId = user?.user_id || null;

  return (
    <div
      className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-3"
      data-testid={`group-comments-${groupId}`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2">
        <MessageSquare className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold text-muted-foreground">Comments</span>
        <Badge variant="outline" className="text-[9px] font-mono px-1 py-0">
          {comments.length}
        </Badge>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-3 text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        </div>
      ) : comments.length === 0 ? (
        <p className="text-[11px] text-muted-foreground italic" data-testid={`group-comments-empty-${groupId}`}>
          No comments yet. Be the first to add one.
        </p>
      ) : (
        <ul className="space-y-2" data-testid={`group-comments-list-${groupId}`}>
          {comments.map((c) => {
            const isMine = c.created_by_user_id === myId;
            const when = c.created_at
              ? formatDistanceToNow(new Date(c.created_at), { addSuffix: true })
              : '';
            const author = c.created_by_name || c.created_by_email || 'unknown';
            return (
              <li
                key={c.comment_id}
                className="rounded-md border border-border/40 bg-background p-2.5"
                data-testid={`group-comment-${c.comment_id}`}
              >
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-1">
                      <span className="font-medium text-foreground/80">{author}</span>
                      <span>·</span>
                      <span>{when}</span>
                      {isMine && (
                        <Badge variant="secondary" className="text-[8px] px-1 py-0 h-3.5 ml-1">
                          you
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs whitespace-pre-wrap break-words leading-relaxed">
                      {c.text}
                    </p>
                  </div>
                  {isMine && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-destructive flex-shrink-0"
                      onClick={() => handleDelete(c.comment_id)}
                      data-testid={`group-comment-delete-${c.comment_id}`}
                      aria-label="Delete comment"
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Compose */}
      <div className="space-y-1.5">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={user ? 'Add a comment about this run…' : 'Sign in to add a comment'}
          disabled={!user || posting}
          rows={2}
          className="text-xs resize-none"
          maxLength={MAX_LEN}
          data-testid={`group-comment-input-${groupId}`}
          onKeyDown={(e) => {
            // Cmd/Ctrl + Enter → post. Plain Enter inserts a newline so
            // multi-line bug notes / repro steps stay legible.
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handlePost();
            }
          }}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-muted-foreground">
            {text.length > 0 && (
              <>{text.length}/{MAX_LEN} · <span className="font-mono">⌘↵</span> to post</>
            )}
          </span>
          <Button
            size="sm"
            disabled={!user || posting || !text.trim()}
            onClick={handlePost}
            className="h-7 text-xs gap-1.5"
            data-testid={`group-comment-submit-${groupId}`}
          >
            {posting ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Send className="w-3 h-3" />
            )}
            Post
          </Button>
        </div>
      </div>
    </div>
  );
}

export default GroupCommentsPanel;
