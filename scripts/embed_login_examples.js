const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const collectionPath = path.join(projectRoot, 'postman', 'IT-Ticketing-Collection.auto.json');
const responsesDir = path.join(projectRoot, 'reports', 'login_responses');
const outPath = path.join(projectRoot, 'postman', 'IT-Ticketing-Collection.with-login-examples.json');

function safeReadJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
}

const coll = safeReadJson(collectionPath);
if (!coll) {
  console.error('Could not read collection at', collectionPath); process.exit(1);
}

const loginItem = (coll.item || []).find(it => it.request && it.request.method === 'POST' && String(it.request.url && it.request.url.raw || '').includes('/api/auth/login'));
if (!loginItem) {
  console.error('Login request not found in collection'); process.exit(1);
}

const files = fs.existsSync(responsesDir) ? fs.readdirSync(responsesDir) : [];
const examples = [];
for (const f of files) {
  const p = path.join(responsesDir, f);
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    const resp = parsed.response || parsed || {};
    const statusCode = resp && resp.statusCode ? resp.statusCode : (resp && resp.body && resp.body.success ? 200 : 200);
    const name = `Login example: ${parsed.request && parsed.request.email ? parsed.request.email : f}`;
    examples.push({
      name,
      originalRequest: loginItem.request,
      status: statusCode === 200 ? 'OK' : 'Response',
      code: statusCode,
      _postman_previewlanguage: 'json',
      header: [{ key: 'Content-Type', value: 'application/json' }],
      body: JSON.stringify(resp.body || resp, null, 2)
    });
  } catch (e) {
    console.warn('Skipping', f, e.message || e);
  }
}

loginItem.response = examples;
fs.writeFileSync(outPath, JSON.stringify(coll, null, 2));
console.log('Wrote collection with embedded login examples to', outPath);
