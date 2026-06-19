const db = require('./src/db');
db.query('DESCRIBE users', (err, rows) => {
    if (err) {
        console.error(err);
        process.exit(1);
    }
    console.log(JSON.stringify(rows, null, 2));
    db.query('DESCRIBE engineer_mapping', (err2, rows2) => {
        if (err2) {
            console.error(err2);
            process.exit(1);
        }
        console.log("ENGINEER MAPPING:");
        console.log(JSON.stringify(rows2, null, 2));
        process.exit(0);
    });
});
