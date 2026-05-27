// Map a server-side 400 message ("metadata.id must equal agent_id", "malformed
// yaml: line 7", "metadata.version must be an integer >= 1", etc.) to the
// physical location in the YAML buffer so we can install a Monaco marker on
// the offending node + tint the right quick-field row.
//
// Returns: { line: 1-indexed | null, column: 1-indexed | null, fieldPath: string[] | null }.
//
// Heuristic — never throws. If we can't pin a location we still surface the
// message in the footer (already wired), but we won't fight the user with a
// random squiggle.

const FIELD_PATTERNS = [
  // Backend envelope rules (server.go-ish error.go names) plus the few we
  // know are top-N from cortex.
  { re: /metadata\.id\b/i,       path: ['metadata', 'id']       },
  { re: /metadata\.name\b/i,     path: ['metadata', 'name']     },
  { re: /metadata\.version\b/i,  path: ['metadata', 'version']  },
  { re: /apiVersion\b/i,         path: ['apiVersion']           },
  { re: /kind\b/i,               path: ['kind']                 },
  { re: /spec\.model\.provider/i, path: ['spec','model','provider'] },
  { re: /spec\.model\.id/i,       path: ['spec','model','id']       },
  { re: /spec\.prompt/i,          path: ['spec','prompt']           },
];

// Parse `malformed yaml: line N column M: …` style messages emitted by
// js-yaml/go-yaml. Falls back to whatever fragment looks numeric.
function parseMalformedYaml(msg) {
  const m1 = /line\s+(\d+)(?:[,\s]+column\s+(\d+))?/i.exec(msg);
  if (m1) {
    return {
      line: parseInt(m1[1], 10) || null,
      column: m1[2] ? parseInt(m1[2], 10) : 1,
    };
  }
  return { line: null, column: null };
}

// Locate the line at which a given dotted-path key sits in the YAML buffer.
// We don't re-parse the YAML — a simple indentation-aware textual walk is
// good enough for envelope fields and avoids dragging js-yaml/eemeli into
// this code path. Returns null if not found.
export function findPathLine(yamlText, path) {
  if (!yamlText || !path?.length) return null;
  const lines = yamlText.split(/\r?\n/);
  let depth = -1; // current matched depth into `path`
  let baseIndent = -1;

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    if (!raw || /^\s*#/.test(raw)) continue;
    const m = /^(\s*)([\w$.-]+)\s*:/.exec(raw);
    if (!m) continue;
    const indent = m[1].length;
    const key = m[2];

    if (depth === -1) {
      if (key === path[0]) {
        depth = 0;
        baseIndent = indent;
        if (path.length === 1) return i + 1;
        continue;
      }
    } else if (indent <= baseIndent && key !== path[depth]) {
      // walked past the current subtree without matching the next segment
      return null;
    } else if (indent > baseIndent && key === path[depth + 1]) {
      depth += 1;
      baseIndent = indent;
      if (depth === path.length - 1) return i + 1;
    }
  }
  return null;
}

export function locateServerError(message, yamlText) {
  if (!message) return { line: null, column: null, fieldPath: null };

  if (/malformed\s+yaml/i.test(message)) {
    const loc = parseMalformedYaml(message);
    return { ...loc, fieldPath: null };
  }

  for (const { re, path } of FIELD_PATTERNS) {
    if (re.test(message)) {
      const line = findPathLine(yamlText, path);
      return { line, column: 1, fieldPath: path };
    }
  }
  return { line: null, column: null, fieldPath: null };
}
