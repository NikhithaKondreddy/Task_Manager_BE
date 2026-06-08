const db = require('./src/db');

db.query(`ALTER TABLE tickets MODIFY COLUMN status ENUM('New', 'Open', 'In Progress', 'Closed') NOT NULL DEFAULT 'New'`, (err) => {
  if (err) console.error(err);
  else console.log('Status enum updated');
  process.exit(0);
});