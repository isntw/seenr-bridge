import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { countUsers, createUser, getUserByUsername, getUserById, createSession, getSession, deleteSession, updateUserPassword, deleteUserSessions } from './db';

const COOKIE = 'sb_session';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return salt.toString('hex') + ':' + hash.toString('hex');
}

function verifyPassword(pw: string, stored: string): boolean {
  const [saltHex, hashHex] = (stored || '').split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function parseCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setSessionCookie(res: Response, token: string) {
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${MAX_AGE}`);
}
function clearSessionCookie(res: Response) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

function currentUser(req: Request) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return undefined;
  const sess = getSession(token);
  return sess ? getUserById(sess.user_id) : undefined;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (currentUser(req)) return next();
  return res.status(401).json({ error: 'unauthorized' });
}

export const authRouter = Router();

authRouter.get('/status', (req, res) => {
  const user = currentUser(req);
  res.json({ authenticated: !!user, username: user?.username ?? null, needsSetup: countUsers() === 0 });
});

authRouter.post('/register', (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (countUsers() > 0) return res.status(403).json({ error: 'Registration is closed — an account already exists.' });
  if (!username || !password) return res.status(400).json({ error: 'Enter a username and password.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  const user = createUser(username, hashPassword(password));
  setSessionCookie(res, createSession(user.id));
  res.json({ authenticated: true, username: user.username });
});

authRouter.post('/login', (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const user = getUserByUsername(username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Wrong username or password.' });
  }
  setSessionCookie(res, createSession(user.id));
  res.json({ authenticated: true, username: user.username });
});

authRouter.post('/logout', (req, res) => {
  const token = parseCookies(req)[COOKIE];
  if (token) deleteSession(token);
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.post('/change-password', (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  const current = String(req.body?.current_password || '');
  const next = String(req.body?.new_password || '');
  if (!verifyPassword(current, user.password_hash)) return res.status(400).json({ error: 'Current password is wrong.' });
  if (next.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  updateUserPassword(user.id, hashPassword(next));
  // sign every device out, then re-issue a session for this one
  deleteUserSessions(user.id);
  setSessionCookie(res, createSession(user.id));
  res.json({ ok: true });
});
