const db = require('./src/config/db');

const createTableSql = `
CREATE TABLE IF NOT EXISTS platform_settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    setting_key VARCHAR(50) UNIQUE NOT NULL,
    setting_value TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
`;

const insertDefaultLogoSql = `
INSERT IGNORE INTO platform_settings (setting_key, setting_value) 
VALUES ('logo_url', '/public/logo.png');
`;

db.query(createTableSql, (err) => {
    if (err) {
        console.error('Error creating platform_settings table:', err);
        process.exit(1);
    }
    console.log('platform_settings table created or already exists.');
    
    db.query(insertDefaultLogoSql, (err) => {
        if (err) {
            console.error('Error inserting default logo:', err);
            process.exit(1);
        }
        console.log('Default logo setting inserted.');
        process.exit(0);
    });
});
