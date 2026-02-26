// src/db.js
import 'dotenv/config';
import mysql from 'mysql2/promise';

const host = process.env.DB_HOST || process.env.MYSQLHOST || process.env.MYSQL_HOST;
const port = process.env.DB_PORT || process.env.MYSQLPORT || process.env.MYSQL_PORT;
const user = process.env.DB_USER || process.env.MYSQLUSER || process.env.MYSQL_USER;
const password = process.env.DB_PASSWORD || process.env.DB_PASS || process.env.MYSQLPASSWORD || process.env.MYSQL_PASSWORD;
const database = process.env.DB_NAME || process.env.MYSQLDATABASE || process.env.MYSQL_DATABASE;

const wantsSsl =
  process.env.DB_SSL === 'true' ||
  (process.env.DB_SSL !== 'false' && !!process.env.MYSQLHOST);

const dbConfig = {
  host,
  port: port ? Number(port) : 3306,
  user,
  password,
  database,
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
  queueLimit: 0,
  ssl: wantsSsl ? { rejectUnauthorized: false } : undefined
};

let pool;

try {
  pool = mysql.createPool(dbConfig);
} catch (err) {
  console.error('❌ Failed to initialize MySQL pool:', err);
}

export { pool };
export default pool;

export const testConnection = async () => {
  if (!pool) {
    console.error('❌ Database pool is not initialized. Check DB environment variables.');
    return;
  }
  try {
    const [rows] = await pool.query('SELECT 1 + 1 AS result');
    console.log('✅ Database connected, test query result:', rows[0].result);
  } catch (err) {
    console.error('❌ Database connection failed:', err);
  }
};
