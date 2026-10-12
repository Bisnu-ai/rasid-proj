'use strict';

const jwt = require('jsonwebtoken');
const config = require('./config');
const { User } = require('./models');

const COOKIE = 'dp_session';

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.isProd,
    path: '/',
    maxAge: config.sessionHours * 60 * 60 * 1000,
  };
}

function issueSession(res, user) {
  const token = jwt.sign({ sub: String(user._id) }, config.jwtSecret, {
    expiresIn: `${config.sessionHours}h`,
    algorithm: 'HS256',
  });
  res.cookie(COOKIE, token, cookieOptions());
}

function clearSession(res) {
  res.clearCookie(COOKIE, { ...cookieOptions(), maxAge: undefined });
}

/**
 * Authentication + authorization:
 *  - valid signed session cookie
 *  - user still exists, is active, and holds an authorized role
 */
async function requireAuth(req, res, next) {
  try {
    const token = req.cookies && req.cookies[COOKIE];
    if (!token) return res.status(401).json({ error: 'Please log in.' });

    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    } catch {
      clearSession(res);
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }

    const user = await User.findById(payload.sub).lean();
    if (!user || !user.active || !['admin', 'creator'].includes(user.role)) {
      clearSession(res);
      return res.status(403).json({ error: 'Your account is not authorized.' });
    }
    req.user = { id: String(user._id), username: user.username, role: user.role };
    next();
  } catch (err) {
    next(err);
  }
}

/** Basic CSRF defence-in-depth for state-changing requests (cookie is also SameSite=Strict). */
function requireXhr(req, res, next) {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.get('X-Requested-With') !== 'fetch') {
    return res.status(403).json({ error: 'Invalid request.' });
  }
  next();
}

module.exports = { requireAuth, requireXhr, issueSession, clearSession, COOKIE };
