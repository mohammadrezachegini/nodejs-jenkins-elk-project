/**
 * middleware/errorHandler.js — Global Express error handler
 *
 * All unhandled errors from route handlers flow here via next(err).
 * We log the error (with traceId) and return a consistent JSON response.
 */

'use strict';

const logger = require('../logger');

function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || err.status || 500;

  logger.error('Unhandled error', {
    message: err.message,
    stack: err.stack,
    statusCode,
    method: req.method,
    url: req.originalUrl,
    traceId: res.locals.traceId,
    spanId: res.locals.spanId,
  });

  // Don't expose stack traces in production
  const response = {
    error: statusCode >= 500 ? 'Internal server error' : err.message,
  };

  if (process.env.NODE_ENV === 'development') {
    response.stack = err.stack;
  }

  res.status(statusCode).json(response);
}

module.exports = { errorHandler };
