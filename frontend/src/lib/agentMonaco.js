// monaco-yaml schema bootstrap with same-origin blob-shim worker loader.
//
// Background: CRA + webpack 5 emits the YAML LSP as a separate worker chunk
// served from the page's CDN. On Emergent's preview infra the request path
// trampolines such that `new Worker(workerUrl)` can fail with an opaque
// CORS-tainted "Script error." Solution: wrap the real URL in a same-origin
// Blob that simply `importScripts`s it. The Blob is same-origin, so the
// browser stops poisoning the error; CORS still needs to permit
// importScripts on the CDN asset (`Access-Control-Allow-Origin` on the
// .worker.js response), which is the one infra dep.
//
// Boot signal: we intercept getWorker and listen for the worker's first
// postMessage so we log a single `[acm] yaml LSP worker booted` line. If
// you never see that line after the editor mounts, the LSP is dead and the
// schema is NOT validating (regardless of what the global error filter
// might have swallowed). Don't assume — verify.
//
// Disable with: localStorage.setItem('acm_cortex_disable_yaml_lsp','1')

import agentSchema from './agentSchema.json';

export const AGENT_MODEL_URI = 'inmemory://model/agent.yaml';

let installed = false;

function lspDisabled() {
  try {
    return window.localStorage.getItem('acm_cortex_disable_yaml_lsp') === '1';
  } catch { return false; }
}

// Build a same-origin Blob worker that importScripts the real (possibly
// cross-origin) URL. Returns the blob URL; caller is responsible for the
// Worker constructor. We don't revoke the URL — the Worker holds it for its
// lifetime and revoking too early kills the worker on Safari.
function blobShimUrl(realUrl) {
  const abs = new URL(realUrl, window.location.href).toString();
  const src = `importScripts(${JSON.stringify(abs)});`;
  return URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
}

function makeWorker(realUrl, label) {
  try {
    // Same-origin direct load first — cheapest if it works.
    const isSameOrigin = (() => {
      try {
        const u = new URL(realUrl, window.location.href);
        return u.origin === window.location.origin;
      } catch { return false; }
    })();
    if (isSameOrigin) {
      const w = new Worker(realUrl);
      attachBootLog(w, label, 'same-origin');
      return w;
    }
    // Cross-origin (CDN) → blob shim.
    const shim = blobShimUrl(realUrl);
    const w = new Worker(shim);
    attachBootLog(w, label, 'blob-shim');
    return w;
  } catch (e) {
    console.warn('[agentMonaco] worker construction failed', label, e);
    return null;
  }
}

// Log first message from the worker. We don't read the payload — Monaco's
// workers send opaque LSP messages — we only care that *something* came
// back, which proves the worker booted and can talk to the main thread.
function attachBootLog(worker, label, via) {
  if (!worker || !worker.addEventListener) return;
  let logged = false;
  const onAlive = () => {
    if (logged) return;
    logged = true;
    console.info(`[acm] yaml LSP worker booted (${label}, ${via})`);
    worker.removeEventListener('message', onAlive);
    worker.removeEventListener('error', onErr);
  };
  const onErr = (e) => {
    if (logged) return;
    console.warn(`[acm] yaml LSP worker errored before first message (${label}, ${via})`, e?.message || e);
  };
  worker.addEventListener('message', onAlive);
  worker.addEventListener('error', onErr);
}

export async function ensureAgentMonacoSchema(monaco) {
  if (installed || !monaco) return;
  installed = true;
  if (lspDisabled()) {
    console.info('[acm] yaml LSP disabled via localStorage flag');
    return;
  }

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
      console.info('[acm] yaml LSP configured (worker boot is async — look for "booted" log next)');
    }
  } catch (e) {
    console.warn('[agentMonaco] LSP bootstrap failed', e);
  }
}
