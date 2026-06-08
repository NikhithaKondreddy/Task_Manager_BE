require('dotenv').config();
const axios = require('axios');

const email = process.argv[2] || 'test.admin@example.com';
const password = process.argv[3] || 'Password123!';
const baseUrl = process.env.BASE_URL || process.env.APP_URL || 'http://localhost:4000';

async function main() {
  try {
    console.log('Logging in as', email);
    const login = await axios.post(`${baseUrl}/api/auth/login`, { email, password }, { timeout: 15000 });
    if (!login || !login.data || !login.data.token) throw new Error('Login failed or token missing');
    const token = login.data.token;
    const tenantHeader = login.data.tenantId || login.headers['x-tenant-id'] || null;
    console.log('Received token, tenant:', tenantHeader || '(none)');

    const headers = { Authorization: 'Bearer ' + token };
    if (tenantHeader) headers['x-tenant-id'] = tenantHeader;

    // Create ticket
    console.log('Creating ticket...');
    const ticketBody = {
      subject: 'Automated test ticket',
      description: 'Created by scripts/test-ticketing-api.js',
      priority: 'MEDIUM'
    };
    const create = await axios.post(`${baseUrl}/api/tickets`, ticketBody, { headers });
    console.log('Create response status:', create.status);
    if (!create.data || !create.data.data) {
      console.error('Unexpected create response:', create.data);
      process.exit(2);
    }
    const ticket = create.data.data;
    console.log('Ticket created:', ticket.ticketId || ticket.id || ticket.ticket_id);

    const ticketId = ticket.ticketId || ticket.id || ticket.ticket_id;
    if (!ticketId) {
      console.error('Could not extract ticket id');
      process.exit(2);
    }

    // Add comment
    console.log('Adding comment to', ticketId);
    const comment = await axios.post(`${baseUrl}/api/tickets/${ticketId}/comments`, { body: 'Automated test comment' }, { headers });
    console.log('Add comment status:', comment.status);
    console.log('Comment response:', comment.data && comment.data.message);

    // Fetch ticket
    console.log('Fetching ticket', ticketId);
    const fetched = await axios.get(`${baseUrl}/api/tickets/${ticketId}`, { headers });
    console.log('Fetched ticket summary:', fetched.data && fetched.data.data ? { id: fetched.data.data.ticketId || fetched.data.data.id, comments: (fetched.data.data.comments || []).length } : fetched.data);

    console.log('Smoke test completed successfully');
    process.exit(0);
  } catch (e) {
    console.error('Test failed:', e.response ? e.response.data : e.message);
    process.exit(1);
  }
}

main();
