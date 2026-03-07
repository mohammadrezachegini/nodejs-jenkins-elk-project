/**
 * tracing.js — OpenTelemetry instrumentation
 * This file MUST be required first, before any other imports.
 *
 * Environment variables:
 *   OTEL_EXPORTER_OTLP_ENDPOINT  — collector endpoint (default: http://localhost:4318)
 *   OTEL_SERVICE_NAME            — service name in Jaeger (default: nodejs-product-catalog)
 */

'use strict';

const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');

const SERVICE_NAME = process.env.OTEL_SERVICE_NAME || 'nodejs-product-catalog';
const OTEL_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318';

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({
    url: `${OTEL_ENDPOINT}/v1/traces`,
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-http': {
        enabled: true,
        // Ignore health check spans — they add noise in Jaeger
        ignoreIncomingRequestHook: (req) => {
          return req.url === '/health' || req.url === '/metrics';
        },
      },
      '@opentelemetry/instrumentation-express': { enabled: true },
      // Disabled: OTel MongoDB instrumentation conflicts with the mongodb driver
      // bundled inside mongoose — they are different versions and the patch
      // breaks the internal wire protocol, causing "make is not a function" errors.
      // HTTP + Express traces still show all API calls end-to-end.
      '@opentelemetry/instrumentation-mongodb': { enabled: false },
      // Disable noisy low-level instrumentations
      '@opentelemetry/instrumentation-dns': { enabled: false },
      '@opentelemetry/instrumentation-net': { enabled: false },
      '@opentelemetry/instrumentation-fs': { enabled: false },
    }),
  ],
});

sdk.start();

console.log(`[OTel] Tracing started — service: ${SERVICE_NAME}, endpoint: ${OTEL_ENDPOINT}`);

process.on('SIGTERM', () => {
  sdk.shutdown()
    .then(() => console.log('[OTel] SDK shut down successfully'))
    .catch((err) => console.error('[OTel] Error during shutdown', err))
    .finally(() => process.exit(0));
});

module.exports = sdk;