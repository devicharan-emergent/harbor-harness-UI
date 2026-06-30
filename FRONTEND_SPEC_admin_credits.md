# Frontend spec — Admin dashboard + Credits display

The backend (FastAPI in `harbor-harness-UI/backend/server.py`) is done. Build the
frontend against these endpoints. All requests go through the existing
`authAxios` instance (it already appends `?access_token=` and points at
`getApiBaseURL()/api`). No new auth wiring needed.

## 1. Role is now on the user object

`GET /api/auth/me` and `POST /api/auth/session` now return a `role` field:
`"admin"` | `"member"` | `null`. Use it to show/hide admin UI.

- In `AuthContext`, expose `role` (e.g. `user.role`). Add a convenience
  `const isAdmin = user?.role === 'admin'`.
- Only render the "Admin" nav item / route when `isAdmin`.

## 2. Admin dashboard (admin-only page, e.g. route `/admin`)

Guard the route so non-admins are redirected (reuse `ProtectedRoute`, plus an
`isAdmin` check — non-admins hitting the API get `403 {error:"not_admin"}`).

A table of allow-listed users + an "Add user" form.

### Endpoints
| Action | Call | Notes |
|---|---|---|
| List | `GET /api/admin/users` | returns array (below) |
| Add | `POST /api/admin/users` body `{ "email": "x@emergent.sh", "role": "member" }` | `role` optional, default `member`; **must be `@emergent*`** or 400 `{error:"invalid_email"}` |
| Change role / re-activate / deactivate | `PATCH /api/admin/users/{email}` body `{ "role": "admin" }` or `{ "active": false }` | |
| Remove access | `DELETE /api/admin/users/{email}` | soft-delete (`active:false`), kills their live sessions |

### Row shape (from GET/POST/PATCH)
```json
{
  "email": "alice@emergent.sh",
  "role": "member",            // "admin" | "member"
  "active": true,
  "added_by": "shresth@emergent.sh",
  "created_at": "2026-06-30T...",
  "updated_at": "2026-06-30T...",
  "name": "Alice",             // null until they've logged in
  "picture": "https://...",    // null until they've logged in
  "has_logged_in": true
}
```

### UI requirements
- **Table columns:** avatar (`picture`)/name + email, role (badge), status
  (Active / Revoked from `active`), "added by", "signed in?" (`has_logged_in`).
- **Add form:** email input + role select (Member/Admin) + Add button.
  - On `400 invalid_email`, show "Only @emergent emails can be added."
- **Per-row actions:** toggle role (Member↔Admin) via PATCH; Revoke (DELETE) /
  Re-activate (PATCH `{active:true}`) toggle.
- **Last-admin guard:** PATCH/DELETE may return `400 {error:"last_admin"}` —
  surface as "Can't remove the last admin." (Optional: also disable the control
  client-side when there's exactly one active admin and it's this row.)
- Refetch the list after every mutation.

### Error envelopes to handle
- `401` → not logged in (shouldn't happen behind ProtectedRoute).
- `403 {error:"not_admin"}` → not an admin; hide the page / redirect.
- `400 {error:"invalid_email"|"last_admin"}` → inline message.

## 3. Credits display (read-only, admin-only)

`GET /api/credits` → the cortex eval user's remaining ECU balance.

Response (shape may carry more fields from the harness):
```json
{ "available": true, "ecu": 4999.4, "daily_credits": -136.1, "monthly_credits": 0 }
```
or, while the harness data source is still being wired:
```json
{ "available": false, "reason": "harness unreachable: ..." }
```

UI: a small card/badge (e.g. on the dashboard header or admin page) showing
**"ECU remaining: 4,999"**. If `available` is `false`, show "Credits:
unavailable" (muted) — do **not** error. Round/format `ecu` to a whole number.
Optionally color it red/amber when low (e.g. `< 2000`).

## Notes
- The login flow, session handling, and the `@emergent`-domain check are
  unchanged — the only new gate is that the email must also be on the
  admin-managed allow-list. `shresth@emergent.sh` is seeded as the first admin.
- Everything is admin-gated server-side, so the frontend checks are UX only.
