/**
 * middleware/requestLogger.js
 *
 * Injects the active OTel traceId + spanId into every log line.
 * This is the key that lets you correlate a log entry in Kibana
 * with a trace in Jaeger — just click the traceId.
 *
 * How it works:
 *   1. OTel auto-instrumentation creates a span for each HTTP request
 *   2. We read the active span context from OTel API
 *   3. We add traceId + spanId to res.locals so any downstream logger can use them
 */

'use strict';

const { trace, context } = require('@opentelemetry/api');
const logger = require('../logger');

function requestLogger(req, res, next) {
  const span = trace.getActiveSpan();
  const spanContext = span?.spanContext();

  // Store trace context in res.locals for access in route handlers
  res.locals.traceId = spanContext?.traceId;
  res.locals.spanId = spanContext?.spanId;

  const startTime = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const logLevel = res.statusCode >= 500 ? 'error'
      : res.statusCode >= 400 ? 'warn'
      : 'info';

    logger[logLevel]('HTTP request', {
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: duration,
      userAgent: req.get('user-agent'),
      ip: req.ip,
      // These two fields link log → trace in Kibana/Jaeger
      traceId: res.locals.traceId,
      spanId: res.locals.spanId,
    });
  });

  next();
}

module.exports = { requestLogger };
