import { parseDocument } from 'yaml';

// Surgical, comment-preserving edits over an agent YAML document.
//
// Why a Document (eemeli/yaml) instead of round-tripping through js-yaml.dump?
// The cortex agent YAMLs carry load-bearing comments (e.g. "# temperature must
// be omitted for opus 4.7"). js-yaml strips them on dump. parseDocument lets us
// setIn(path, value) and only the changed node is rewritten — comments,
// ordering, and indentation everywhere else are preserved verbatim.
//
// Callers should:
//   1. parseAgentDoc(yamlText) → { doc, parsed }
//   2. inspect `parsed` (a plain JS view) to populate form controls
//   3. on a form change, call updateAgentYaml(yamlText, path, value) and
//      replace the editor text with the result.

export function parseAgentDoc(yamlText) {
  try {
    const doc = parseDocument(yamlText);
    // toJS() handles the null/undefined safely and returns plain values.
    const parsed = doc.errors.length === 0 ? doc.toJS({ keepUndefined: true }) : null;
    return { doc, parsed, errors: doc.errors };
  } catch (e) {
    return { doc: null, parsed: null, errors: [e] };
  }
}

// Set one path (e.g. ['metadata', 'name']) and return the new YAML text.
// A null/undefined `value` deletes the node so we don't emit `key: null`
// where the original had no key at all.
export function updateAgentYaml(yamlText, path, value) {
  const { doc, errors } = parseAgentDoc(yamlText);
  if (!doc || errors.length > 0) return yamlText; // refuse to edit broken YAML
  if (value === null || value === undefined || value === '') {
    if (doc.hasIn(path)) doc.deleteIn(path);
  } else {
    doc.setIn(path, value);
  }
  return String(doc);
}

// Batch multiple edits in one parse/serialize cycle — important for the
// "prompt source" radio which clears two sibling keys atomically.
export function batchUpdateAgentYaml(yamlText, ops) {
  const { doc, errors } = parseAgentDoc(yamlText);
  if (!doc || errors.length > 0) return yamlText;
  for (const { path, value } of ops) {
    if (value === null || value === undefined || value === '') {
      if (doc.hasIn(path)) doc.deleteIn(path);
    } else {
      doc.setIn(path, value);
    }
  }
  return String(doc);
}

// Read a value at a path (returns undefined if missing). Used by quick-field
// form controls to populate their `value` prop.
export function getAgentValue(parsed, path) {
  let cur = parsed;
  for (const seg of path) {
    if (cur == null) return undefined;
    cur = cur[seg];
  }
  return cur;
}

// True if the current `prompt` block declares the given source key.
// Used by the radio buttons.
export function getPromptSource(parsed) {
  const p = parsed?.spec?.prompt;
  if (!p || typeof p !== 'object') return null;
  if (Object.prototype.hasOwnProperty.call(p, 'inline')) return 'inline';
  if (Object.prototype.hasOwnProperty.call(p, 'name')) return 'name';
  if (Object.prototype.hasOwnProperty.call(p, 'prompt_id')) return 'prompt_id';
  return null;
}
