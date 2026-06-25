const db = require('./src/config/db');

function q(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
  });
}

async function run() {
  try {
    console.log("=== DB AUDIT RUN ===");

    // 1. Check indexes on tasks table
    const taskIndexes = await q("SHOW INDEX FROM tasks");
    console.log("\n--- 'tasks' Table Indexes ---");
    taskIndexes.forEach(idx => {
      console.log(`- Index Name: ${idx.Key_name} | Column: ${idx.Column_name} | Unique: ${idx.Non_unique === 0}`);
    });

    // 2. Check indexes on files table
    const fileIndexes = await q("SHOW INDEX FROM files");
    console.log("\n--- 'files' Table Indexes ---");
    fileIndexes.forEach(idx => {
      console.log(`- Index Name: ${idx.Key_name} | Column: ${idx.Column_name} | Unique: ${idx.Non_unique === 0}`);
    });

    // 3. Get task count by status
    const counts = await q("SELECT status, COUNT(*) as count FROM tasks GROUP BY status");
    console.log("\n--- Task Status Distribution ---");
    counts.forEach(row => {
      console.log(`- Status: ${row.status} | Count: ${row.count}`);
    });

    // 4. Get total tasks count
    const [totalRow] = await q("SELECT COUNT(*) as total FROM tasks");
    console.log(`\n- Total Tasks: ${totalRow.total}`);

    process.exit(0);
  } catch (err) {
    console.error("Audit failed:", err.message);
    process.exit(1);
  }
}

run();
