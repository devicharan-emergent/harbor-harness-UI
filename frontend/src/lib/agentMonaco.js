// Monaco bootstrap for the Cortex Agent editor.
//
// Why this file exists:
// `@monaco-editor/react` defaults to fetching `monaco-editor` from a public
// CDN (jsdelivr) using an AMD loader. On our preview infra, that cross-origin
// script load surfaces every error from monaco as an opaque "Script error."
// with no filename, lineno, or message — uncatchable by try/catch, poisonous
// to the CRA dev overlay, and impossible to diagnose.
//
// We already ship `monaco-editor` as an npm dep, so we redirect the loader
// at the locally-bundled module via `loader.config({ monaco })`. Once that's
// done, no CDN load happens and any monaco error has a real same-origin
// stack trace.
//
// We also install a same-origin no-op Web Worker as `MonacoEnvironment`
// so monaco never spawns a cross-origin worker URL (which would have the
// same opaque-error problem). For our use case — plain YAML text editing,
// no JSON/TS/JS/CSS language services — the worker is unused; the editor
// just runs on the main thread.

import agentSchema from './agentSchema.json'; // eslint-disable-line no-unused-vars

export const AGENT_MODEL_URI = 'inmemory://model/agent.yaml';

let pending = null;

// Idempotent. Returns a promise that resolves once @monaco-editor/react's
// loader is wired to the locally-bundled monaco-editor. Safe to call from
// many places; the import + init only run once.
export function bootstrapMonacoLoader() {
  if (pending) return pending;
  pending = (async () => {
    // Step 1: same-origin inline noop worker.
    if (typeof self !== 'undefined' && !self.MonacoEnvironment) {
      self.MonacoEnvironment = {
        getWorker() {
          const src = 'self.onmessage = () => {};';
          const blob = new Blob([src], { type: 'application/javascript' });
          return new Worker(URL.createObjectURL(blob));
        },
      };
    }
    // Step 2: redirect @monaco-editor/react at the local monaco-editor.
    const [{ loader }, monaco] = await Promise.all([
      import('@monaco-editor/react'),
      import('monaco-editor'),
    ]);
    loader.config({ monaco });
    await loader.init();
    // eslint-disable-next-line no-console
    console.info('[acm] monaco bound to local monaco-editor (no CDN, no cross-origin workers)');
  })().catch((err) => {
    // Reset so a later retry can attempt again (e.g. user navigates away
    // and back). Re-throw for the caller's catch chain.
    pending = null;
    // eslint-disable-next-line no-console
    console.error('[acm] monaco loader bootstrap failed', err);
    throw err;
  });
  return pending;
}

// Kept for callsite compatibility with the earlier opt-in LSP path. The
// schema-aware YAML language server (`monaco-yaml`) is intentionally not
// enabled here — it brought in cross-origin worker URLs that re-introduced
// the opaque error. Client envelope checks + server 400 mapping cover the
// validation needs we have today.
export async function ensureAgentMonacoSchema(_monaco) { /* no-op */ }
