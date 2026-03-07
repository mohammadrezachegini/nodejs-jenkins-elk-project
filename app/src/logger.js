/**
 * logger.js — Structured JSON logging with Winston
 *
 * Why JSON? Filebeat picks up these logs from the container stdout
 * and ships them to Logstash. Logstash parses JSON automatically —
 * no grok patterns needed.
 *
 * Log fields:
 *   timestamp  — ISO 8601 (used by Kibana for time-based queries)
 *   level      — error / warn / info / debug
 *   service    — service name (for filtering in Kibana when multi-service)
 *   message    — log message
 *   traceId    — injected by OTel middleware (links log ↔ trace in Jaeger)
 *   spanId     — injected by OTel middleware
 *   ...rest    — any extra fields passed at call site
 */

'use strict';

const { createLogger, format, transports } = require('winston');

const SERVICE_NAME = process.env.OTEL_SERVICE_NAME || 'nodejs-product-catalog';

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
    format.errors({ stack: true }),     // include stack trace for errors
    format.json()                        // output as JSON for ELK
  ),
  defaultMeta: { service: SERVICE_NAME },
  transports: [
    new transports.Console(),
  ],
});

// In development, also log human-readable colorized output
if (process.env.NODE_ENV === 'development') {
  logger.add(new transports.Console({
    format: format.combine(
      format.colorize(),
      format.simple()
    ),
    // Don't double-log — remove the JSON console added above
    silent: false,
  }));
}

module.exports = logger;
