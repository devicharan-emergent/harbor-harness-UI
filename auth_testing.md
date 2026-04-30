# Auth-Gated App Testing Playbook

## Step 1: Create Test User & Session (Mongo)
mongosh --eval "
use('test_database');
var userId = 'test-user-' + Date.now();
var sessionToken = 'test_session_' + Date.now();
db.users.insertOne({user_id: userId, email: 'tester@example.com', name: 'Test User', created_at: new Date()});
db.user_sessions.insertOne({user_id: userId, session_token: sessionToken, expires_at: new Date(Date.now() + 7*24*60*60*1000), created_at: new Date()});
print('Session token: ' + sessionToken);"

## Step 2: curl /api/auth/me
curl -sb "session_token=$TOKEN" https://<preview>/api/auth/me

## Step 3: Playwright with cookie
page.context.add_cookies([{name:'session_token',value:TOKEN,domain:'<preview>',path:'/',httpOnly:true,secure:true,sameSite:'None'}])
