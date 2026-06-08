const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const srcRoot = path.join(projectRoot, 'src');
const appJs = path.join(srcRoot, 'app.js');

function read(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch (e) { return null; }
}

function ensureJs(p) {
  if (!p) return null;
  if (fs.existsSync(p)) return p;
  if (fs.existsSync(p + '.js')) return p + '.js';
  if (fs.existsSync(path.join(p, 'index.js'))) return path.join(p, 'index.js');
  return null;
}

function resolveRequirePath(arg, baseDir) {
  if (!arg) return null;
  arg = arg.trim();
  // handle __root + 'path' patterns
  const mRoot = arg.match(/__root\s*\+\s*['"]([^'"]+)['"]/);
  if (mRoot) {
    const rel = mRoot[1].replace(/^\/+/, '');
    const abs1 = path.join(projectRoot, rel);
    const abs2 = path.join(projectRoot, 'src', rel);
    return ensureJs(abs1) || ensureJs(abs2);
  }
  const mReq = arg.match(/require\(\s*['"]([^'"]+)['"]\s*\)/);
  if (mReq) {
    const reqPath = mReq[1];
    if (reqPath.startsWith('.')) {
      const abs = path.resolve(baseDir, reqPath);
      return ensureJs(abs);
    }
    // absolute-ish inside project; try both root and src
    const abs1 = path.join(projectRoot, reqPath);
    const abs2 = path.join(projectRoot, 'src', reqPath);
    return ensureJs(abs1) || ensureJs(abs2);
  }
  // plain string
  const mStr = arg.match(/['"]([^'"]+)['"]/);
  if (mStr) {
    const s = mStr[1];
    if (s.startsWith('.')) return ensureJs(path.resolve(baseDir, s));
    const abs1 = path.join(projectRoot, s);
    const abs2 = path.join(projectRoot, 'src', s);
    return ensureJs(abs1) || ensureJs(abs2);
  }
  return null;
}

