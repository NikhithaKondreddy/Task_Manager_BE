const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');

function httpRequest(method, urlString, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(urlString);
      const lib = url.protocol === 'https:' ? https : http;
      const options = {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers,
      };

      const req = lib.request(options, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsedBody = null;
          try { parsedBody = JSON.parse(text); } catch (e) { parsedBody = text; }
          resolve({ statusCode: res.statusCode, headers: res.headers, body: parsedBody });
        });
      });

      req.on('error', (err) => reject(err));
      if (body) {
        const strBody = typeof body === 'string' ? body : JSON.stringify(body);
        if (!options.headers['Content-Length'] && !options.headers['content-length']) options.headers['Content-Length'] = Buffer.byteLength(strBody);
        if (!options.headers['Content-Type'] && !options.headers['content-type']) options.headers['Content-Type'] = 'application/json';
        req.write(strBody);
      }
      req.end();
    } catch (err) { reject(err); }
  });
}

function tryParseJson(s) {
  try { return JSON.parse(s); } catch (e) { return null; }
}

(async function main() {
  try {
    const repoRoot = path.join(__dirname, '..');
    const reportsDir = path.join(repoRoot, 'reports', 'login_responses');
    if (!fs.existsSync(reportsDir)) throw new Error('reports/login_responses directory not found');

    const files = fs.readdirSync(reportsDir).filter((f) => f.endsWith('.json'));
    if (files.length === 0) throw new Error('No login response files found in reports/login_responses');

    const loginResponses = files.map((f) => {
      const raw = fs.readFileSync(path.join(reportsDir, f), 'utf8');
      return tryParseJson(raw);
    }).filter(Boolean);

    const tokens = {};
    const users = {};

    loginResponses.forEach((lr) => {
      const b = lr.response && lr.response.body;
      if (!b) return;
      const roleKey = b.roleKey || (b.user && b.user.roleKey) || (b.role ? String(b.role).toUpperCase().replace(/\s+/g, '_') : null);
      const token = b.token;
      const userId = (b.user && (b.user.id || b.userId)) || b.userId || b.user?.id || null;
      const email = b.email || (b.user && b.user.email) || null;
      if (roleKey && token) {
        tokens[roleKey] = token;
        users[roleKey] = userId || null;
      }
      if (!roleKey && email) {
        // fallback: index by email
        tokens[email] = token;
        users[email] = userId || null;
      }
    });

    const requiredRoles = ['IT_SUPPORT', 'L1_ENGINEER', 'L2_ENGINEER', 'IT_ADMIN'];
    const missing = requiredRoles.filter((r) => !tokens[r]);
    if (missing.length) {
      console.warn('Warning: missing tokens for roles:', missing);
      // continue but some steps may fail
    }

    const baseUrl = process.env.POSTMAN_BASE_URL || 'http://localhost:4000';

    console.log('Using baseUrl:', baseUrl);

    // choose actors with fallbacks
    const itSupport = tokens['IT_SUPPORT'] || tokens['it_support'] || tokens['Ashwini.m@nmit-solutions.com'];
    const l1Token = tokens['L1_ENGINEER'];
    const l2Token = tokens['L2_ENGINEER'];
    const itAdminToken = tokens['IT_ADMIN'];

    const itSupportUserId = users['IT_SUPPORT'];
    const l1UserId = users['L1_ENGINEER'];
    const l2UserId = users['L2_ENGINEER'];
    const itAdminUserId = users['IT_ADMIN'];

    if (!itSupport) throw new Error('IT_SUPPORT token not found in reports/login_responses');
    if (!l1Token) throw new Error('L1 token not found in reports/login_responses');
    if (!l2Token) throw new Error('L2 token not found in reports/login_responses');
    if (!itAdminToken) throw new Error('IT_ADMIN token not found in reports/login_responses');

    // 1) Create ticket
    console.log('Creating ticket as IT Support...');
    const createBody = {
      title: 'Postman lifecycle test',
      description: 'Ticket created by automation to test lifecycle',
      requesterEmail: 'employee+pmtest@example.com',
      priority: 'MEDIUM'
    };
    const createResp = await httpRequest('POST', `${baseUrl}/api/tickets`, { Authorization: `Bearer ${itSupport}`, 'Content-Type': 'application/json' }, createBody);
    console.log('Create status', createResp.statusCode);
    const createdTicketId = (createResp.body && (createResp.body.data && (createResp.body.data.ticket_id || createResp.body.data.ticketId || createResp.body.data.id))) || (createResp.body && createResp.body.data && createResp.body.data.ticketId) || (createResp.body && createResp.body.data && createResp.body.data.id) || null;
    if (!createdTicketId) {
      console.error('Failed to obtain created ticket id from response:', JSON.stringify(createResp.body));
      throw new Error('Ticket creation failed or response shape unexpected');
    }
    console.log('Created ticket id:', createdTicketId);

    // 2) Assign to L1
    console.log('Assigning ticket to L1:', l1UserId);
    const assignResp = await httpRequest('POST', `${baseUrl}/api/tickets/${createdTicketId}/assign`, { Authorization: `Bearer ${itSupport}`, 'Content-Type': 'application/json' }, { assignedTo: l1UserId });
    console.log('Assign status', assignResp.statusCode);

    // 3) Accept by L1
    console.log('Accepting ticket as L1...');
    const acceptResp = await httpRequest('POST', `${baseUrl}/api/tickets/${createdTicketId}/accept`, { Authorization: `Bearer ${l1Token}` }, null);
    console.log('Accept status', acceptResp.statusCode);

    // 4) Escalate by L1 to L2
    console.log('Escalating ticket to L2:', l2UserId);
    const escalateResp = await httpRequest('POST', `${baseUrl}/api/tickets/${createdTicketId}/escalate`, { Authorization: `Bearer ${l1Token}`, 'Content-Type': 'application/json' }, { escalatedTo: l2UserId, reason: 'Automated escalation for lifecycle test' });
    console.log('Escalate status', escalateResp.statusCode);

    // 5) Resolve as L2
    console.log('Resolving ticket as L2...');
    const resolveResp = await httpRequest('POST', `${baseUrl}/api/tickets/${createdTicketId}/resolve`, { Authorization: `Bearer ${l2Token}`, 'Content-Type': 'application/json' }, { resolutionNotes: 'Resolved by automation' });
    console.log('Resolve status', resolveResp.statusCode);

    // 6) Close as IT Admin
    console.log('Closing ticket as IT Admin...');
    const closeResp = await httpRequest('POST', `${baseUrl}/api/tickets/${createdTicketId}/close`, { Authorization: `Bearer ${itAdminToken}`, 'Content-Type': 'application/json' }, { feedback: 'Closed after automated resolve' });
    console.log('Close status', closeResp.statusCode);

    // Load collection
    const colPath = path.join(repoRoot, 'postman', 'IT-Ticketing-Collection.with-login-examples.json');
    if (!fs.existsSync(colPath)) throw new Error('Postman collection file not found at ' + colPath);
    const colRaw = fs.readFileSync(colPath, 'utf8');
    const col = tryParseJson(colRaw) || {};
    col.item = col.item || [];

    // Ensure variables
    col.variable = col.variable || [];
    const setVar = (key, value) => {
      const existing = col.variable.find((v) => v.key === key);
      if (existing) existing.value = value; else col.variable.push({ key, value });
    };

    setVar('baseUrl', baseUrl);
    setVar('token_it_support', itSupport);
    setVar('token_l1', l1Token);
    setVar('token_l2', l2Token);
    setVar('token_it_admin', itAdminToken);
    setVar('l1_userId', l1UserId);
    setVar('l2_userId', l2UserId);

    // Helper to build Postman response object
    function makePostmanResponse(name, requestObj, resp) {
      return {
        name: `Example: ${name}`,
        originalRequest: requestObj,
        status: resp.statusCode >= 200 && resp.statusCode < 300 ? 'OK' : 'Error',
        code: resp.statusCode,
        _postman_previewlanguage: 'json',
        header: [ { key: 'Content-Type', value: 'application/json' } ],
        body: typeof resp.body === 'string' ? resp.body : JSON.stringify(resp.body, null, 2)
      };
    }

    function makeRequestItem(name, method, rawUrl, headers = {}, body = null, resp = null) {
      const headerArray = Object.keys(headers).map((k) => ({ key: k, value: headers[k] }));
      const req = { method, header: headerArray, url: { raw: rawUrl } };
      if (body) req.body = { mode: 'raw', raw: JSON.stringify(body, null, 2) };
      const item = { name, request: req };
      if (resp) item.response = [ makePostmanResponse(name, req, resp) ];
      return item;
    }

    // append lifecycle items
    col.item.push(makeRequestItem('Lifecycle - Create Ticket', 'POST', `${baseUrl}/api/tickets`, { Authorization: `Bearer {{token_it_support}}`, 'Content-Type': 'application/json' }, createBody, createResp));
    col.item.push(makeRequestItem('Lifecycle - Assign Ticket to L1', 'POST', `${baseUrl}/api/tickets/{{created_ticket_id}}/assign`, { Authorization: `Bearer {{token_it_support}}`, 'Content-Type': 'application/json' }, { assignedTo: '{{l1_userId}}' }, assignResp));
    col.item.push(makeRequestItem('Lifecycle - L1 Accept', 'POST', `${baseUrl}/api/tickets/{{created_ticket_id}}/accept`, { Authorization: `Bearer {{token_l1}}` }, null, acceptResp));
    col.item.push(makeRequestItem('Lifecycle - L1 Escalate to L2', 'POST', `${baseUrl}/api/tickets/{{created_ticket_id}}/escalate`, { Authorization: `Bearer {{token_l1}}`, 'Content-Type': 'application/json' }, { escalatedTo: '{{l2_userId}}', reason: 'Automated escalation' }, escalateResp));
    col.item.push(makeRequestItem('Lifecycle - L2 Resolve', 'POST', `${baseUrl}/api/tickets/{{created_ticket_id}}/resolve`, { Authorization: `Bearer {{token_l2}}`, 'Content-Type': 'application/json' }, { resolutionNotes: 'Resolved by automation' }, resolveResp));
    col.item.push(makeRequestItem('Lifecycle - IT Admin Close', 'POST', `${baseUrl}/api/tickets/{{created_ticket_id}}/close`, { Authorization: `Bearer {{token_it_admin}}`, 'Content-Type': 'application/json' }, { feedback: 'Closed after automated resolve' }, closeResp));

    // Add post-request test event to the create ticket item to set collection variable created_ticket_id
    const createItem = col.item.find((it) => it.name === 'Lifecycle - Create Ticket');
    if (createItem) {
      createItem.event = [
        {
          listen: 'test',
          script: {
            type: 'text/javascript',
            exec: [
              "try {",
              "  const json = pm.response.json();",
              "  const id = json && json.data && (json.data.ticket_id || json.data.ticketId || json.data.id);",
              "  if (id) pm.collectionVariables.set('created_ticket_id', id);",
              "  pm.test('Status is 2xx', function () { pm.expect(pm.response.code).to.be.within(200, 299); });",
              "} catch (e) { pm.test('Response JSON parse', function() { pm.expect(true).to.be.false; }); }"
            ]
          }
        }
      ];
    }

    // Save collection to a new file (backup) and overwrite original
    const backupPath = colPath.replace('.json', '.with-lifecycle-backup.json');
    fs.writeFileSync(backupPath, JSON.stringify(col, null, 2));
    fs.writeFileSync(colPath, JSON.stringify(col, null, 2));

    console.log('Postman collection updated with lifecycle requests and examples at', colPath);
    console.log('Created ticket id saved as:', createdTicketId);

  } catch (err) {
    console.error('Error:', err && err.message ? err.message : err);
    process.exit(1);
  }
})();
