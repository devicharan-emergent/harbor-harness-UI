# Test Credentials (ACM)

## Google Auth — seeded test session
Real Google OAuth round-trips are NOT required. A MongoDB-seeded session works end-to-end.

- **Mongo collection**: `user_sessions` (in `DB_NAME` from `/app/backend/.env`)
- **user_id** (UUID, used as `created_by`): `0ee59a27-db9c-4647-aeee-f72173fcd757`
- **email**: `TEST_pw_user@example.com`
- **session_token** (valid 7 days from 2026-04-30):
  - `pw_test_1034c53aab0f4e8d94e9ff3a692f9da5`
  - `pw_iter18_1777566255170` (backup, same user)
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
    tok = 'pw_test_1034c53aab0f4e8d94e9ff3a692f9da5'
    await db.users.update_one({'user_id': uid}, {'$set': {
        'user_id': uid, 'email': 'TEST_pw_user@example.com',
        'name': 'PW Test User', 'picture': '',
    }}, upsert=True)
    await db.user_sessions.delete_many({'session_token': tok})
    await db.user_sessions.insert_one({
        'user_id': uid, 'session_token': tok,
        'expires_at': datetime.now(timezone.utc) + timedelta(days=7),
        'created_at': datetime.now(timezone.utc),
    })

asyncio.run(seed())
```
