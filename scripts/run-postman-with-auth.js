#!/usr/bin/env node
require('dotenv').config();
const axios = require('axios');
const { exec } = require('child_process');
const path = require('path');

const baseUrl = process.env.BASE_URL || process.env.APP_URL || 'http://localhost:4000';
const email = process.argv[2] || 'test.admin@example.com';
const password = process.argv[3] || 'Password123!';
const collectionPath = path.join(__dirname, '..', 'postman', 'IT-Ticketing-System.postman_collection.json');
const envPath = path.join(__dirname, '..', 'postman', 'IT-Ticketing-System.local.postman_environment.json');
const outReport = path.join(__dirname, '..', 'reports', 'postman-results-auth.json');

async function login() {
  try {
    const res = await axios.post(`${baseUrl}/api/auth/login`, { email, password }, { timeout: 15000 });
    if (!res || !res.data || !res.data.token) throw new Error('Login failed or token missing');
    return { token: res.data.token, tenantId: res.data.tenantId || null };
  } catch (e) {
    console.error('Login failed:', e.response ? e.response.data : e.message);
    process.exit(2);
  }
}

async function runNewman(token, tenantId) {
  try {
    if (!(require('fs').existsSync(path.join(__dirname, '..', 'reports')))) {
      require('fs').mkdirSync(path.join(__dirname, '..', 'reports'));
    }
    const envVarToken = `token=${token}`;
    const envVarTenant = tenantId ? `tenantId=${tenantId}` : '';
    const cmd = `npx newman run "${collectionPath}" -e "${envPath}" --env-var ${envVarToken} ${envVarTenant} -r json --reporter-json-export "${outReport}"`;
    console.log('Running Newman with token...');
    const child = exec(cmd, { maxBuffer: 1024 * 1024 * 10 }, (err, stdout, stderr) => {
      if (err) {
        console.error('Newman run failed:', err && err.message);
        console.error(stderr || stdout);
        process.exit(3);
      }
      console.log(stdout);
      console.log('Newman run completed. Report:', outReport);
    });
    child.stdout.pipe(process.stdout);
    child.stderr.pipe(process.stderr);
  } catch (e) {
    console.error('Failed to run newman:', e && e.message);
    process.exit(4);
  }
}

(async () => {
  const { token, tenantId } = await login();
  console.log('Obtained token, tenantId:', tenantId || '(none)');
  await runNewman(token, tenantId);
})();
