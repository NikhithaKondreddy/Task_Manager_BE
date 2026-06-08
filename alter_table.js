const db = require('./src/db');

db.query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS module VARCHAR(100) DEFAULT 'general' AFTER assigned_queue`, (err) => {
  if (err) console.error(err);
  else console.log('Module column added');
  db.query(`ALTER TABLE tickets ADD INDEX IF NOT EXISTS idx_tickets_module (module)`, (err2) => {
    if (err2) console.error(err2);
    else console.log('Index added');
    process.exit(0);
  });
});