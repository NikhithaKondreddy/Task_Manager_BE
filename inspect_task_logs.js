const mysql = require('mysql');
const env = require('./src/config/env');

const dbConfig = {
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    multipleStatements: true
};

const connection = mysql.createConnection(dbConfig);

connection.connect(err => {
    if (err) {
        console.error('Error connecting to DB:', err);
        process.exit(1);
    }
    
    connection.query('SELECT ta.task_id, ta.type, ta.activity, ta.createdAt AS createdAt FROM task_logs ta LIMIT 1', (err, rows) => {
        if (err) {
            console.error('Error executing query:', err);
        } else {
            console.log('Query succeeded!', rows);
        }
        connection.end();
    });
});
