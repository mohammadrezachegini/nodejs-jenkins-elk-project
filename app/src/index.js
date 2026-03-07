/**
 * index.js — Application entry point
 *
 * IMPORTANT: tracing.js MUST be the very first require.
 * OTel patches modules at import time — if Express or MongoDB
 * loads before the SDK starts, they won't be instrumented.
 */

'use strict';

// ── 1. Start OTel SDK before anything else ─────────────────────────────────
require('./tracing');

// ── 2. Load remaining dependencies ────────────────────────────────────────
require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const helmet = require('helmet');
const morgan = require('morgan');
const { trace, context } = require('@opentelemetry/api');

const logger = require('./logger');
const productRoutes = require('./routes/products');
const { requestLogger } = require('./middleware/requestLogger');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/products';

// ── 3. Security & parsing middleware ──────────────────────────────────────
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── 4. HTTP request logging (injects traceId into each log line) ──────────
app.use(requestLogger);

// Morgan for access logs in Apache combined format (also to stdout → Filebeat)
app.use(morgan('combined', {
  stream: {
    write: (message) => logger.http(message.trim()),
  },
}));

// ── 5. Routes ──────────────────────────────────────────────────────────────
app.use('/api/products', productRoutes);

// Health check — used by K8s liveness/readiness probes
app.get('/health', (req, res) => {
  const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    database: dbStatus,
    timestamp: new Date().toISOString(),
  });
});

// ── 6. Global error handler ────────────────────────────────────────────────
app.use(errorHandler);

// ── 7. Connect to MongoDB and start server ─────────────────────────────────
async function start() {
  try {
    await mongoose.connect(MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
    });
    logger.info('MongoDB connected', { uri: MONGO_URI });

    const server = app.listen(PORT, () => {
      logger.info(`Server started`, { port: PORT, env: process.env.NODE_ENV });
    });

    // Graceful shutdown on SIGTERM (K8s sends this before killing the pod)
    process.on('SIGTERM', async () => {
      logger.info('SIGTERM received — shutting down gracefully');
      server.close(async () => {
        await mongoose.connection.close();
        logger.info('HTTP server and MongoDB connection closed');
        process.exit(0);
      });
    });

    return server;
  } catch (err) {
    logger.error('Failed to start server', { error: err.message });
    process.exit(1);
  }
}

// Only call start() when running directly — not when required by tests
if (require.main === module) {
  start();
}

module.exports = { app, start };
