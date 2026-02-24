import { verifyToken } from '../utils/jwt.js';

const parseCookies = (cookieHeader = '') => {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach(cookie => {
    const trimmed = cookie.trim();
    if (!trimmed) return;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) return;
    const key = trimmed.substring(0, eqIndex).trim();
    let value = trimmed.substring(eqIndex + 1).trim();
    try {
      value = decodeURIComponent(value);
    } catch (e) {
      // If decode fails, use original value
    }
    cookies[key] = value;
  });
  return cookies;
};

export const requireAuth = (req, res, next) => {
  // Prefer Authorization header over cookie to allow per-request user scoping
  const auth = req.headers?.authorization || '';
  let token = null;
  if (auth.startsWith('Bearer ')) {
    token = auth.slice(7);
  } else {
    const cookies = parseCookies(req.headers?.cookie || '');
    token = cookies.token;
  }
  if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ success: false, message: 'Invalid token' });
  req.user = payload;
  next();
};

// Socket.IO middleware-like helper to verify cookies from handshake
export const getUserFromSocket = (socket) => {
  const cookieHeader = socket.handshake.headers?.cookie || '';
  const cookies = parseCookies(cookieHeader);
  const token = cookies.token;
  return token ? verifyToken(token) : null;
};

export const requireRole = (roles = []) => (req, res, next) => {
  const user = req.user;
  if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });
  if (roles.length && !roles.includes(user.role)) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }
  next();
};

export const requireAdminGate = (req, res, next) => {
  const cookies = parseCookies(req.headers?.cookie || '')
  const hasAdminSession = cookies.admin_session === '1' || cookies.admin_session === 1
  // Allow if admin_session cookie exists OR JWT user has admin role
  const tokenUser = req.user || null
  const isAdminRole = tokenUser && ['super_admin','finance_admin','support_admin'].includes(tokenUser.role)
  if (!hasAdminSession && !isAdminRole) {
    return res.status(401).json({ success: false, message: 'Unauthorized' })
  }
  if (hasAdminSession && !req.user) {
    req.user = { id: 0, role: 'super_admin', username: 'admin' }
  }
  next()
}
