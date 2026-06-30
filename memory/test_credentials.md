# Test Credentials (ACM)

## ⚠️ Email Allow-List Gate (Feb 2026 — fork)
The backend now restricts authentication to email addresses whose domain
begins with the literal string `emergent` (i.e. `@emergent.sh`, `@emergent.com`,
`@emergentagent.com`, `@emergent.dev`, `@emergent-internal.io`, etc.).
Any other domain — including the old `@example.com` test account — is
rejected with HTTP 403 `{"error":"email_not_allowed", ...}` at `/auth/session`,
and any pre-existing session whose user's email no longer matches is
auto-deleted at the next `/auth/me` (returns 401).

## Google Auth — seeded test session (Emergent-compatible)
Real Google OAuth round-trips are NOT required. A MongoDB-seeded session works end-to-end.

- **Mongo collection**: `user_sessions` (in `DB_NAME` from `/app/backend/.env`)
- **user_id** (UUID, used as `created_by`): `0ee59a27-db9c-4647-aeee-f72173fcd757`
- **email**: `TEST_pw_user@emergent.com`   ← updated to satisfy the allow-list
- **session_token** (valid 7 days from 2026-06-08):
  - `pw_emergent_gate_post` ← latest, gate-compatible
  - ~~`pw_iter_fork_fresh`~~ (still in DB but the user row is now @emergent.com so the token still works after the re-seed)
  - ~~`pw_iter19_20260430`~~ (older — may or may not be in DB)
- **Frontend**: set `localStorage.setItem('acm_session_token', '<token>')` before navigating. The auth interceptor adds `?access_token=<token>` to every `/api/auth/*` call.
- **Backend** (`_get_session_user` in `server.py`): accepts any of — `session_token` cookie, `Authorization: Bearer <token>`, or `?access_token=<token>` query param.

## Re-seeding if sessions are wiped
```python
from motor.motor_asyncio import AsyncIOMotorClient
import os, asyncio
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv
load_dotenv('/app/backend/.env')

async def seed():
    c = AsyncIOMotorClient(os.environ['MONGO_URL'])
    db = c[os.environ['DB_NAME']]
    uid = '0ee59a27-db9c-4647-aeee-f72173fcd757'
    tok = 'pw_emergent_gate_post'
    # IMPORTANT: email must satisfy the @emergent* allow-list or auth gates 401/403.
    await db.users.update_one({'user_id': uid}, {'$set': {
        'user_id': uid, 'email': 'TEST_pw_user@emergent.com',
        'name': 'PW Test User (Emergent)', 'picture': '',
    }}, upsert=True)
    await db.user_sessions.delete_many({'session_token': tok})
    await db.user_sessions.insert_one({
        'user_id': uid, 'session_token': tok,
        'expires_at': datetime.now(timezone.utc) + timedelta(days=7),
        'created_at': datetime.now(timezone.utc),
    })

asyncio.run(seed())
```

## Admin allowlist + roles + credits (added 2026-06-30 — ported from PR #6)
The backend now enforces an **admin-managed allowlist**: login requires an
`@emergent*` domain AND an ACTIVE row in the `allowlist` collection. Roles:
`admin` (manage allowlist) | `member`. `/auth/me` and `/auth/session` return `role`.
- `SEED_ADMIN_EMAILS` (default `shresth@emergent.sh`) is seeded as admin on startup.
- For PREVIEW, all pre-existing users + `test_pw_user@emergent.com` were seeded into
  the allowlist as **admin** so nobody is locked out and the dashboard is testable.
- Admin API: `GET/POST/PATCH/DELETE /api/admin/users` (admin-gated). `/api/credits`
  is admin-gated and now returns REAL data from the harness.
Re-seed everyone as admin if the allowlist is reset:
```
for e in <emails>: db.allowlist.update_one({'email':e},{'$set':{'role':'admin','active':True}}, upsert=True)
```
Test session user (token `pw_emergent_gate_post`) = `TEST_pw_user@emergent.com`, role admin.
