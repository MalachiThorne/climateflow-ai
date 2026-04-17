// Thin Sentry wrapper. All exports are safe no-ops when SENTRY_DSN is unset
// (the common case in local dev and tests) so callers don't need guards.
//
// Sensitive data scrubbing: missed-call SMS content, review bodies, and
// Stripe payloads can include customer PII or card fragments. `beforeSend`
// below strips request bodies, query strings, and cookies before the event
// leaves the process — we only keep URL path, method, and status.

const config = require("./config");

let initialized = false;
let sentry = null;

function init() {
  if (initialized) return;
  initialized = true;

  if (!config.sentry.dsn) {
    return;
  }

  try {
    sentry = require("@sentry/node");
  } catch (err) {
    console.warn("[sentry] @sentry/node not installed; error monitoring disabled. Run `npm install` in automations/.");
    return;
  }

  sentry.init({
    dsn: config.sentry.dsn,
    environment: config.sentry.environment,
    release: config.sentry.release || undefined,
    tracesSampleRate: config.sentry.tracesSampleRate,
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        delete event.request.query_string;
        if (event.request.headers) {
          delete event.request.headers.authorization;
          delete event.request.headers.cookie;
          delete event.request.headers["x-twilio-signature"];
          delete event.request.headers["stripe-signature"];
        }
      }
      return event;
    },
  });

  console.log(`[sentry] initialized (env=${config.sentry.environment})`);
}

function captureException(err, context) {
  if (!sentry) return;
  try {
    if (context) {
      sentry.withScope((scope) => {
        if (context.tags) scope.setTags(context.tags);
        if (context.extra) scope.setExtras(context.extra);
        if (context.user) scope.setUser(context.user);
        sentry.captureException(err);
      });
    } else {
      sentry.captureException(err);
    }
  } catch {
    // Never let monitoring blow up a request.
  }
}

function captureMessage(message, level = "info") {
  if (!sentry) return;
  try {
    sentry.captureMessage(message, level);
  } catch {}
}

// Express middleware. Returns a pass-through when Sentry is disabled so
// server.js can install it unconditionally.
function requestHandler() {
  if (sentry && sentry.Handlers && sentry.Handlers.requestHandler) {
    return sentry.Handlers.requestHandler();
  }
  return (req, res, next) => next();
}

function errorHandler() {
  if (sentry && sentry.Handlers && sentry.Handlers.errorHandler) {
    return sentry.Handlers.errorHandler({
      shouldHandleError(err) {
        const status = err && (err.status || err.statusCode);
        return !status || status >= 500;
      },
    });
  }
  return (err, req, res, next) => next(err);
}

// Call on graceful shutdown so buffered events flush before the process exits.
async function flush(timeoutMs = 2000) {
  if (!sentry) return;
  try {
    await sentry.close(timeoutMs);
  } catch {}
}

function isEnabled() {
  return Boolean(sentry);
}

module.exports = {
  init,
  captureException,
  captureMessage,
  requestHandler,
  errorHandler,
  flush,
  isEnabled,
};
