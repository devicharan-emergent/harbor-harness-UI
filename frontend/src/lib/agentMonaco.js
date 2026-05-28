// monaco-yaml schema bootstrap — opt-in.
//
// Why the dynamic-import is itself gated:
// react-scripts 5.0.1's webpack 5 config doesn't reliably emit the worker
// chunk that `new URL('monaco-yaml/yaml.worker.js', import.meta.url)`
// requires. When the chunk 404s the failure surfaces as an opaque
// "Script error." with no usable filename — uncatchable by try/catch and
// poisonous to the dev overlay. Loading `monaco-yaml` at all installs the
// MonacoEnvironment hook globally, so even a try/caught configure call
// already runs the bad code path.
//
// Until we serve the worker assets same-origin (or pin the CORS header on a
// CDN we control), the schema-aware LSP stays opt-in:
//   localStorage.setItem('acm_cortex_enable_yaml_lsp','1') && reload
//
// In the OFF path everything is a no-op — Monaco loads as plain YAML, and
// the validation layers that already cover the real cases stay intact:
//   - client envelope check     (validateAgentEnvelope)
//   - quick-fields enum dropdowns
//   - server 400 → quick-field red border + Monaco squiggle (located)

import agentSchema from './agentSchema.json';

export const AGENT_MODEL_URI = 'inmemory://model/agent.yaml';

let installed = false;

function lspEnabled() {
  try {
    return window.localStorage.getItem('acm_cortex_enable_yaml_lsp') === '1';
  } catch { return false; }
}

// Same-origin blob shim — used only when the opt-in flag is set.
function blobShimUrl(realUrl) {
  const abs = new URL(realUrl, window.location.href).toString();
  const src = `importScripts(${JSON.stringify(abs)});`;
  return URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
}

function makeWorker(realUrl, label) {
  try {
    const sameOrigin = (() => {
      try { return new URL(realUrl, window.location.href).origin === window.location.origin; }
      catch { return false; }
    })();
    const w = new Worker(sameOrigin ? realUrl : blobShimUrl(realUrl));
    w.addEventListener('message', function onAlive() {
      console.info(`[acm] yaml LSP worker booted (${label}, ${sameOrigin ? 'same-origin' : 'blob-shim'})`);
      w.removeEventListener('message', onAlive);
    }, { once: false });
    return w;
  } catch (e) {
    console.warn('[agentMonaco] worker construction failed', label, e);
    return null;
  }
}

export async function ensureAgentMonacoSchema(monaco) {
  if (installed || !monaco) return;
  installed = true;

  if (!lspEnabled()) {
    // Default path. Stay completely silent — no monaco-yaml import, no
    // MonacoEnvironment install, no workers.
    return;
  }

  console.info('[acm] yaml LSP opt-in flag detected — bootstrapping');
  try {
    if (typeof window !== 'undefined' && !window.MonacoEnvironment) {
      window.MonacoEnvironment = {
        getWorker(_moduleId, label) {
          const url = label === 'yaml'
            ? new URL('monaco-yaml/yaml.worker.js', import.meta.url).toString()
            : new URL('monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url).toString();
          return makeWorker(url, label);
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
      console.info('[acm] yaml LSP configured');
    }
  } catch (e) {
    console.warn('[agentMonaco] LSP bootstrap failed', e);
  }
}
