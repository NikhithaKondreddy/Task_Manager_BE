// Lightweight starter to force an alternate PORT for local testing
require('dotenv').config();
const path = require('path');

const forcedPort = process.argv[2] || process.env.FORCE_PORT || '5002';
process.env.PORT = forcedPort;

console.log('Starting local server with PORT=' + process.env.PORT);

// Require the main index which will start the server
require(path.join(__dirname, '..', 'index.js'));
