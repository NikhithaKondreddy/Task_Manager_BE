const db = require('../../../config/db');

function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (error, rows) => {
      if (error) return reject(error);
      return resolve(rows);
    });
  });
}

function getConnection() {
  return new Promise((resolve, reject) => {
    db.getConnection((error, connection) => {
      if (error) return reject(error);
      return resolve(connection);
    });
  });
}

function transactionQuery(connection, sql, params = []) {
  return new Promise((resolve, reject) => {
    connection.query(sql, params, (error, rows) => {
      if (error) return reject(error);
      return resolve(rows);
    });
  });
}

async function withTransaction(work) {
  const connection = await getConnection();
  try {
    await new Promise((resolve, reject) => connection.beginTransaction((error) => (error ? reject(error) : resolve())));
    const result = await work({
      query: (sql, params = []) => transactionQuery(connection, sql, params),
      connection,
    });
    await new Promise((resolve, reject) => connection.commit((error) => (error ? reject(error) : resolve())));
    return result;
  } catch (error) {
    try {
      await new Promise((resolve) => connection.rollback(() => resolve()));
    } catch (_) {
    }
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  query,
  withTransaction,
};
