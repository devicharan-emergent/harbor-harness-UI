// Resolve the API base URL at runtime.
//
// In production/local the env var and window.location.origin match and this
// is a no-op. On Emergent's stage-preview infra, however, the HTML is
// 307-redirected from <slug>.stage-preview.emergentagent.com to
// <slug>.internal.stage-preview.emergentagent.com while REACT_APP_BACKEND_URL
// still points at the public host. Calling the public host from JS then
// becomes a cross-origin XHR that gets 307-trampolined back — and browsers
// reject the redirect's CORS response (ACAO:* injected at the edge, Origin
// becomes `null` after the redirect taint). Using the page's own origin keeps
// every /api/* call same-origin; the ingress routes `/api` to the backend
// transparently.
//
// We still prefer REACT_APP_BACKEND_URL when the page origin is the same
// canonical host, so nothing changes for dev or real deployments.

const envBackend = (process.env.REACT_APP_BACKEND_URL || '').replace(/\/$/, '');

export function getApiBaseURL() {
  if (typeof window === 'undefined') return envBackend;
  const pageOrigin = window.location.origin;
  // If env is unset, or page origin matches env, use env (or origin).
  if (!envBackend) return pageOrigin;
  if (pageOrigin === envBackend) return envBackend;
  // Page has been redirected to a different origin (e.g. preview internal
  // host). Stay same-origin to avoid cross-origin XHR entirely.
  return pageOrigin;
}
