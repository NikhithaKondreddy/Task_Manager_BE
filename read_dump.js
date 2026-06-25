const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'database', 'market_task_db.sql');
const content = fs.readFileSync(filePath, 'utf8');

const matches = content.match(/CREATE TABLE `[^`]+`/g);
console.log('Tables in SQL dump:', matches);
