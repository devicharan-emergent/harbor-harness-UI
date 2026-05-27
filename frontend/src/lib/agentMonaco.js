// monaco-yaml schema bootstrap.
//
// CRA bundles workers via webpack 5; the Monaco worker entry must be wired
// through MonacoEnvironment so the YAML language worker can spin up. We do
// this once on module load. The `agent.json` schema is scoped to our editor's
// model URI rather than globally to keep other code paths Monaco-free.
//
// We deliberately set `format: false` so the language server never reformats
// the buffer — comment-preserving edits (eemeli/yaml-based quick fields)
// would otherwise be smashed.

import { configureMonacoYaml } from 'monaco-yaml';
import agentSchema from './agentSchema.json';

// The model URI we associate with each agent buffer. Scoping the schema to
// just this URI keeps unrelated Monaco editors (if any are added later)
// unaffected by agent-schema validation.
export const AGENT_MODEL_URI = 'inmemory://model/agent.yaml';

let installed = false;

// Lazy bootstrap. Called from AgentEditor on first mount.
export function ensureAgentMonacoSchema(monaco) {
  if (installed || !monaco) return;

  // Worker wiring — required for the YAML LSP to start under CRA/webpack 5.
  // monaco-yaml ships its own worker; we hand it back through the env hook.
  if (typeof window !== 'undefined' && !window.MonacoEnvironment) {
    window.MonacoEnvironment = {
      getWorker(_moduleId, label) {
        if (label === 'yaml') {
          return new Worker(new URL('monaco-yaml/yaml.worker.js', import.meta.url));
        }
        return new Worker(new URL('monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url));
      },
    };
  }

  configureMonacoYaml(monaco, {
    enableSchemaRequest: false,
    hover: true,
    completion: true,
    validate: true,
    format: false, // we own formatting via comment-preserving edits
    schemas: [{
      uri: 'inmemory://schema/agent.json',
      fileMatch: [AGENT_MODEL_URI],
      schema: agentSchema,
    }],
  });

  installed = true;
}
