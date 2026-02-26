// src/server.js
import http from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
import app from "./app.js";
import { initSocket } from "./socket.js";
import { testConnection, pool } from "./db.js";
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bot from './bot.js';

if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

const PORT = Number(process.env.PORT) || 5000;
const rawFrontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
const FRONTEND_ORIGIN = rawFrontendUrl.replace(/\/+$/, "");

// Initialize database tables
const initDatabase = async () => {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    
    // Read the schema file
    const schemaPath = path.join(__dirname, 'db', 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    
    // Split the schema into individual statements
    const statements = schema
      .split(';')
      .filter(statement => statement.trim() !== '');
    
    // Execute each statement
    for (const statement of statements) {
      if (statement.trim()) {
        await pool.query(statement);
      }
    }

    // Ensure users table has role and blocked columns in a version-safe way
    const [roleCol] = await pool.query(`SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='role'`)
    if (!roleCol[0].c) {
      await pool.query(`ALTER TABLE users ADD COLUMN role ENUM('user','super_admin','finance_admin','support_admin') NOT NULL DEFAULT 'user'`)
    }
    const [blockedCol] = await pool.query(`SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='blocked'`)
    if (!blockedCol[0].c) {
      await pool.query(`ALTER TABLE users ADD COLUMN blocked TINYINT(1) NOT NULL DEFAULT 0`)
    }
    const [deactivatedCol] = await pool.query(`SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='deactivated'`)
    if (!deactivatedCol[0].c) {
      await pool.query(`ALTER TABLE users ADD COLUMN deactivated TINYINT(1) NOT NULL DEFAULT 0`)
    }
    const [bannedUntilCol] = await pool.query(`SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='banned_until'`)
    if (!bannedUntilCol[0].c) {
      await pool.query(`ALTER TABLE users ADD COLUMN banned_until DATETIME NULL`)
    }
    const [banReasonCol] = await pool.query(`SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='ban_reason'`)
    if (!banReasonCol[0].c) {
      await pool.query(`ALTER TABLE users ADD COLUMN ban_reason VARCHAR(255) NULL`)
    }

    // --- Telegram Integration Columns ---
    const [tgIdCol] = await pool.query(`SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='telegram_id'`)
    if (!tgIdCol[0].c) {
      await pool.query(`ALTER TABLE users ADD COLUMN telegram_id VARCHAR(50) UNIQUE`)
    }
    const [phoneCol] = await pool.query(`SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='phone_number'`)
    if (!phoneCol[0].c) {
      await pool.query(`ALTER TABLE users ADD COLUMN phone_number VARCHAR(20)`)
    }

    // Ensure deposit_requests table exists with screenshot_url
    await pool.query(`
      CREATE TABLE IF NOT EXISTS deposit_requests (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        amount DECIMAL(12,2),
        screenshot_url TEXT,
        status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
        source ENUM('web', 'telegram') DEFAULT 'web',
        method VARCHAR(32),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `)

    const [drMethodCol] = await pool.query(`SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='deposit_requests' AND COLUMN_NAME='method'`)
    if (!drMethodCol[0].c) {
      await pool.query(`ALTER TABLE deposit_requests ADD COLUMN method VARCHAR(32)`)
    }
    // --- End Telegram Integration Columns ---

    // Ensure wallets table has expected columns even if an older schema exists
    const [walletMainCol] = await pool.query(`SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='wallets' AND COLUMN_NAME='main_balance'`)
    if (!walletMainCol[0].c) {
      await pool.query(`ALTER TABLE wallets ADD COLUMN main_balance DECIMAL(12,2) NOT NULL DEFAULT 0`)
    }
    const [walletBonusCol] = await pool.query(`SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='wallets' AND COLUMN_NAME='bonus_balance'`)
    if (!walletBonusCol[0].c) {
      await pool.query(`ALTER TABLE wallets ADD COLUMN bonus_balance DECIMAL(12,2) NOT NULL DEFAULT 0`)
    }

    // Ensure transactions table has expected columns used by controllers
    const [txRefCol] = await pool.query(`SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='transactions' AND COLUMN_NAME='reference'`)
    if (!txRefCol[0].c) {
      await pool.query(`ALTER TABLE transactions ADD COLUMN reference VARCHAR(64)`)
    }
    const [txMethodCol] = await pool.query(`SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='transactions' AND COLUMN_NAME='method'`)
    if (!txMethodCol[0].c) {
      await pool.query(`ALTER TABLE transactions ADD COLUMN method VARCHAR(32)`)
    }

    // Ensure transactions.type enum supports gameplay adjustments
    const [txTypeRows] = await pool.query(`SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='transactions' AND COLUMN_NAME='type'`)
    const txType = txTypeRows[0]?.COLUMN_TYPE || ''
    if (!/enum\('deposit','withdrawal','bonus','adjustment'\)/i.test(txType)) {
      await pool.query(`ALTER TABLE transactions MODIFY COLUMN type ENUM('deposit','withdrawal','bonus','adjustment') NOT NULL`)
    }

    const [txStatusTypeRows] = await pool.query(`SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='transactions' AND COLUMN_NAME='status'`)
    const txStatusType = txStatusTypeRows[0]?.COLUMN_TYPE || ''
    if (!/enum\('pending','approved','rejected','paid','success'\)/i.test(txStatusType)) {
      await pool.query(`ALTER TABLE transactions MODIFY COLUMN status ENUM('pending','approved','rejected','paid','success') NOT NULL`)
    }
    const [depStatusTypeRows] = await pool.query(`SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='deposits' AND COLUMN_NAME='status'`)
    const depStatusType = depStatusTypeRows[0]?.COLUMN_TYPE || ''
    if (!/enum\('pending','approved','rejected'\)/i.test(depStatusType)) {
      await pool.query(`ALTER TABLE deposits MODIFY COLUMN status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending'`)
    }
    const [wdStatusTypeRows] = await pool.query(`SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='withdrawals' AND COLUMN_NAME='status'`)
    const wdStatusType = wdStatusTypeRows[0]?.COLUMN_TYPE || ''
    if (!/enum\('pending','paid','rejected'\)/i.test(wdStatusType)) {
      await pool.query(`ALTER TABLE withdrawals MODIFY COLUMN status ENUM('pending','paid','rejected') NOT NULL DEFAULT 'pending'`)
    }
    
    console.log('✅ Database tables initialized successfully');
  } catch (error) {
    console.error('❌ Error initializing database tables:', error);
  }
};

