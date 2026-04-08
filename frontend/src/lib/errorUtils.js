/**
 * Parse API error responses into user-friendly messages.
 * Handles: Builder API errors ({path, message}), Pydantic errors ({loc, msg}),
 * Go backend strings, and plain error messages.
 */

const FIELD_LABELS = {
  'spec.prompt': 'Prompt',
  'spec.model': 'Model',
  'spec.model.id': 'Model ID',
  'spec.model.provider': 'Model Provider',
  'spec.policy.timeout': 'Timeout',
  'spec.toolsets': 'Toolsets',
  'spec.overrides': 'Overrides',
  'spec': 'Agent Config',
  'problem_statement': 'Problem Statement',
  'natural_language_tests': 'Test Cases',
  'dataset_type': 'Dataset Type',
  'instance_id': 'Instance ID',
};

function friendlyField(raw) {
  if (!raw) return '';
  const path = Array.isArray(raw) ? raw.filter(x => x !== 'body').join('.') : String(raw);
  return FIELD_LABELS[path] || path.split('.').pop().replace(/_/g, ' ');
}

function parseOneError(e) {
  // Builder API format: {path, message}
  if (e.message) {
    return e.message;
  }
  // Pydantic format: {loc, msg}
  if (e.msg) {
    const field = friendlyField(e.loc);
    const msg = e.msg.replace(/^Value error,?\s*/i, '').replace(/^Assertion failed,?\s*/i, '');
    return field ? `${field}: ${msg}` : msg;
  }
  return null;
}

export function parseApiError(error, fallback = 'Something went wrong') {
  const raw = error?.response?.data?.detail;

  if (!raw) return error?.message || fallback;

  // Plain string
  if (typeof raw === 'string') {
    if (raw.includes('cannot unmarshal')) {
      const fieldMatch = raw.match(/field\s+\S+\.(\w+)\s+of/);
      const field = fieldMatch ? friendlyField(fieldMatch[1]) : 'a field';
      return `Invalid format for ${field}. Please check the value and try again.`;
    }
    if (raw.startsWith('invalid request:')) {
      return raw.replace('invalid request: ', '').replace(/^json:\s*/, '');
    }
    return raw;
  }

  // Array of errors
  if (Array.isArray(raw)) {
    const messages = raw.map(parseOneError).filter(Boolean);
    const unique = [...new Set(messages)];
    if (unique.length === 0) return fallback;
    if (unique.length <= 3) return unique.join('. ');
    return `${unique.slice(0, 2).join('. ')} (+${unique.length - 2} more issues)`;
  }

  // Single error object
  if (typeof raw === 'object') {
    return parseOneError(raw) || raw.message || raw.msg || fallback;
  }

  return fallback;
}
