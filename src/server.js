'use strict';
/**
 * src/server.js — Wollo Info Hub Backend v2 (Supabase)
 */

require('dotenv').config();

// ── Guard: fail fast with a clear message if .env is incomplete ──
const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`\n  ✗ Missing required environment variable: ${key}`);
    console.error('  → Check your .env file and restart the server.\n');
    process.exit(1);
  }
}

const express = require('express');
const cors    = require('cors');

// ── Optional packages — load gracefully ──────────────────────────
let helmet, morgan, rateLimit;
try { helmet    = require('helmet');             } catch { helmet    = null; }
try { morgan    = require('morgan');             } catch { morgan    = null; }
try { rateLimit = require('express-rate-limit'); } catch { rateLimit = null; }

// ── Route handlers ────────────────────────────────────────────────
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

const PORT     = process.env.PORT     || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// ── CORS origins ──────────────────────────────────────────────────
// Read from CORS_ORIGIN (comma-separated) plus any CLIENT_URLS extra list.
// Wildcard '*' disables the allow-list and permits all origins.
function buildAllowedOrigins() {
  const raw = [
    process.env.CORS_ORIGIN  || '',
    process.env.CLIENT_URLS  || '',
  ].join(',');

  if (raw.includes('*')) return true; // allow all

  return raw
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);
}

const allowedOrigins = buildAllowedOrigins();

const corsOptions = {
  origin(origin, cb) {
    // Allow server-to-server calls (no Origin header) and listed origins
    if (!origin) return cb(null, true);
    if (allowedOrigins === true) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin "${origin}" is not allowed.`));
  },
  credentials:    true,
  methods:        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

const app = express();

// ── 1. CORS — must be first so preflight OPTIONS gets a response ──
app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // explicit preflight handler

// ── 2. Security headers (optional) ───────────────────────────────
if (helmet) {
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
} else {
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });
}

// ── 3. Body parsing — must be before routes ───────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// ── 4. Request logging (optional) ────────────────────────────────
if (morgan && NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// ── 5. Rate limiting (optional) ──────────────────────────────────
if (rateLimit) {
  app.use(rateLimit({
    windowMs:        60_000,
    max:             200,
    standardHeaders: true,
    legacyHeaders:   false,
    message:         { error: 'Too many requests.', code: 'RATE_LIMIT' },
  }));
}

// ── Health check ──────────────────────────────────────────────────
app.get('/api/health', async (_req, res) => {
  try {
    const { error } = await adminClient.from('faculties').select('id').limit(1);
    if (error) throw new Error(error.message);
    return res.json({ ok: true, status: 'ok', database: 'supabase', time: new Date().toISOString() });
  } catch (err) {
    return res.status(503).json({ ok: false, status: 'error', message: err.message });
  }
});

// ── API routes — all BEFORE the 404 handler ───────────────────────
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

// ── 404 — must be last ────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    error: `Route ${req.method} ${req.path} not found`,
    code:  'NOT_FOUND',
  });
});

// ── Global error handler ──────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  // CORS errors from the origin check above
  if (err.message && err.message.startsWith('CORS:')) {
    return res.status(403).json({ error: err.message, code: 'CORS_BLOCKED' });
  }
  const status = err.status || 500;
  if (status === 500) console.error('[Unhandled error]', err);
  res.status(status).json({
    error: err.status ? err.message : 'Internal server error',
    code:  err.code   || 'INTERNAL_ERROR',
    ...(NODE_ENV !== 'production' && status === 500 ? { detail: err.message } : {}),
  });
});

// ── Start ─────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log('  ✓ Wollo Info Hub API v2  —  Server running on port', PORT);
  console.log(`  → http://localhost:${PORT}/api/health`);
  console.log(`  → Supabase: ${process.env.SUPABASE_URL}`);
  console.log(`  → CORS origins: ${allowedOrigins === true ? '*' : allowedOrigins.join(', ')}`);
  if (!helmet)    console.log('  ⚠  helmet not installed    — run: npm install');
  if (!morgan)    console.log('  ⚠  morgan not installed    — run: npm install');
  if (!rateLimit) console.log('  ⚠  rate-limit not installed — run: npm install');
  console.log('');
});

module.exports = app;
