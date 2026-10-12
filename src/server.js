/**
 * src/server.js — Wollo Info Hub Backend v2 (Supabase)
 *
 * Dependencies used here are ALL already in node_modules:
 *   express, cors, dotenv  ✓  (were in old backend)
 *
 * Optional packages (gracefully skipped if not installed):
 *   helmet, morgan, express-rate-limit
 *   → run:  npm install  (in cmd.exe, not PowerShell)
 *   → to unlock these
 */

'use strict';

require('dotenv').config();

const express = require('express');
const cors    = require('cors');

// ── Optional packages — load gracefully ──────────────────────
let helmet, morgan, rateLimit;
try { helmet    = require('helmet');             } catch { helmet    = null; }
try { morgan    = require('morgan');             } catch { morgan    = null; }
try { rateLimit = require('express-rate-limit'); } catch { rateLimit = null; }

// ── Route handlers ────────────────────────────────────────────
const authRouter             = require('./routes/auth');
const adminRouter            = require('./routes/admin');
const departmentHeadRouter   = require('./routes/departmentHead');
const departmentsRouter      = require('./routes/departments');
const contentRouter          = require('./routes/content');
const motivationsRouter      = require('./routes/motivations');
const opportunitiesRouter    = require('./routes/opportunities');
const mediaRouter            = require('./routes/media');
const publicRouter           = require('./routes/public');
const studentsRouter         = require('./routes/students');
const auditRouter            = require('./routes/audit');

const { adminClient } = require('./config/supabase');

const {
  PORT        = 5000,
  CORS_ORIGIN = 'http://localhost:5173,http://localhost:3000',
  NODE_ENV    = 'development',
} = process.env;

const app = express();

// ── Security headers (optional) ───────────────────────────────
if (helmet) {
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
} else {
  // Minimal manual headers so browser doesn't complain
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });
}

// ── CORS ──────────────────────────────────────────────────────
const allowedOrigins = CORS_ORIGIN === '*'
  ? true
  : CORS_ORIGIN.split(',').map(o => o.trim());

app.use(cors({
  origin:       allowedOrigins,
  credentials:  true,
  methods:      ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ── Body parsing ──────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Request logging (optional) ────────────────────────────────
if (morgan && NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// ── Rate limiting (optional) ──────────────────────────────────
if (rateLimit) {
  app.use(rateLimit({
    windowMs: 60_000,
    max:      200,
    standardHeaders: true,
    legacyHeaders:   false,
    message: { error: 'Too many requests.', code: 'RATE_LIMIT' },
  }));
}

// ── Health check ──────────────────────────────────────────────
app.get('/api/health', async (_req, res) => {
  try {
    const { error } = await adminClient.from('faculties').select('id').limit(1);
    if (error) throw new Error(error.message);
    return res.json({ status: 'ok', database: 'supabase', time: new Date().toISOString() });
  } catch (err) {
    return res.status(503).json({ status: 'error', message: err.message });
  }
});

// ── API routes ─────────────────────────────────────────────────
app.use('/api/auth',             authRouter);
app.use('/api/admin',            adminRouter);
app.use('/api/department-head',  departmentHeadRouter);
app.use('/api/content',          contentRouter);
app.use('/api/motivations',      motivationsRouter);
app.use('/api/opportunities',    opportunitiesRouter);
app.use('/api/media',            mediaRouter);
app.use('/api/students',         studentsRouter);
app.use('/api/audit',            auditRouter);
app.use('/api/public',           publicRouter);
app.use('/api/departments',      departmentsRouter);

// ── 404 ────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found`, code: 'NOT_FOUND' });
});

// ── Global error handler ───────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status === 500) console.error('[Unhandled error]', err);
  res.status(status).json({
    error: err.status ? err.message : 'Internal server error',
    code:  err.code || 'INTERNAL_ERROR',
    ...(NODE_ENV !== 'production' && status === 500 ? { detail: err.message } : {}),
  });
});

// ── Start ──────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log('  ✓ Wollo Info Hub API v2');
  console.log(`  → http://localhost:${PORT}`);
  console.log(`  → Supabase: ${process.env.SUPABASE_URL}`);
  console.log(`  → CORS:     ${CORS_ORIGIN}`);
  if (!helmet)    console.log('  ⚠  helmet not installed   — run npm install');
  if (!morgan)    console.log('  ⚠  morgan not installed   — run npm install');
  if (!rateLimit) console.log('  ⚠  rate-limit not installed — run npm install');
  console.log('');
});

module.exports = app;
