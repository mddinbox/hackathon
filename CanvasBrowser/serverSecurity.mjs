/**
 * Loopback gateway guards.
 *
 * The demo server binds to 127.0.0.1, but binding is not a boundary: any web
 * page can point a hostname it controls at 127.0.0.1 (DNS rebinding) and then
 * drive `/api/*` from the victim's browser, with the browser happily attaching
 * the request. The only reliable defences at this layer are:
 *
 *   1. the `Host` header must be *exactly* a loopback authority we recognise —
 *      a rebound request carries the attacker's hostname, not `127.0.0.1`;
 *   2. `Origin`, when the browser sends one, must be *exactly* the matching
 *      loopback origin — this stops a cross-site POST from a real page;
 *   3. the demo header, which forces a preflight for anything cross-origin.
 *
 * These are pure functions so they can be tested without a socket.
 */

/** The only authorities that may reach the gateway. */
export function allowedHosts(port) {
  const suffix = `:${port}`;
  return [`127.0.0.1${suffix}`, `localhost${suffix}`, `[::1]${suffix}`];
}

/** The only origins that may reach the gateway. */
export function allowedOrigins(port) {
  return allowedHosts(port).map((host) => `http://${host}`);
}

/**
 * Decides whether one `/api/*` request may proceed.
 *
 * Returns `{ ok: true }` or `{ ok: false, status, error }`. Same-origin demo
 * traffic — `Host: 127.0.0.1:4173`, `Origin: http://127.0.0.1:4173` — always
 * passes; a rebound hostname or a foreign origin never does.
 */
export function checkLoopbackRequest(headers, port) {
  const host = typeof headers?.host === 'string' ? headers.host.trim().toLowerCase() : '';
  if (!allowedHosts(port).includes(host)) {
    return { ok: false, status: 403, error: 'This gateway only answers on the loopback address.' };
  }

  const rawOrigin = headers?.origin;
  const origin = typeof rawOrigin === 'string' ? rawOrigin.trim().toLowerCase() : '';
  // A missing Origin is normal for same-origin GETs and for curl; a present
  // one has to match exactly.
  if (origin && origin !== 'null' && !allowedOrigins(port).includes(origin)) {
    return { ok: false, status: 403, error: 'Cross-origin requests are not accepted by this gateway.' };
  }
  if (origin === 'null') {
    return { ok: false, status: 403, error: 'Opaque-origin requests are not accepted by this gateway.' };
  }

  if (headers?.['x-canvas-browser-demo'] !== '1') {
    return { ok: false, status: 403, error: 'Demo gateway header is required.' };
  }
  return { ok: true };
}

/** Headers applied to every response, API or static. */
export function securityHeaders() {
  return {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'permissions-policy': 'geolocation=(self), camera=(), microphone=(), payment=(), usb=()'
  };
}

/**
 * Extra headers for the HTML document itself.
 *
 * `frame-src` is the one relaxation in this policy, and it is as narrow as the
 * feature allows: the Journey World frames a Bing Maps base so the geography
 * under the route is real, and nothing else may ever be framed. Script,
 * connect, object and form origins are untouched — the base map is a picture
 * the browser fetches for itself, not a channel into this document.
 */
export function documentHeaders() {
  return {
    'content-security-policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'",
      "frame-src 'self' https://www.bing.com https://*.bing.com",
      "form-action 'none'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "object-src 'none'"
    ].join('; ')
  };
}
