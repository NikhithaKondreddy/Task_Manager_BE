const mysql = require('mysql');
const env = require('./env');
const logger = require('../logger');

const dbConfig = {
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    multipleStatements: false,
    connectionLimit: env.NODE_ENV === 'production' ? 20 : 15,
    waitForConnections: true,
    acquireTimeout: 20000, // ms
    connectTimeout: 10000, // ms
    timeout: 10000, // ms - additional timeout for handshake
    queueLimit: 100,
    enableKeepAlive: true,
    charset: 'utf8mb4'
};

const pool = mysql.createPool(dbConfig);

// Keep connection logs quiet in production; debug-level retained for troubleshooting.
pool.on('connection', function (connection) {
    if (env && env.NODE_ENV === 'production') {
        if (logger && typeof logger.debug === 'function') logger.debug('DB connection established');
    } else {
        logger.info(`DB connected (threadId=${connection.threadId})`);
    }
});

pool.on('error', function (err) {
    logger.error('MySQL pool error: ' + (err && err.message));
});

pool.getConnection((err, connection) => {
    if (err) {
        if (err.code === 'PROTOCOL_CONNECTION_LOST') logger.error('Database connection was closed.');
        if (err.code === 'ER_CON_COUNT_ERROR') logger.error('Database has too many connections.');
        if (err.code === 'ECONNREFUSED') logger.error('Database connection was refused.');
        logger.warn('Initial DB connection failed; continuing — will retry on first query.');
    }
    if (connection) {
        const cleanupTenants = (callback) => {
            connection.query("SHOW TABLES LIKE 'tenants'", (showErr, showRows) => {
                if (showErr || !showRows || showRows.length === 0) {
                    return callback();
                }
                connection.query("SELECT COUNT(1) AS total, COUNT(DISTINCT id) AS distinct_ids FROM tenants", (err, rows) => {
                    if (err || !rows || !rows[0] || rows[0].total <= rows[0].distinct_ids) {
                        return callback();
                    }
                    logger.info(`DB: Duplicates found in tenants table (${rows[0].total} total, ${rows[0].distinct_ids} distinct). Running cleanup...`);
                    connection.query("SET FOREIGN_KEY_CHECKS = 0", () => {
                        connection.query(`CREATE TABLE IF NOT EXISTS tenants_clean (
                          id INT NOT NULL,
                          public_id VARCHAR(64) NOT NULL,
                          name VARCHAR(255) NOT NULL,
                          slug VARCHAR(255) NULL,
                          domain VARCHAR(255) NULL,
                          is_active TINYINT(1) NOT NULL DEFAULT 1,
                          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`, () => {
                            connection.query(`INSERT INTO tenants_clean (id, public_id, name, slug, domain, is_active, created_at, updated_at)
                              SELECT id, public_id, name, slug, domain, is_active, MIN(created_at), MIN(updated_at)
                              FROM tenants
                              GROUP BY id, public_id, name, slug, domain, is_active`, () => {
                                connection.query("DROP TABLE tenants", () => {
                                    connection.query(`CREATE TABLE tenants (
                                      id INT AUTO_INCREMENT PRIMARY KEY,
                                      public_id VARCHAR(64) NOT NULL,
                                      name VARCHAR(255) NOT NULL,
                                      slug VARCHAR(255) NULL,
                                      domain VARCHAR(255) NULL,
                                      is_active TINYINT(1) NOT NULL DEFAULT 1,
                                      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                                      UNIQUE KEY uniq_tenants_public_id (public_id),
                                      UNIQUE KEY uniq_tenants_slug (slug)
                                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`, () => {
                                        connection.query(`INSERT INTO tenants (id, public_id, name, slug, domain, is_active, created_at, updated_at)
                                          SELECT id, public_id, name, slug, domain, is_active, created_at, updated_at
                                          FROM tenants_clean`, () => {
                                            connection.query("DROP TABLE tenants_clean", () => {
                                                connection.query("TRUNCATE TABLE branches", () => {
                                                    connection.query("TRUNCATE TABLE clusters", () => {
                                                        connection.query("TRUNCATE TABLE regions", () => {
                                                            connection.query("TRUNCATE TABLE states", () => {
                                                                connection.query("SET FOREIGN_KEY_CHECKS = 1", () => {
                                                                    logger.info("DB: Tenants and locations tables cleaned up successfully!");
                                                                    callback();
                                                                });
                                                            });
                                                        });
                                                    });
                                                });
                                            });
                                        });
                                    });
                                });
                            });
                        });
                    });
                });
            });
        };

        // Ensure platform_settings table exists
        connection.query(`
            CREATE TABLE IF NOT EXISTS platform_settings (
                id INT AUTO_INCREMENT PRIMARY KEY,
                setting_key VARCHAR(50) UNIQUE NOT NULL,
                setting_value TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            );
        `, (tableErr) => {
            if (tableErr) logger.error('Error creating platform_settings table: ' + tableErr.message);
            cleanupTenants(() => {
                connection.release();
            });
        });
    }
});


