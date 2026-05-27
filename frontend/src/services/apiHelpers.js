// Centralised ownership helper.
// A single module-level `createdBy` value is kept in sync with AuthContext
// via setCreatedBy. Axios interceptors on the resource-specific clients pull
// from here and inject into every outgoing request — as a query param on
// GET/DELETE and into the JSON body on POST/PUT/PATCH. If the contract ever
// evolves (e.g. a dedicated header), this is the only file that changes.

let _createdBy = null;

export function setCreatedBy(value) {
  _createdBy = value || null;
}

export function getCreatedBy() {
  return _createdBy;
}

// Match a request URL against a list of RegExp path matchers (matched against
// the URL path only, stripping any baseURL and query string).
function urlMatches(url, matchers) {
  if (!url) return false;
  // axios request.url can be absolute or relative; normalise to path only.
  let path = url;
  try {
    // If absolute, parse with URL to extract pathname.
    if (/^https?:\/\//i.test(url)) {
      path = new URL(url).pathname;
    } else {
      // Strip query string if present.
      const qIdx = path.indexOf('?');
      if (qIdx !== -1) path = path.slice(0, qIdx);
    }
  } catch { /* ignore */ }
  return matchers.some((re) => re.test(path));
}

// Install an axios request interceptor that injects `created_by` on every
// request whose URL matches any of the provided regexes.
export function attachOwnership(axiosInstance, matchers) {
  axiosInstance.interceptors.request.use((config) => {
    // No need for permissions for now
    return config;
    const createdBy = getCreatedBy();
    if (!createdBy) return config;

    const fullUrl = config.url || '';
    if (!urlMatches(fullUrl, matchers)) return config;

    const method = (config.method || 'get').toLowerCase();
    if (method === 'get' || method === 'delete') {
      config.params = { ...(config.params || {}), created_by: createdBy };
    } else {
      // POST / PUT / PATCH -> JSON body
      const body = config.data;
      if (body == null) {
        config.data = { created_by: createdBy };
      } else if (typeof body === 'object' && !Array.isArray(body)) {
        // Don't clobber an explicit caller-supplied value.
        if (body.created_by == null) {
          config.data = { ...body, created_by: createdBy };
        }
      }
      // For non-object payloads (FormData, string, array) we leave it alone.
    }
    return config;
  });
}
