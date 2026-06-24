const db = require('./src/db');
db.query('SELECT email, role FROM users WHERE tenant_id = 1', (err, rows) => {
    if (err) { console.error(err); process.exit(1); }
    console.log(JSON.stringify(rows, null, 2));
    process.exit(0);
});