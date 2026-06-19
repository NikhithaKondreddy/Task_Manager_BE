// Wrapper to load .env from this folder before starting the app
const path = require('path');
const dotenv = require('dotenv');

const envPath = path.resolve(__dirname, '.env');
dotenv.config({ path: envPath });

// Delegate to the main entrypoint
require('./index.js');
