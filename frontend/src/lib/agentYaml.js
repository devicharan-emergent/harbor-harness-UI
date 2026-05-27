import yaml from 'js-yaml';

// Mirror the backend envelope-only validation (see Feature Brief §3). This is a
// UX convenience to enable/disable Save and show inline hints — the server is
// always authoritative. Never block on anything beyond these checks.
//
// Returns { ok: bool, parsed?: any, errors: string[] }.
//
// Optional `expectedId`: when provided we additionally enforce
// metadata.id === expectedId (mirrors the backend rule for both create and PUT).
export function validateAgentEnvelope(yamlContent, expectedId = null) {
  const errors = [];
  const text = (yamlContent ?? '').trim();
  if (!text) {
    return { ok: false, errors: ['yaml_content is empty'] };
  }
  let parsed;
  try {
    parsed = yaml.load(yamlContent);
  } catch (e) {
    return { ok: false, errors: [`malformed yaml: ${e?.message || e}`] };
  }
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, errors: ['yaml must parse to a mapping at the top level'] };
  }

  if (!parsed.apiVersion) errors.push('apiVersion is required');
  if (!parsed.kind) {
    errors.push('kind is required');
  } else if (parsed.kind !== 'Agent') {
    errors.push("kind must be 'Agent'");
  }

  const meta = parsed.metadata ?? {};
  if (!meta || typeof meta !== 'object') {
    errors.push('metadata is required');
  } else {
    if (!meta.id) errors.push('metadata.id is required');
    if (!meta.name) errors.push('metadata.name is required');
    const v = meta.version;
    if (v === undefined || v === null) {
      errors.push('metadata.version is required');
    } else if (!Number.isInteger(v) || v < 1) {
      errors.push('metadata.version must be an integer >= 1');
    }
    if (expectedId && meta.id && meta.id !== expectedId) {
      errors.push(`metadata.id ('${meta.id}') must equal agent_id ('${expectedId}')`);
    }
  }

  return { ok: errors.length === 0, parsed, errors };
}

// Rewrite metadata.id in a YAML document. Used by the "duplicate-from-existing"
// flow so the cloned YAML matches the new agent_id before it's saved.
// Falls back to a regex replace when the YAML can't be parsed (so we don't lose
// the user's content). The regex is intentionally conservative: it only
// touches the `  id: <value>` line inside a top-level `metadata:` block.
export function rewriteMetadataId(yamlContent, newId) {
  try {
    const doc = yaml.load(yamlContent);
    if (doc && typeof doc === 'object' && doc.metadata && typeof doc.metadata === 'object') {
      doc.metadata.id = newId;
      return yaml.dump(doc, { lineWidth: 120, noRefs: true, sortKeys: false });
    }
  } catch { /* fall through to regex */ }
  // eslint-disable-next-line no-useless-escape
  return yamlContent.replace(/(^\s*metadata\s*:\s*$[\s\S]*?^\s{2}id\s*:\s*)(\S+)/m, `$1${newId}`);
}

// Sensible starter template surfaced when the user clicks "New agent".
export function blankAgentYaml(agentId) {
  return `apiVersion: agents.v1
kind: Agent
metadata:
  id: ${agentId}
  name: ${agentId}
  version: 1
  description: ""
  tags: []
spec:
  model:
    provider: anthropic
    id: claude-sonnet-4-5
  prompt:
    inline: |
      You are a helpful assistant.
  toolsets: []
`;
}
