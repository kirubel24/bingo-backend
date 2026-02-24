import cookieParser from 'cookie-parser';
import { verifyToken } from '../utils/jwt.js';

export const attachCookieParser = (app) => {
  app.use(cookieParser());
};

export const requireAuth = (req, res, next) => {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ success: false, message: 'Invalid token' });
  req.user = payload;
  next();
};

// Socket.IO middleware-like helper to verify cookies from handshake
export const getUserFromSocket = (socket) => {
  const cookieHeader = socket.handshake.headers?.cookie || '';
  const cookies = Object.fromEntries(
    cookieHeader.split(';').map(c => {
      const [k, v] = c.trim().split('=');
      return [k, v];
    })
  );
  const token = cookies.token;
  return token ? verifyToken(token) : null;
};

