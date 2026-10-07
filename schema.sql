'use strict';
const path = require('path');
const fs = require('fs');

// Load .env for local development (no extra dependency needed).
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { migrate, pool } = require('./db');

const PROD = process.env.NODE_ENV === 'production';
const app = express();
app.set('trust proxy', 1);          // the host's load balancer terminates TLS
app.disable('x-powered-by');

// Security headers. Scripts may only load from this site.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'"],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'https://fonts.gstatic.com'],
      'img-src': ["'self'", 'data:'],
      'media-src': ["'self'"],
      'connect-src': ["'self'"],
      'frame-ancestors': ["'none'"],
      'upgrade-insecure-requests': PROD ? [] : null
    }
  },
  strictTransportSecurity: PROD ? { maxAge: 31536000, includeSubDomains: true } : false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));

// In production, always use HTTPS.
if (PROD) app.use((req, res, next) => (req.secure ? next() : res.redirect(301, 'https://' + req.get('host') + req.originalUrl)));

app.use(express.json({ limit: '50kb' }));

// Request log: method, path, status and timing only. Never bodies, passwords or cookies.
app.use((req, res, next) => {
  const t = Date.now();
  res.on('finish', () => {
    if (req.path.startsWith('/api/')) console.log(JSON.stringify({ t: new Date().toISOString(), m: req.method, p: req.path, s: res.statusCode, ms: Date.now() - t }));
  });
  next();
});

// Cross site request protection: anything that changes data must come from this site's own pages.
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (origin) {
    let host = '';
    try { host = new URL(origin).host; } catch (e) { /* ignore */ }
    if (host !== req.get('host')) return res.status(403).json({ error: 'Request blocked.' });
  }
  if (!req.is('application/json')) return res.status(415).json({ error: 'Request blocked.' });
  next();
});

// Rate limits. Sign in and sign up are held much tighter than everything else.
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: Number(process.env.AUTH_RATE_LIMIT || 20), standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many attempts. Wait a few minutes and try again.' } });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests. Slow down for a moment.' } });
app.use('/api/auth', authLimiter);
app.use('/api', apiLimiter);
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// Account forms (sign up, log in, passwords) are plain HTML form posts handled in forms.js.
app.use('/account', authLimiter, express.urlencoded({ extended: false, limit: '10kb' }), require('./forms'));

app.use('/api', require('./routes'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

app.get('/healthz', (req, res) => res.json({ ok: true }));
app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'], maxAge: PROD ? '1h' : 0 }));
app.use((req, res) => res.status(404).sendFile(path.join(__dirname, '..', 'public', 'index.html')));

// Errors: the details go to the log, the visitor gets a plain message.
app.use((err, req, res, next) => {   // eslint-disable-line no-unused-vars
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'That request could not be read.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side. Try again.' });
});

const port = Number(process.env.PORT || 3000);
migrate().then(() => {
  const server = app.listen(port, () => console.log(`Outwork is running on port ${port}`));
  const stop = () => server.close(() => pool.end().then(() => process.exit(0)));
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}).catch((e) => { console.error('Could not start:', e); process.exit(1); });
