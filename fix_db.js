const db = require('./src/db');

const tables = ['chat_messages', 'project_chats', 'project_departments', 'chat_participants'];

async function run() {
  for (const table of tables) {
    console.log(`Altering table ${table}...`);
    await new Promise((resolve) => {
      db.query(`ALTER TABLE ${table} MODIFY id INT AUTO_INCREMENT`, (err, results) => {
        if (err) {
          console.error(`Failed to alter table ${table}:`, err.message);
        } else {
          console.log(`Successfully altered table ${table}`);
        }
        resolve();
      });
    });
  }
  process.exit(0);
}

run();
