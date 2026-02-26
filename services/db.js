/**
 * MSSQL Connection Pool Service
 * Read-only database access for FCMCS Mobile Financial Portal
 */

const sql = require('mssql');
require('dotenv').config();

const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    database: process.env.DB_NAME,
    port: parseInt(process.env.DB_PORT, 10) || 1433,
    options: {
        encrypt: process.env.DB_ENCRYPT === 'true',
        trustServerCertificate: process.env.DB_TRUST_CERT === 'true',
        enableArithAbort: true,
        connectionTimeout: 30000,
        requestTimeout: 30000
    },
    pool: {
        max: parseInt(process.env.DB_POOL_MAX, 10) || 10,
        min: parseInt(process.env.DB_POOL_MIN, 10) || 0,
        idleTimeoutMillis: 30000,
        acquireTimeoutMillis: 30000
    }
};

let pool = null;

/**
 * Get or create database connection pool
 * @returns {Promise<sql.ConnectionPool>}
 */
const getPool = async () => {
    if (pool && pool.connected) {
        return pool;
    }

    try {
        pool = await sql.connect(dbConfig);
        console.log('✅ MSSQL connection pool established');
        
        // Handle pool errors
        pool.on('error', (err) => {
            console.error('❌ MSSQL pool error:', err);
            pool = null;
        });
        
        return pool;
    } catch (err) {
        console.error('❌ MSSQL connection failed:', err.message);
        pool = null;
        throw err;
    }
};

/**
 * Close the database connection pool
 */
const closePool = async () => {
    if (pool) {
        try {
            await pool.close();
            pool = null;
            console.log('✅ MSSQL connection pool closed');
        } catch (err) {
            console.error('❌ Error closing MSSQL pool:', err.message);
        }
    }
};

/**
 * Execute a read-only query with parameterized inputs
 * @param {string} query - SQL query string
 * @param {Object} params - Object with parameter names and values
 * @returns {Promise<sql.IResult>}
 */
const executeQuery = async (query, params = {}) => {
    const poolConnection = await getPool();
    const request = poolConnection.request();
    
    // Add parameters safely to prevent SQL injection
    for (const [key, value] of Object.entries(params)) {
        request.input(key, value);
    }
    
    return request.query(query);
};

module.exports = {
    getPool,
    closePool,
    executeQuery,
    sql
};