function endPool(cb) {
    try {
        pool.end(err => {
            if (err) logger.error('Error closing DB pool: ' + (err && err.message));
            else logger.info('DB pool closed');
            if (typeof cb === 'function') cb(err);
        });
    } catch (e) {
        logger.error('Failed to end DB pool: ' + (e && e.message));
        if (typeof cb === 'function') cb(e);
    }
}

module.exports = pool;

// --- Global SQL Error Interceptor ---
// Wraps pool.query to aggressively log failing queries
const originalQuery = pool.query;
pool.query = function () {
    const sqlArgs = Array.from(arguments);
    const lastArgIndex = sqlArgs.length - 1;
    let callback = sqlArgs[lastArgIndex];

    if (typeof callback === 'function') {
        sqlArgs[lastArgIndex] = function (err, results, fields) {
            if (err) {
                const queryStr = typeof sqlArgs[0] === 'string' ? sqlArgs[0] : (sqlArgs[0] && sqlArgs[0].sql) || 'Unknown Query';
                const queryValues = typeof sqlArgs[0] === 'object' && sqlArgs[0].values ? sqlArgs[0].values : (Array.isArray(sqlArgs[1]) ? sqlArgs[1] : []);
                logger.error(`[DB ERROR] Query Failed: ${err.message}`);
                logger.error(`[DB ERROR] SQL: ${queryStr}`);
                logger.error(`[DB ERROR] Values: ${JSON.stringify(queryValues)}`);
            }
            callback(err, results, fields);
        };
    } else {
        // Handle promise wrap cases or missing callbacks by providing a default one that logs
        const origQuery = typeof sqlArgs[0] === 'string' ? sqlArgs[0] : (sqlArgs[0] && sqlArgs[0].sql) || 'Unknown Query';
        const origValues = typeof sqlArgs[0] === 'object' && sqlArgs[0].values ? sqlArgs[0].values : (Array.isArray(sqlArgs[1]) ? sqlArgs[1] : []);
        sqlArgs.push(function (err, results, fields) {
            if (err) {
                logger.error(`[DB ERROR] Unhandled Query Failed: ${err.message}`);
                logger.error(`[DB ERROR] SQL: ${origQuery}`);
                logger.error(`[DB ERROR] Values: ${JSON.stringify(origValues)}`);
            }
        });
    }

    return originalQuery.apply(pool, sqlArgs);
};

// Also wrap connection.query obtained from pool.getConnection for transactions
const originalGetConnection = pool.getConnection;
pool.getConnection = function (cb) {
    return originalGetConnection.call(pool, function (err, connection) {
        if (err || !connection) return cb(err, connection);

        if (!connection.__isWrapped) {
            const origConnQuery = connection.query;
            connection.query = function () {
                const connArgs = Array.from(arguments);
                const lastConnArgIndex = connArgs.length - 1;
                let connCallback = connArgs[lastConnArgIndex];

                if (typeof connCallback === 'function') {
                    connArgs[lastConnArgIndex] = function (qErr, results, fields) {
                        if (qErr) {
                            const queryStr = typeof connArgs[0] === 'string' ? connArgs[0] : (connArgs[0] && connArgs[0].sql) || 'Unknown Query';
                            const queryValues = typeof connArgs[0] === 'object' && connArgs[0].values ? connArgs[0].values : (Array.isArray(connArgs[1]) ? connArgs[1] : []);
                            logger.error(`[DB ERROR] Conn Query Failed: ${qErr.message}`);
                            logger.error(`[DB ERROR] SQL: ${queryStr}`);
                            logger.error(`[DB ERROR] Values: ${JSON.stringify(queryValues)}`);
                        }
                        connCallback(qErr, results, fields);
                    };
                }
                return origConnQuery.apply(connection, connArgs);
            };
            connection.__isWrapped = true;
        }
        cb(null, connection);
    });
};
// ------------------------------------

module.exports.end = endPool;
