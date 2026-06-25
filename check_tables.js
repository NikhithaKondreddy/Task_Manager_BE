const db = require('./src/db');
db.query('SHOW TABLES', (err, rows) => {
  if (err) {
    console.error(err);
  } else {
    console.log('Tables:', rows);
  }
  process.exit(0);
});
