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

## Admin role (added 2026-06-30 for Eval Credits verification)
The seeded test user (`user_id 0ee59a27-db9c-4647-aeee-f72173fcd757`) has `role: 'admin'`
set on its `users` doc so the admin-only "Eval credits" indicator renders.
`/auth/me` returns the full user doc, so `role` flows through automatically.
NOTE: `/api/credits` is NOT implemented in this repo's backend — the backend team
provides it. With role=admin but no `/api/credits`, the indicator shows "unavailable"
(graceful). To re-add the role if the user doc is reset:
`db.users.update_one({'user_id':'0ee59a27-db9c-4647-aeee-f72173fcd757'},{'$set':{'role':'admin'}})`
