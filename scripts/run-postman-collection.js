const fs = require('fs');
const path = require('path');
const axios = require('axios');

const collPath = path.join(__dirname, '..', 'postman', 'IT-Ticketing-Collection.postman.json');
const envPath = path.join(__dirname, '..', 'postman', 'IT-Ticketing-Environment.auto.json');
const outPath = path.join(__dirname, '..', 'postman', 'collection-run-report.json');

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
const coll = readJson(collPath);
const env = readJson(envPath);
const envMap = {};
for (const v of (env.values || [])) envMap[v.key] = v.value;

function replaceVars(s) {
  if (typeof s !== 'string') return s;
  return s.replace(/{{([^}]+)}}/g, (_, k) => (envMap[k] !== undefined ? envMap[k] : `{{${k}}}`));
}

async function runItem(item) {
  const result = { name: item.name || '', ok: false, error: null, status: null, duration: 0, request: {}, response: null };
  try {
    if (!item.request || !item.request.url || !item.request.url.raw) {
      result.error = 'no url';
      return result;
    }
    const url = replaceVars(item.request.url.raw);
    const method = (item.request.method || 'GET').toUpperCase();
    const headers = {};
    for (const h of (item.request.header || [])) {
      const key = h.key || h.name || '';
      const val = replaceVars(h.value || h.value || '');
      if (key) headers[key] = val;
    }
    let data = null;
    if (item.request.body && item.request.body.mode === 'raw') {
      data = replaceVars(item.request.body.raw || '');
      try { JSON.parse(data); } catch (e) { }
    }

    result.request = { url, method, headers, data };
    const start = Date.now();
    const axiosRes = await axios({ url, method, headers, data, validateStatus: () => true, timeout: 60000 });
    result.duration = Date.now() - start;
    result.status = axiosRes.status;
    result.response = { headers: axiosRes.headers, data: axiosRes.data };    
    result.ok = axiosRes.status >= 200 && axiosRes.status < 400;
    return result;
  } catch (e) {
    result.error = e && e.message ? e.message : String(e);
    return result;
  }
}

async function runAll() {
  const items = coll.item || [];
  const results = [];
  for (const it of items) {
    process.stdout.write(`Running: ${it.name}\n`);
    const r = await runItem(it);
    results.push(r);
  }
  const summary = { total: results.length, passed: results.filter(r=>r.ok).length, failed: results.filter(r=>!r.ok).length };
  const out = { summary, results };
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log('Run complete. Report:', outPath);
}

runAll();
