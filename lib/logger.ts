// =============================================================================
// Application logger — pino, structured JSON
// =============================================================================
//
// Single source of truth for log emission. Use this instead of `console.*`
// anywhere in lib/, app/, db/, or Server Components / Route Handlers / Server
// Actions. Scripts under scripts/ are CLI utilities and stay on console.
//
// USAGE
//
//   import { log } from '@/lib/logger';
//
//   log.info('user_created', { userId });
//   log.warn('cache_miss',   { key });
//   log.error('db_query_failed', { err });   // pass `err: Error` to capture stack
//   log.debug('cache_hit',   { key });       // suppressed in production
//
//   const reqLog = log.child({ requestId, route: '/api/foo' });
//   reqLog.info('handler_start');
//
// LEVELS (default level: info in prod, debug in dev)
//
//   trace  10   not used in app code today
//   debug  20   dev only
//   info   30   normal lifecycle events
//   warn   40   recoverable anomalies (cache miss, default fallback)
//   error  50   failures the caller should know about
//   fatal  60   process-killing failures — uncaught in process.on('uncaught*')
//
// REDACTION
//
//   Sensitive fields are scrubbed before write. The active path list is below
//   in REDACT_PATHS. Add new paths when introducing new sensitive keys (e.g.
//   when HVA-25 introduces auth headers, add `req.headers["x-beakn-auth"]`).
//   Wildcards apply at one level only — `*.password` matches `obj.password`
//   and `obj.foo.password` but not `obj.foo.bar.password`. Add the deeper path
//   explicitly when needed.
//
// PRODUCTION VS DEV
//
//   NODE_ENV=production:  single-line JSON to stdout. Docker's json-file
//                          driver captures everything. `docker logs beakn-app`
//                          + log rotation handle retention.
//   NODE_ENV=development: pino-pretty transport renders human-readable lines
//                          with colour + level + timestamp on stderr.
//
// CORRELATION
//
//   proxy.ts generates `x-request-id` (nanoid 16) on every inbound request
//   and writes it back as a response header. The request log entry includes
//   it. Server Components that want to correlate their logs can call
//   `await headers().then(h => h.get('x-request-id'))` and attach via
//   `log.child({ requestId })`.
// =============================================================================

import pino, { type LoggerOptions } from 'pino';

const isProd = process.env.NODE_ENV === 'production';

// Paths scrubbed before serialisation. fast-redact under the hood.
// Wildcards match ONE level only — `*.password` matches `obj.password` but not
// `obj.foo.bar.password`. For each sensitive key we list:
//   - the literal top-level path, AND
//   - the one-level-nested `*.<key>` path,
//   - plus the common req.headers.* and headers.* shapes that show up in HTTP logs.
// Add the deeper paths explicitly when introducing a new shape.
const REDACT_PATHS = [
  // Top-level keys (direct fields on the merged log object).
  'password',
  'secret',
  'token',
  'authorization',
  'cookie',
  'apiKey',
  'api_key',
  'access_token',
  'refresh_token',

  // One-level nested under any parent.
  '*.password',
  '*.secret',
  '*.token',
  '*.authorization',
  '*.cookie',
  '*.apiKey',
  '*.api_key',
  '*.access_token',
  '*.refresh_token',

  // HTTP request shapes (req + headers).
  'headers.cookie',
  'headers.authorization',
  'headers["x-api-key"]',
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-api-key"]',
];

const baseOptions: LoggerOptions = {
  level: process.env.LOG_LEVEL ?? (isProd ? 'info' : 'debug'),
  base: {
    app: 'beakn-app',
    env: process.env.NODE_ENV ?? 'unknown',
  },
  // Default ISO timestamp; pino's epoch ms is fine for prod, but ISO is
  // easier to read in `docker logs` and downstream log shippers.
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: REDACT_PATHS,
    censor: '[REDACTED]',
  },
};

// Dev: pretty-print to stderr for human readers. Prod: raw JSON to stdout
// for Docker's json-file driver to capture.
const transport = isProd
  ? undefined
  : {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:HH:MM:ss.l',
        ignore: 'pid,hostname,app,env',
        singleLine: false,
      },
    };

export const log = pino({
  ...baseOptions,
  ...(transport ? { transport } : {}),
});

/**
 * Convenience helper for callers that have an Error in hand — passes it as
 * `err` so pino's standard serialiser captures `.message` + `.stack`.
 * Usage:
 *   logError(log, 'db_query_failed', err, { sql });
 */
export function logError(
  logger: pino.Logger,
  msg: string,
  err: unknown,
  extras: Record<string, unknown> = {},
): void {
  if (err instanceof Error) {
    logger.error({ ...extras, err }, msg);
  } else {
    logger.error({ ...extras, err: String(err) }, msg);
  }
}
