const fs = require('fs');
const path = require('path');

const REPORT = path.join(__dirname, '..', 'reports', 'postman-results-auth.json');

function buildUrl(u) {
  if (!u) return '';
  const host = (u.host || []).join('.');
  const port = u.port ? `:${u.port}` : '';
  const pathParts = (u.path || []).map(p => String(p)).join('/');
  const proto = u.protocol ? `${u.protocol}://` : (u.host ? 'http://' : '');
  const query = (u.query || []).map(q => `${q.key}=${q.value}`).join('&');
  return `${proto}${host}${port}/${pathParts}${query ? '?' + query : ''}`;
}

function main() {
  if (!fs.existsSync(REPORT)) {
    console.error('Report not found:', REPORT);
    process.exit(2);
  }
  const raw = fs.readFileSync(REPORT, 'utf8');
  let json;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    console.error('Failed to parse JSON report:', err.message);
    process.exit(2);
  }

  const execs = (json.run && json.run.executions) || [];
  const totals = { total: execs.length, ok: 0 };
  const byCode = {};
  const failures = [];

  for (const e of execs) {
    const code = e.response && typeof e.response.code === 'number' ? e.response.code : null;
    if (code === null) continue;
    byCode[code] = (byCode[code] || 0) + 1;
    if (code >= 200 && code < 300) totals.ok++;
    else failures.push({
      name: e.item && e.item.name,
      method: (e.request && e.request.method) || (e.item && e.item.request && e.item.request.method) || 'GET',
      url: buildUrl((e.request && e.request.url) || (e.item && e.item.request && e.item.request.url)),
      code,
      status: e.response && e.response.status
    });
  }

  const summary = { totals, byCode, failuresCount: failures.length, failures };
  const outPath = path.join(__dirname, '..', 'reports', 'postman-failures-summary.json');
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
  console.log('Summary written to', outPath);
  console.log('Totals:', totals);
  console.log('Status codes:', byCode);
  console.log('Failures:', failures.length);
  // print first 20 failures
  failures.slice(0, 20).forEach(f => console.log(`${f.method} ${f.url} -> ${f.code} ${f.status} (${f.name})`));
}

main();
