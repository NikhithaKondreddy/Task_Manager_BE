const fs = require('fs');
const path = require('path');
const axios = require('axios');

const envPath = path.join(__dirname, '..', 'postman', 'IT-Ticketing-Environment.auto.json');
const env = JSON.parse(fs.readFileSync(envPath, 'utf8'));
const baseUrl = (env.values.find(v => v.key === 'baseUrl') || {}).value || 'http://localhost:3000';

const email = process.argv[2] || 'test.admin@example.com';
const password = process.argv[3] || 'Password123!';

async function main() {
  try {
    const res = await axios.post(`${baseUrl}/api/auth/login`, { email, password }, { headers: { 'Content-Type': 'application/json' } });
    if (res && res.data && res.data.token) {
      const token = res.data.token;
      const val = env.values.find(v => v.key === 'accessToken');
      if (val) val.value = token; else env.values.push({ key: 'accessToken', value: token });
      fs.writeFileSync(envPath, JSON.stringify(env, null, 2));
      console.log('Saved accessToken to environment');
      process.exit(0);
    }
    console.error('Login did not return token', res && res.data);
    process.exit(2);
  } catch (e) {
    console.error('Login failed:', e && e.message);
    process.exit(1);
  }
}

main();
