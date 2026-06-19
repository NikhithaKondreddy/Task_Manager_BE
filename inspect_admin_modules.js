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
    
    const query = 'SELECT name, email, role, modules FROM users WHERE email = "manager@nivarahousing.com"';
    
    connection.query(query, (err, rows) => {
        if (err) {
            console.error('Error executing query:', err);
            connection.end();
            process.exit(1);
        }
        
        console.log(JSON.stringify(rows, null, 2));
        connection.end();
    });
});

