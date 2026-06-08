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
    
    const queries = [
        'DESCRIBE admin_modules',
        'SHOW CREATE TABLE admin_modules',
        'SHOW CREATE TABLE users'
    ];
    
    let results = {};
    
    connection.query(queries.join(';'), (err, rows) => {
        if (err) {
            console.error('Error executing queries:', err);
            connection.end();
            process.exit(1);
        }
        
        results.describe_admin_modules = rows[0];
        results.create_table_admin_modules = rows[1];
        results.create_table_users = rows[2];
        
        console.log(JSON.stringify(results, null, 2));
        connection.end();
    });
});
