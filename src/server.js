'use strict';
/**
 * src/server.js — Wollo Info Hub Backend v2 (Supabase)
 *
 * Render-compatible:
 *  - listens on process.env.PORT (Render injects this)
 *  - binds to 0.0.0.0 so Render's proxy can reach it
 *  - no --use-system-ca flag (not available on Node 18/20)
 *  - graceful env-var validation at startup
 *  - CORS applied before all routes, preflight handled
 *  - global error handler always returns JSON
 */

// ── Process-level safety net — one bug must never kill the process ──
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

require('dotenv').config();

// ── Env validation — fail loudly before anything else ────────
const REQUIRED_ENV = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(
    `\n[startup] FATAL — missing required environment variables:\n  ${missing.join('\n  ')}\n` +
    'Set them in .env (local) or in the Render / Vercel dashboard, then restart.\n'
  );
  process.exit(1);
}

const express = require('express');
const cors    = require('cors');

// ── Optional packages — load gracefully ──────────────────────
let helmet, morgan, rateLimit;
try { helmet    = require('helmet');             } catch { helmet    = null; }
try { morgan    = require('morgan');             } catch { morgan    = null; }
try { rateLimit = require('express-rate-limit'); } catch { rateLimit = null; }

// ── Route handlers ─────────────────────────────────────────────
const authRouter           = require('./routes/auth');
const adminRouter          = require('./routes/admin');
const departmentHeadRouter = require('./routes/departmentHead');
const departmentsRouter    = require('./routes/departments');
const contentRouter        = require('./routes/content');
const motivationsRouter    = require('./routes/motivations');
const opportunitiesRouter  = require('./routes/opportunities');
const mediaRouter          = require('./routes/media');
const publicRouter         = require('./routes/public');
const studentsRouter       = require('./routes/students');
const auditRouter          = require('./routes/audit');

const { adminClient } = require('./config/supabase');

// ── Port & origin config ───────────────────────────────────────
// Render injects PORT at runtime — never hard-code it.
const PORT     = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Build the allowed-origins list from two sources:
//   CORS_ORIGIN  — legacy single-value or comma-separated list (kept for compat)
//   CLIENT_URLS  — comma-separated list (new, used by Render env var)
// Always include localhost and the Vercel deployment.
const ALWAYS_ALLOWED = [
  'http://localhost:5173',
  'http://localhost:3000',
  'https://wollo-info-hub.vercel.app',
];

function buildOrigins() {
  const fromEnv = [
    ...(process.env.CORS_ORIGIN  ? process.env.CORS_ORIGIN.split(',')  : []),
    ...(process.env.CLIENT_URLS  ? process.env.CLIENT_URLS.split(',')  : []),
  ].map((o) => o.trim()).filter(Boolean);

  // Deduplicate
  return [...new Set([...ALWAYS_ALLOWED, ...fromEnv])];
}

const allowedOrigins = buildOrigins();

const corsOptions = {
  origin(origin, cb) {
    // Allow non-browser tools (curl, Postman, server-to-server) which have no Origin
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin '${origin}' is not allowed`));
  },
  credentials:    true,
  methods:        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

const app = express();

// ── Preflight — must be FIRST, before any other middleware ────
app.options('*', cors(corsOptions));

// ── CORS ──────────────────────────────────────────────────────
app.use(cors(corsOptions));

// ── Security headers (optional) ───────────────────────────────
if (helmet) {
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
} else {
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });
}

// ── Body parsing ──────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Request logging (optional) ────────────────────────────────
if (morgan && NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// ── Rate limiting (optional) ──────────────────────────────────
if (rateLimit) {
  app.use(
    rateLimit({
      windowMs:        60_000,
      max:             200,
      standardHeaders: true,
      legacyHeaders:   false,
      message:         { error: 'Too many requests.', code: 'RATE_LIMIT' },
    })
  );
}

// ── Health check ──────────────────────────────────────────────
// Hit GET /api/health in the browser to confirm the server is alive.
app.get('/api/health', async (_req, res) => {
  try {
    const { error } = await adminClient.from('faculties').select('id').limit(1);
    if (error) throw new Error(error.message);
    return res.json({ ok: true, database: 'supabase', time: new Date().toISOString() });
  } catch (err) {
    return res.status(503).json({ ok: false, error: err.message });
  }
});

// ── API routes ─────────────────────────────────────────────────
app.use('/api/auth',            authRouter);
app.use('/api/admin',           adminRouter);
app.use('/api/department-head', departmentHeadRouter);
app.use('/api/content',         contentRouter);
app.use('/api/motivations',     motivationsRouter);
app.use('/api/opportunities',   opportunitiesRouter);
app.use('/api/media',           mediaRouter);
app.use('/api/students',        studentsRouter);
app.use('/api/audit',           auditRouter);
app.use('/api/public',          publicRouter);
app.use('/api/departments',     departmentsRouter);

// ── 404 — must come after all routes ──────────────────────────
app.use((req, res) => {
  res.status(404).json({
    error: `Route ${req.method} ${req.path} not found`,
    code:  'NOT_FOUND',
  });
});

// ── Global error handler — always returns JSON ────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  // CORS errors come through here
  if (err.message && err.message.startsWith('CORS:')) {
    return res.status(403).json({ error: err.message, code: 'CORS_BLOCKED' });
  }
  const status = err.status || err.statusCode || 500;
  if (status === 500) console.error('[Unhandled error]', err);
  return res.status(status).json({
    error: err.status ? err.message : 'Internal server error',
    code:  err.code   || 'INTERNAL_ERROR',
    ...(NODE_ENV !== 'production' && status === 500 ? { detail: err.message } : {}),
  });
});

// ── Start ──────────────────────────────────────────────────────
// Bind to 0.0.0.0 so Render's reverse proxy can reach the process.
app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  ✓ Wollo Info Hub API v2');
  console.log(`  → http://0.0.0.0:${PORT}`);
  console.log(`  → Supabase: ${process.env.SUPABASE_URL}`);
  console.log(`  → Allowed origins: ${allowedOrigins.join(', ')}`);
  if (!helmet)    console.log('  ⚠  helmet not installed   — run npm install');
  if (!morgan)    console.log('  ⚠  morgan not installed   — run npm install');
  if (!rateLimit) console.log('  ⚠  rate-limit not installed — run npm install');
  console.log('');
});

module.exports = app;
