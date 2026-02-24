-- User accounts table
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  password VARCHAR(255) NULL,
  telegram_id VARCHAR(50) UNIQUE,
  phone_number VARCHAR(20),
  role ENUM('user','super_admin','finance_admin','support_admin') NOT NULL DEFAULT 'user',
  blocked TINYINT(1) NOT NULL DEFAULT 0,
  deactivated TINYINT(1) NOT NULL DEFAULT 0,
  banned_until DATETIME NULL,
  ban_reason VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Optional user profile data (email, name, avatar, playerId)
CREATE TABLE IF NOT EXISTS user_profiles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL UNIQUE,
  email VARCHAR(100) UNIQUE,
  name VARCHAR(100),
  avatar VARCHAR(255),
  player_id VARCHAR(50) UNIQUE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Bingo cards table (to associate cards with users)
CREATE TABLE IF NOT EXISTS user_cards (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  card_id INT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, card_id)
);

-- Drawn numbers per game
CREATE TABLE IF NOT EXISTS game_numbers (
  game_id INT NOT NULL,
  number INT NOT NULL,
  drawn_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_game_number (game_id, number)
);

-- Password reset tokens (OTP)
CREATE TABLE IF NOT EXISTS password_resets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  token VARCHAR(20) NOT NULL,
  expires_at DATETIME NOT NULL,
  used TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user (user_id),
  INDEX idx_token (token)
);

-- Wallet balances per user
CREATE TABLE IF NOT EXISTS wallets (
  user_id INT PRIMARY KEY,
  main_balance DECIMAL(12,2) NOT NULL DEFAULT 0,
  bonus_balance DECIMAL(12,2) NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Unified transactions ledger
CREATE TABLE IF NOT EXISTS transactions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  type ENUM('deposit','withdrawal','bonus','adjustment') NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  method VARCHAR(32),
  reference VARCHAR(64),
  status ENUM('pending','approved','rejected','paid','success') NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_type (user_id, type),
  INDEX idx_status (status)
);

-- Manual deposits
CREATE TABLE IF NOT EXISTS deposits (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  method ENUM('telebirr','cbe','chapa') NOT NULL,
  sender VARCHAR(64) NOT NULL,
  txid VARCHAR(64) NOT NULL,
  status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  verified_at TIMESTAMP NULL,
  UNIQUE KEY uniq_txid (txid),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_status (user_id, status)
);

-- Manual withdrawals
CREATE TABLE IF NOT EXISTS withdrawals (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  method ENUM('telebirr','cbe','amole') NOT NULL,
  receiver VARCHAR(64) NOT NULL,
  status ENUM('pending','paid','rejected') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMP NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_status2 (user_id, status)
);

-- System settings
CREATE TABLE IF NOT EXISTS settings (
  k VARCHAR(64) PRIMARY KEY,
  v TEXT NOT NULL
);

-- Activity logs for admin actions
CREATE TABLE IF NOT EXISTS activity_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  admin_id INT NOT NULL,
  action VARCHAR(64) NOT NULL,
  target_type VARCHAR(64),
  target_id VARCHAR(64),
  details TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Telegram deposit requests with screenshots
CREATE TABLE IF NOT EXISTS deposit_requests (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  amount DECIMAL(12,2),
  screenshot_url TEXT,
  status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
  source ENUM('web', 'telegram') DEFAULT 'web',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