// Initialize database and test connection
(async () => {
  await initDatabase();
  await testConnection();
})();

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      const devSocketOrigins = [
        "http://localhost:5173",
        "http://localhost:4173",
        "http://localhost:5174",
        "http://localhost:5175",
        "http://localhost:5176",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
        "http://127.0.0.1:5175",
        "http://127.0.0.1:4173"
      ];

      const explicitFrontend = "https://bingo-frontend-gold.vercel.app";
      const legacyFrontend = "https://app-bingo-game.vercel.app";
      const extraOrigins = (process.env.SOCKET_ORIGINS || "")
        .split(",")
        .map(o => o.trim())
        .filter(Boolean);

      const allowedOrigins = [
        FRONTEND_ORIGIN,
        explicitFrontend,
        legacyFrontend,
        ...devSocketOrigins,
        ...extraOrigins
      ].filter(Boolean);

      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by Socket.IO CORS"));
      }
    },
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Initialize Socket.IO events
initSocket(io);

// Start Telegram Bot
if (process.env.TELEGRAM_BOT_TOKEN) {
  bot.launch()
    .then(() => console.log('🤖 Telegram Bot started'))
    .catch((err) => console.error('❌ Failed to start Telegram Bot:', err));
} else {
  console.warn('⚠️ TELEGRAM_BOT_TOKEN not found, bot not started');
}

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

const shutdown = async () => {
  try {
    io.close();
  } catch {}
  try {
    if (pool) {
      await pool.end();
      console.log('✅ Database pool closed');
    }
  } catch (err) {
    console.error('❌ Error closing database pool during shutdown:', err);
  }
  try {
    server.close(() => {
      process.exit(0);
    });
  } catch {
    process.exit(0);
  }
  setTimeout(() => process.exit(0), 1000);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
