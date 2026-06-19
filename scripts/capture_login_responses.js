const http = require('http');
const fs = require('fs');
const path = require('path');

const outDir = path.resolve(__dirname, '..', 'reports', 'login_responses');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

function postJson(payload) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(payload);
    const options = {
      hostname: 'localhost',
      port: 4000,
      path: '/api/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 30000
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ statusCode: res.statusCode, body: parsed });
        } catch (e) {
          resolve({ statusCode: res.statusCode, body: body });
        }
      });
    });

    req.on('error', (e) => reject(e));
    req.on('timeout', () => { req.destroy(new Error('Request timeout')); });
    req.write(postData);
    req.end();
  });
}

async function main() {
  const users = [
    { email: 'n11443547@gmail.com', password: 'ITAdmin@123' },
    { email: 'nikhithakondreddygari@nmit-solutions.com', password: 'L1Engineer@123' },
    { email: 'Ashwini.m@nmit-solutions.com', password: 'ITSupport@123' },
    { email: 'ashhoney959@gmail.com', password: 'ClusterLead@123' },
    { email: 'ashwinisubba25@gmail.com', password: 'ITSupport@123' }
  ];

  for (const u of users) {
    try {
      const resp = await postJson({ email: u.email, password: u.password });
      const safeName = u.email.replace(/[^a-z0-9._-]/gi, '_');
      const outPath = path.join(outDir, `${safeName}.json`);
      fs.writeFileSync(outPath, JSON.stringify({ request: { email: u.email }, response: resp }, null, 2));
      console.log(`Saved login response for ${u.email} -> ${outPath}`);
    } catch (e) {
      console.error(`Failed to capture login for ${u.email}:`, e.message || e);
    }
  }
}

main().then(() => process.exit(0)).catch(() => process.exit(1));
