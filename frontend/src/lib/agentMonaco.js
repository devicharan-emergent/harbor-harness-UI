// monaco-yaml schema bootstrap — currently disabled.
//
// Why: the preview infra trampolines requests between *.stage-preview.* and
// *.internal.stage-preview.*, which makes the YAML LSP Web Worker fire an
// opaque, CORS-tainted "Script error" on load. Because the worker emits its
// failure asynchronously through window.onerror, no try/catch around the
// configure call can swallow it — and CRA's dev overlay surfaces it as a
// page-blocking modal.
//
// Trade-off accepted for now: no inline schema squiggles in Monaco. The other
// validation layers still cover the real cases:
//   - client-side envelope check (validateAgentEnvelope) → instant footer hint
//   - quick-fields enum dropdowns (provider/squashing/etc.) → can't pick bad
//   - server 400 → quick-field red border + Monaco squiggle (locateServerError)
//
// To opt in (e.g. for local debugging where origins match):
//   localStorage.setItem('acm_cortex_enable_yaml_lsp', '1') && reload.

import agentSchema from './agentSchema.json';

export const AGENT_MODEL_URI = 'inmemory://model/agent.yaml';

let installed = false;

function lspEnabled() {
  try {
    return window.localStorage.getItem('acm_cortex_enable_yaml_lsp') === '1';
  } catch { return false; }
}

export async function ensureAgentMonacoSchema(monaco) {
  if (installed || !monaco) return;
  installed = true;
  if (!lspEnabled()) {
    // Stay silent — this is the default.
    return;
  }

  // Opt-in path. Wrap everything so a failure still leaves a usable editor.
  try {
    if (typeof window !== 'undefined' && !window.MonacoEnvironment) {
      window.MonacoEnvironment = {
        getWorker(_moduleId, label) {
          try {
            if (label === 'yaml') {
              return new Worker(new URL('monaco-yaml/yaml.worker.js', import.meta.url));
            }
            return new Worker(new URL('monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url));
          } catch (e) {
            console.warn('[agentMonaco] worker build failed', label, e);
            return null;
          }
        },
      };
    }
    const mod = await import('monaco-yaml');
    if (mod?.configureMonacoYaml) {
      mod.configureMonacoYaml(monaco, {
        enableSchemaRequest: false,
        hover: true,
        completion: true,
        validate: true,
        format: false,
        schemas: [{
          uri: 'inmemory://schema/agent.json',
          fileMatch: [AGENT_MODEL_URI],
          schema: agentSchema,
        }],
      });
    }
  } catch (e) {
    console.warn('[agentMonaco] LSP bootstrap failed', e);
  }
}
