const fs = require('fs');
const path = require('path');

const collPath = path.join(__dirname, '..', 'postman', 'IT-Ticketing-Collection.auto.json');
const outPath = path.join(__dirname, '..', 'postman', 'IT-Ticketing-Collection.postman.json');

function read(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; } }
const coll = read(collPath);
if (!coll) { console.error('collection not found'); process.exit(1); }

function processItem(item) {
  if (!item.request) return;
  if (!Array.isArray(item.request.header)) item.request.header = [];
  // add Authorization header
  const hasAuth = item.request.header.some(h => String(h.key || h.name || '').toLowerCase() === 'authorization');
  if (!hasAuth) item.request.header.push({ key: 'Authorization', value: 'Bearer {{accessToken}}' });
  const method = (item.request.method || 'GET').toUpperCase();
  if (['POST','PUT','PATCH'].includes(method)) {
    const hasCt = item.request.header.some(h => String(h.key || h.name || '').toLowerCase() === 'content-type');
    if (!hasCt) item.request.header.push({ key: 'Content-Type', value: 'application/json' });
    if (!item.request.body || Object.keys(item.request.body).length === 0) {
      item.request.body = { mode: 'raw', raw: '{}' };
    }
  }

  // if this is login endpoint, add a test script to store token
  // normalize URL: keep raw only to avoid host/path resolution issues
  try {
    if (item.request.url && item.request.url.raw) {
      const raw = item.request.url.raw;
      item.request.url = { raw };
      // if login endpoint, add test script
      if (raw.includes('/api/auth/login')) {
        item.event = item.event || [];
        const script = {
          listen: 'test',
          script: {
            exec: [
              "try {",
              "  var json = pm.response.json();",
              "  if (json && json.token) pm.environment.set('accessToken', json.token);",
              "  if (json && json.tenantId) pm.environment.set('tenantId', json.tenantId);",
              "  if (json && json.userId) pm.environment.set('userId', json.userId);",
              "} catch(e) { }"
            ]
          }
        };
        item.event.push(script);
      }
    }
  } catch (e) { }
}

function walk(items) {
  items.forEach(it => {
    processItem(it);
    if (it.item && Array.isArray(it.item)) walk(it.item);
  });
}

walk(coll.item || []);
fs.writeFileSync(outPath, JSON.stringify(coll, null, 2));
console.log('Wrote processed collection to', outPath);
