require('dotenv').config();
const path = require('path');
const root = path.join(__dirname, '..');

(async () => {
  try {
    // Attempt to require the project's DB pool
    let pool;
    try {
      pool = require(path.join(root, 'src', 'config', 'db.js'));
    } catch (e) {
      console.error('Failed to require DB pool:', e.message || e);
      process.exit(2);
    }

    // Run a simple SELECT
    pool.query('SELECT 1 AS ok', (err, rows) => {
      if (err) {
        console.error('DB query failed:', err && err.message ? err.message : err);
        try { if (typeof pool.end === 'function') pool.end(() => process.exit(3)); else process.exit(3); } catch (e) { process.exit(3); }
        return;
      }
      console.log('DB OK:', rows);
      try { if (typeof pool.end === 'function') pool.end(() => process.exit(0)); else process.exit(0); } catch (e) { process.exit(0); }
    });
  } catch (error) {
    console.error('Smoke test error:', error && error.stack ? error.stack : error);
    process.exit(1);
  }
})();
