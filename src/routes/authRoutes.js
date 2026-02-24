import express from 'express';
import bcrypt from 'bcrypt';
import { pool } from '../db.js';
import { signToken, verifyToken } from '../utils/jwt.js';
import { sendEmail } from '../utils/email.js';

const router = express.Router();

const validateEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const validatePassword = (password) => /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,}$/.test(password);
const validateUsername = (username) => /^[A-Za-z0-9_]{3,20}$/.test(username);

// Email availability checker
router.get('/check-email', async (req, res) => {
  const email = (req.query.email || '').trim().toLowerCase();
  if (!email || !validateEmail(email)) return res.status(400).json({ success: false, valid: false, message: 'Invalid email' });
  try {
    const [rows] = await pool.query('SELECT id FROM user_profiles WHERE email = ?', [email]);
    return res.json({ success: true, valid: true, exists: rows.length > 0 });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Username availability checker
router.get('/check-username', async (req, res) => {
  const username = (req.query.username || '').trim();
  if (!username || !validateUsername(username)) {
    return res.status(400).json({ success: false, valid: false, message: 'Invalid username' });
  }
  try {
    const [rows] = await pool.query('SELECT id FROM users WHERE username = ?', [username]);
    return res.json({ success: true, valid: true, exists: rows.length > 0 });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Register (email required)
router.post('/register', async (req, res) => {
  try {
    const { email, password, username, playerId } = req.body || {};
    const normalizedEmail = (email || '').trim().toLowerCase();
    if (!normalizedEmail || !validateEmail(normalizedEmail)) {
      return res.status(400).json({ success: false, message: 'Valid email is required' });
    }
    if (!password || !validatePassword(password)) {
      return res.status(400).json({ success: false, message: 'Password must be 8+ chars, include letters and numbers' });
    }
    const desiredUsername = (username || '').trim();
    if (!desiredUsername) {
      return res.status(400).json({ success: false, message: 'Username is required' });
    }
    if (!validateUsername(desiredUsername)) {
      return res.status(400).json({ success: false, message: 'Username must be 3–20 chars: letters, numbers, underscores' });
    }

    // Uniqueness checks
    const [pRows] = await pool.query('SELECT id FROM user_profiles WHERE email = ?', [normalizedEmail]);
    if (pRows.length) return res.status(409).json({ success: false, message: 'Email already registered' });
    const [uRows] = await pool.query('SELECT id FROM users WHERE username = ?', [desiredUsername]);
    if (uRows.length) return res.status(409).json({ success: false, message: 'Username already exists' });

    const [banEmailRows] = await pool.query(
      'SELECT u.id FROM users u JOIN user_profiles p ON p.user_id=u.id WHERE p.email=? AND u.banned_until IS NOT NULL AND u.banned_until > NOW()',
      [normalizedEmail]
    );
    if (banEmailRows.length) {
      return res.status(403).json({ success: false, message: 'Registration blocked: email is banned' });
    }
    if (playerId) {
      const [banDeviceRows] = await pool.query(
        'SELECT u.id FROM users u JOIN user_profiles p ON p.user_id=u.id WHERE p.player_id=? AND u.banned_until IS NOT NULL AND u.banned_until > NOW()',
        [playerId]
      );
      if (banDeviceRows.length) {
        return res.status(403).json({ success: false, message: 'Registration blocked: device is banned' });
      }
    }

    const hashed = await bcrypt.hash(password, 10);
    const [uRes] = await pool.query('INSERT INTO users (username, password) VALUES (?, ?)', [desiredUsername, hashed]);
    const userId = uRes.insertId;
    await pool.query('INSERT INTO user_profiles (user_id, email, player_id) VALUES (?, ?, ?)', [userId, normalizedEmail, playerId || null]);

    const token = signToken({ id: userId, username: desiredUsername });
    res.cookie('token', token, { httpOnly: true, sameSite: 'lax', secure: false, maxAge: 2 * 60 * 60 * 1000 });
    return res.json({ success: true, message: 'Registration successful', userId, username: desiredUsername, token });
  } catch (e) {
    console.error('Register error:', e);
    return res.status(500).json({ success: false, message: 'Registration failed' });
  }
});

// Login (email or username)
router.post('/login', async (req, res) => {
  try {
    const { identifier, password } = req.body || {};
    if (!identifier || !password) return res.status(400).json({ success: false, message: 'Identifier and password required' });

    // Find by username first, then email via profile
    const [uRows] = await pool.query('SELECT * FROM users WHERE username = ?', [identifier]);
    let user = uRows[0];
    if (!user) {
      const [pRows] = await pool.query('SELECT user_id FROM user_profiles WHERE email = ?', [identifier]);
      if (pRows.length) {
        const userId = pRows[0].user_id;
        const [uById] = await pool.query('SELECT * FROM users WHERE id = ?', [userId]);
        user = uById[0];
      }
    }

    if (!user) return res.status(401).json({ success: false, message: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ success: false, message: 'Invalid credentials' });

    const deactivated = Number(user.deactivated || 0) === 1;
    const bannedUntil = user.banned_until ? new Date(user.banned_until) : null;
    const isBanned = bannedUntil && bannedUntil.getTime() > Date.now();
    if (deactivated) return res.status(403).json({ success: false, message: 'Account is deactivated. Contact support.' });
    if (isBanned) return res.status(403).json({ success: false, message: 'Account is banned.' });

    const token = signToken({ id: user.id, username: user.username });
    res.cookie('token', token, { httpOnly: true, sameSite: 'lax', secure: false, maxAge: 2 * 60 * 60 * 1000 });
    return res.json({ success: true, message: 'Login successful', userId: user.id, username: user.username, token });
  } catch (e) {
    console.error('Login error:', e);
    return res.status(500).json({ success: false, message: 'Login failed' });
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true, message: 'Logged out' });
});

// Current user info from cookie
router.get('/me', (req, res) => {
  const cookieHeader = req.headers?.cookie || '';
  const cookies = Object.fromEntries(cookieHeader.split(';').filter(Boolean).map(c => {
    const [k, ...rest] = c.trim().split('=');
    return [k, decodeURIComponent(rest.join('='))];
  }));
  const token = cookies.token;
  if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ success: false, message: 'Invalid token' });
  res.json({ success: true, user: payload });
});

// Forgot password: send OTP to registered email
router.post('/forgot', async (req, res) => {
  try {
    const email = (req.body?.email || '').trim().toLowerCase();
    if (!email || !validateEmail(email)) return res.status(400).json({ success: false, message: 'Valid email required' });

    const [pRows] = await pool.query('SELECT user_id FROM user_profiles WHERE email = ?', [email]);
    if (!pRows.length) return res.status(404).json({ success: false, message: 'Email not registered' });
    const userId = pRows[0].user_id;

    const otp = String(Math.floor(100000 + Math.random() * 900000)); // 6-digit
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    await pool.query('INSERT INTO password_resets (user_id, token, expires_at, used) VALUES (?, ?, ?, 0)', [userId, otp, expiresAt]);

    const subject = 'Your Bingo OTP Code';
    const text = `Your OTP code is ${otp}. It expires in 10 minutes.`;
    const html = `<p>Your OTP code is <strong>${otp}</strong>. It expires in 10 minutes.</p>`;
    try {
      await sendEmail({ to: email, subject, text, html });
    } catch (mailErr) {
      console.error('Mail error:', mailErr);
      // Even if email fails, you might still want to respond generically to prevent enumeration
    }

    res.json({ success: true, message: 'If the email exists, an OTP has been sent' });
  } catch (e) {
    console.error('Forgot error:', e);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Reset password using OTP
router.post('/reset', async (req, res) => {
  try {
    const { email, token, password } = req.body || {};
    if (!email || !validateEmail(email)) return res.status(400).json({ success: false, message: 'Valid email required' });
    if (!token) return res.status(400).json({ success: false, message: 'OTP token required' });
    if (!password || !validatePassword(password)) return res.status(400).json({ success: false, message: 'Password must be 8+ chars, include letters and numbers' });

    const [pRows] = await pool.query('SELECT user_id FROM user_profiles WHERE email = ?', [email]);
    if (!pRows.length) return res.status(404).json({ success: false, message: 'Email not registered' });
    const userId = pRows[0].user_id;

    const [rRows] = await pool.query('SELECT * FROM password_resets WHERE user_id = ? AND token = ? AND used = 0 AND expires_at > NOW()', [userId, token]);
    if (!rRows.length) return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });

    const hashed = await bcrypt.hash(password, 10);
    await pool.query('UPDATE users SET password = ? WHERE id = ?', [hashed, userId]);
    await pool.query('UPDATE password_resets SET used = 1 WHERE user_id = ? AND token = ?', [userId, token]);

    res.json({ success: true, message: 'Password reset successful' });
  } catch (e) {
    console.error('Reset error:', e);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Google OAuth: login ONLY (no auto-provision)
router.post('/google', async (req, res) => {
  try {
    const credential = req.body?.credential;
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!credential || !clientId) {
      return res.status(400).json({ success: false, message: 'Missing Google credential or client ID' });
    }

    // Dynamic import to avoid boot-time failure if module not installed
    const { OAuth2Client } = await import('google-auth-library');
    const client = new OAuth2Client(clientId);
    const ticket = await client.verifyIdToken({ idToken: credential, audience: clientId });
    const payload = ticket.getPayload();
    const email = (payload?.email || '').toLowerCase();
    const name = payload?.name || '';
    const picture = payload?.picture || '';
    const sub = payload?.sub;

    if (!email) {
      return res.status(400).json({ success: false, message: 'Google account missing email' });
    }

    // Find existing user only
    const [existingProfile] = await pool.query('SELECT user_id, name FROM user_profiles WHERE email = ?', [email]);
    if (!existingProfile.length) {
      return res.status(404).json({ success: false, message: 'Account not found. Please register with Google first.' });
    }
    const userId = existingProfile[0].user_id;
    const [[uRow]] = await pool.query('SELECT deactivated, banned_until FROM users WHERE id=?', [userId]);
    const deactivated = Number(uRow?.deactivated || 0) === 1;
    const isBanned = uRow?.banned_until ? new Date(uRow.banned_until).getTime() > Date.now() : false;
    if (deactivated) return res.status(403).json({ success: false, message: 'Account is deactivated. Contact support.' });
    if (isBanned) return res.status(403).json({ success: false, message: 'Account is banned.' });
    const displayName = existingProfile[0].name || name || email;
    const token = signToken({ id: userId, username: displayName });
    res.cookie('token', token, { httpOnly: true, sameSite: 'lax', secure: false, maxAge: 2 * 60 * 60 * 1000 });
    return res.json({ success: true, message: 'Google login successful', userId, username: displayName, token });
  } catch (e) {
    console.error('Google login error:', e);
    return res.status(500).json({ success: false, message: 'Google login failed' });
  }
});

// Google OAuth: register (create user if not exists)
router.post('/google/register', async (req, res) => {
  try {
    const credential = req.body?.credential;
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!credential || !clientId) {
      return res.status(400).json({ success: false, message: 'Missing Google credential or client ID' });
    }

    const { OAuth2Client } = await import('google-auth-library');
    const client = new OAuth2Client(clientId);
    const ticket = await client.verifyIdToken({ idToken: credential, audience: clientId });
    const payload = ticket.getPayload();
    const email = (payload?.email || '').toLowerCase();
    const name = payload?.name || '';
    const picture = payload?.picture || '';
    const sub = payload?.sub;

    if (!email) {
      return res.status(400).json({ success: false, message: 'Google account missing email' });
    }

    // If exists, refuse register
    const [existingProfile] = await pool.query('SELECT user_id FROM user_profiles WHERE email = ?', [email]);
    if (existingProfile.length) {
      return res.status(409).json({ success: false, message: 'Email already registered. Try login.' });
    }

    const [banEmailRows] = await pool.query(
      'SELECT u.id FROM users u JOIN user_profiles p ON p.user_id=u.id WHERE p.email=? AND u.banned_until IS NOT NULL AND u.banned_until > NOW()',
      [email]
    );
    if (banEmailRows.length) {
      return res.status(403).json({ success: false, message: 'Registration blocked: email is banned' });
    }

    // Create new user with email as username
    const randomPassword = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const hashed = await bcrypt.hash(randomPassword, 10);
    const [uRes] = await pool.query('INSERT INTO users (username, password) VALUES (?, ?)', [email, hashed]);
    const userId = uRes.insertId;
    await pool.query('INSERT INTO user_profiles (user_id, email, name, avatar, player_id) VALUES (?, ?, ?, ?, ?)', [userId, email, name || null, picture || null, sub || null]);
    if (sub) {
      const [banDeviceRows] = await pool.query(
        'SELECT u.id FROM users u JOIN user_profiles p ON p.user_id=u.id WHERE p.player_id=? AND u.banned_until IS NOT NULL AND u.banned_until > NOW()',
        [sub]
      );
      if (banDeviceRows.length) {
        await pool.query('DELETE FROM users WHERE id=?', [userId]);
        await pool.query('DELETE FROM user_profiles WHERE user_id=?', [userId]);
        return res.status(403).json({ success: false, message: 'Registration blocked: device is banned' });
      }
    }

    const displayName = name || email;
    const token = signToken({ id: userId, username: displayName });
    res.cookie('token', token, { httpOnly: true, sameSite: 'lax', secure: false, maxAge: 2 * 60 * 60 * 1000 });
    return res.json({ success: true, message: 'Google registration successful', userId, username: displayName, token });
  } catch (e) {
    console.error('Google register error:', e);
    return res.status(500).json({ success: false, message: 'Google registration failed' });
  }
});

// Telegram login endpoint
router.post('/telegram', async (req, res) => {
  try {
    const { telegram_id } = req.body || {};
    if (!telegram_id) {
      return res.status(400).json({ success: false, message: 'Telegram ID required' });
    }

    // Find user by telegram_id
    const [users] = await pool.query(
      'SELECT * FROM users WHERE telegram_id = ?',
      [String(telegram_id)]
    );

    if (users.length === 0) {
      return res.status(404).json({ success: false, message: 'Telegram user not found' });
    }

    const user = users[0];
    const deactivated = Number(user.deactivated || 0) === 1;
    const bannedUntil = user.banned_until ? new Date(user.banned_until) : null;
    const isBanned = bannedUntil && bannedUntil.getTime() > Date.now();

    if (deactivated) {
      return res.status(403).json({ success: false, message: 'Account is deactivated. Contact support.' });
    }
    if (isBanned) {
      return res.status(403).json({ success: false, message: 'Account is banned.' });
    }

    const token = signToken({ id: user.id, username: user.username });
    res.cookie('token', token, { httpOnly: true, sameSite: 'lax', secure: false, maxAge: 2 * 60 * 60 * 1000 });
    return res.json({ 
      success: true, 
      message: 'Telegram login successful', 
      userId: user.id, 
      username: user.username,
      email: user.email || '',
      provider: 'telegram',
      token 
    });
  } catch (e) {
    console.error('Telegram login error:', e);
    return res.status(500).json({ success: false, message: 'Telegram login failed' });
  }
});

export default router;