function splitArgs(s) {
  const out = [];
  let cur = '', stack = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '(' || ch === '[' || ch === '{') { stack++; cur += ch; continue; }
    if (ch === ')' || ch === ']' || ch === '}') { stack--; cur += ch; continue; }
    if (ch === ',' && stack === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function parseAppUses(appText) {
  const varMap = {}; // varName -> file
  const appDir = path.dirname(appJs);

  // collect require assignments
  const requireRegex = /const\s+([^=\n]+)=\s*require\(([^)]+)\)/g;
  let m;
  // also handle destructured const { a, b } = require('...')
  const destrRegex = /const\s*\{\s*([^}]+)\}\s*=\s*require\(([^)]+)\)/g;
  while ((m = destrRegex.exec(appText))) {
    const vars = m[1].split(',').map(x => x.trim());
    const req = m[2];
    const moduleFile = resolveRequirePath(req, appDir);
    vars.forEach(v => { if (v) varMap[v] = moduleFile; });
  }

  while ((m = requireRegex.exec(appText))) {
    const left = m[1].trim();
    if (left.startsWith('{')) continue; // skip destructured already handled
    const varName = left.split(/\b/)[0].trim().replace(/[,;\s]/g, '');
    const req = m[2];
    const moduleFile = resolveRequirePath(req, appDir);
    if (varName) varMap[varName] = moduleFile;
  }

  // find app.use calls
  const uses = [];
  const useRegex = /app\.use\s*\(/g;
  let idx = 0;
  while ((m = useRegex.exec(appText))) {
    idx = m.index + m[0].length;
    // find matching closing paren
    let i = idx, depth = 1;
    for (; i < appText.length; i++) {
      const ch = appText[i];
      if (ch === '(') depth++; if (ch === ')') depth--; if (depth === 0) break;
    }
    const args = appText.slice(idx, i).trim();
    const parts = splitArgs(args);
    if (!parts || parts.length === 0) continue;
    const first = parts[0];
    // only consider if first arg is string or array
    if (!/^\s*['"\[]/.test(first)) continue;
    const last = parts[parts.length - 1];
    uses.push({ mounts: first, handler: last });
  }

  // normalize mounts and handlers
  const mappings = [];
  uses.forEach(u => {
    const mounts = [];
    const m = u.mounts.trim();
    if (m.startsWith('[')) {
      const inner = m.replace(/^\[|\]$/g, '');
      inner.split(',').forEach(s => {
        const q = s.trim().replace(/['"]/g, ''); if (q) mounts.push(q);
      });
    } else {
      mounts.push(m.replace(/['"]/g, '').trim());
    }
    mappings.push({ mounts, handler: u.handler.trim() });
  });

  // resolve handler to file and info
  const resolved = [];
  mappings.forEach(m => {
    const h = m.handler;
    let handlerInfo = { raw: h, file: null, member: null };
    // member expression e.g., auditRoutes.admin
    const mem = h.match(/^([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)$/);
    if (mem) {
      const left = mem[1], prop = mem[2];
      const moduleFile = varMap[left];
      handlerInfo.file = moduleFile;
      handlerInfo.member = prop;
    } else if (/^require\(/.test(h) || /^\(?.*require\(/.test(h)) {
      const rf = resolveRequirePath(h, appDir);
      handlerInfo.file = rf;
    } else {
      // plain var
      const plain = h.replace(/;$/, '');
      handlerInfo.file = varMap[plain] || null;
    }
    resolved.push({ mounts: m.mounts, handler: handlerInfo });
  });

  return resolved;
}

function extractRouterEndpoints(filePath, routerVarName) {
  const text = read(filePath);
  if (!text) return [];
  const endpoints = [];
  const dir = path.dirname(filePath);

  // If routerVarName not provided, try to find exported router variable
  let targetVars = [];
  if (routerVarName) targetVars.push(routerVarName);
  else {
    // try find module.exports = require('./routes/...')
    const mreq = text.match(/module\.exports\s*=\s*require\(([^)]+)\)/);
    if (mreq) {
      const rf = resolveRequirePath(mreq[1], dir);
      if (rf && rf !== filePath) return extractRouterEndpoints(rf, null);
    }

    // find module.exports = router or module.exports = { a: aRouter }
    const mex = text.match(/module\.exports\s*=\s*\{([^}]+)\}/);
    if (mex) {
      const obj = mex[1];
      const pairs = obj.split(',').map(s => s.trim()).filter(Boolean);
      pairs.forEach(p => {
        const parts = p.split(':').map(x => x.trim());
        if (parts.length === 2) {
          const varName = parts[1].replace(/[,\s]/g, '');
          targetVars.push(varName);
        }
      });
    }

    const mex2 = text.match(/module\.exports\s*=\s*([A-Za-z0-9_]+)/);
    if (mex2) {
      targetVars.push(mex2[1]);
    }
  }

  // fallback: find router variable names declared in file
  if (targetVars.length === 0) {
    const rv = text.match(/const\s+([A-Za-z0-9_]+)\s*=\s*express\.Router\(/g);
    if (rv) {
      rv.forEach(r => { const n = r.match(/const\s+([A-Za-z0-9_]+)\s*=\s*express\.Router/); if (n) targetVars.push(n[1]); });
    }
    if (targetVars.length === 0) targetVars.push('router');
  }

  const lines = text.split('\n');

  targetVars.forEach(rv => {
    const re = new RegExp(rv.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\.(get|post|put|delete|patch|options|head)\\s*\\(\\s*([`\"\'])(.*?)\\2', 'gi');
    let mm;
    while ((mm = re.exec(text))) {
      const method = mm[1].toUpperCase();
      const pathRaw = mm[3];
      endpoints.push({ method, path: pathRaw });
    }
  });

  return endpoints;
}

function buildCollection(mappings) {
  const items = [];
  mappings.forEach(map => {
    const handler = map.handler;
    let routeFile = handler.file;
    if (!routeFile) return;

    // If handler.member provided and the module file exports a property that requires another file, resolve
    if (handler.member && fs.existsSync(routeFile)) {
      const text = read(routeFile);
      // look for pattern: member: require('./routes/xyz')
      const m = text.match(new RegExp(handler.member + '\\s*:\\s*require\\(([^)]+)\\)')) || text.match(new RegExp(handler.member + '\\s*:\\s*([A-Za-z0-9_]+)'));
      if (m && m[1]) {
        const resolved = resolveRequirePath(m[1], path.dirname(routeFile));
        if (resolved) routeFile = resolved;
      }
    }

    // if routeFile exists, extract endpoints
    if (!fs.existsSync(routeFile)) return;
    const endpoints = extractRouterEndpoints(routeFile, handler.member ? null : null);
    endpoints.forEach(ep => {
      // choose first mount as base
      const base = (map.mounts && map.mounts.length) ? map.mounts[0] : '';
      // normalize path placeholders
      const fullPath = path.posix.join(base, ep.path).replace(/\\/g, '/');
      const url = '{{baseUrl}}' + (fullPath.startsWith('/') ? fullPath : '/' + fullPath);
      // replace :param with {{param}}
      const urlWithVars = url.replace(/:([A-Za-z0-9_]+)/g, '{{$1}}');
      items.push({ name: `${ep.method} ${urlWithVars}`, request: { method: ep.method, header: [], url: { raw: urlWithVars, host: ['{{baseUrl}}'], path: [] }, body: {} }, event: [] });
    });
  });
  return items;
}

function main() {
  const appText = read(appJs);
  if (!appText) { console.error('Could not read app.js'); process.exit(1); }

  const mappings = parseAppUses(appText);
  const collectionItems = buildCollection(mappings);

  const collection = {
    info: { name: 'IT Ticketing API - Auto Generated', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    item: collectionItems
  };

  const outDir = path.join(projectRoot, 'postman');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
  fs.writeFileSync(path.join(outDir, 'IT-Ticketing-Collection.auto.json'), JSON.stringify(collection, null, 2));

  const env = {
    name: 'Local',
    values: [
      { key: 'baseUrl', value: 'http://localhost:3000', enabled: true },
      { key: 'accessToken', value: '', enabled: true }
    ]
  };
  fs.writeFileSync(path.join(outDir, 'IT-Ticketing-Environment.auto.json'), JSON.stringify(env, null, 2));

  console.log('Generated Postman collection and environment at postman/');
}

main();
