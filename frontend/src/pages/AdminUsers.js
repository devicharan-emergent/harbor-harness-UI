import { useState, useEffect, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ShieldCheck, UserPlus, RefreshCw, Loader2, Trash2, Crown, User as UserIcon, CheckCircle2, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAuth } from '@/contexts/AuthContext';
import { listAdminUsers, addAdminUser, updateAdminUser, removeAdminUser, adminErrorMessage } from '@/services/adminApi';

const initials = (name, email) =>
  (name || email || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

export default function AdminUsers() {
  const { user, loading: authLoading } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState('member');
  const [adding, setAdding] = useState(false);
  const [busyEmail, setBusyEmail] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listAdminUsers());
    } catch (err) {
      toast.error(adminErrorMessage(err, 'Failed to load users'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user?.role === 'admin') load();
  }, [user, load]);

  if (authLoading) return null;
  if (user?.role !== 'admin') return <Navigate to="/" replace />;

  const handleAdd = async (e) => {
    e.preventDefault();
    const email = newEmail.trim().toLowerCase();
    if (!email) return;
    setAdding(true);
    try {
      await addAdminUser(email, newRole);
      toast.success(`Granted access to ${email}`);
      setNewEmail('');
      setNewRole('member');
      await load();
    } catch (err) {
      toast.error(adminErrorMessage(err, 'Failed to add user'));
    } finally {
      setAdding(false);
    }
  };

  const patch = async (email, body, okMsg) => {
    setBusyEmail(email);
    try {
      await updateAdminUser(email, body);
      toast.success(okMsg);
      await load();
    } catch (err) {
      toast.error(adminErrorMessage(err, 'Update failed'));
    } finally {
      setBusyEmail(null);
    }
  };

  const handleRemove = async (email) => {
    setBusyEmail(email);
    try {
      await removeAdminUser(email);
      toast.success(`Revoked ${email}`);
      await load();
    } catch (err) {
      toast.error(adminErrorMessage(err, 'Remove failed'));
    } finally {
      setBusyEmail(null);
    }
  };

  const activeAdmins = rows.filter((r) => r.role === 'admin' && r.active).length;

  return (
    <div className="space-y-6" data-testid="admin-users-page">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <ShieldCheck className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold leading-none">Access control</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage who can sign in and run evals. Only allow-listed @emergent users have access.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="ml-auto" data-testid="admin-refresh-btn">
          <RefreshCw className={`w-4 h-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <UserPlus className="w-4 h-4" /> Grant access
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <Input
              type="email"
              placeholder="person@emergent.sh"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              className="sm:max-w-xs"
              data-testid="admin-add-email"
            />
            <Select value={newRole} onValueChange={setNewRole}>
              <SelectTrigger className="sm:w-36" data-testid="admin-add-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">Member</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
            <Button type="submit" disabled={adding || !newEmail.trim()} data-testid="admin-add-submit">
              {adding ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <UserPlus className="w-4 h-4 mr-1.5" />}
              Add user
            </Button>
          </form>
          <p className="text-[11px] text-muted-foreground mt-2">
            Only <span className="font-mono">@emergent*</span> addresses can be added. Adding a previously
            revoked user re-activates them.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center justify-between">
            <span>Allow-list ({rows.length})</span>
            <span className="text-xs font-normal text-muted-foreground">{activeAdmins} active admin{activeAdmins === 1 ? '' : 's'}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-12 text-center">No users yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Added by</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const busy = busyEmail === r.email;
                  const isSelf = r.email === (user?.email || '').toLowerCase();
                  return (
                    <TableRow key={r.email} data-testid={`admin-row-${r.email}`} className={!r.active ? 'opacity-60' : ''}>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <Avatar className="w-7 h-7">
                            {r.picture ? <AvatarImage src={r.picture} alt={r.name || r.email} /> : null}
                            <AvatarFallback className="text-[10px]">{initials(r.name, r.email)}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate flex items-center gap-1.5">
                              {r.name || r.email.split('@')[0]}
                              {isSelf && <span className="text-[9px] text-muted-foreground">(you)</span>}
                            </div>
                            <div className="text-[11px] text-muted-foreground truncate">{r.email}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={r.role}
                          onValueChange={(role) => patch(r.email, { role }, `${r.email} is now ${role}`)}
                          disabled={busy}
                        >
                          <SelectTrigger className="w-28 h-8 text-xs" data-testid={`admin-role-select-${r.email}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="member"><span className="flex items-center gap-1.5"><UserIcon className="w-3 h-3" /> Member</span></SelectItem>
                            <SelectItem value="admin"><span className="flex items-center gap-1.5"><Crown className="w-3 h-3" /> Admin</span></SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        {r.active ? (
                          <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-600 border-emerald-500/20" data-testid={`admin-status-${r.email}`}>
                            <CheckCircle2 className="w-3 h-3 mr-1" /> Active
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] bg-muted text-muted-foreground" data-testid={`admin-status-${r.email}`}>
                            <XCircle className="w-3 h-3 mr-1" /> Revoked
                          </Badge>
                        )}
                        {!r.has_logged_in && r.active && (
                          <span className="ml-2 text-[10px] text-muted-foreground italic">not signed in</span>
                        )}
                      </TableCell>
                      <TableCell className="text-[11px] text-muted-foreground">{r.added_by || '—'}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {r.active ? (
                            <Button
                              variant="ghost" size="sm" disabled={busy}
                              onClick={() => handleRemove(r.email)}
                              className="text-rose-600 hover:text-rose-700 hover:bg-rose-500/10 h-8"
                              data-testid={`admin-revoke-${r.email}`}
                            >
                              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                              <span className="ml-1.5">Revoke</span>
                            </Button>
                          ) : (
                            <Button
                              variant="ghost" size="sm" disabled={busy}
                              onClick={() => patch(r.email, { active: true }, `Reactivated ${r.email}`)}
                              className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-500/10 h-8"
                              data-testid={`admin-reactivate-${r.email}`}
                            >
                              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                              <span className="ml-1.5">Reactivate</span>
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
