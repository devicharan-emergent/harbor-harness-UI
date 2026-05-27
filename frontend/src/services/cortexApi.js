import axios from 'axios';
import { getApiBaseURL } from './apiBase';

// Cortex agent YAML CRUD against the BFF proxy. These endpoints are eph-scoped
// (every call needs ?eph_name=). Auth is the same `acm_session_token` query
// param as everything else — the AuthContext interceptor on the default axios
// instance handles it. We use a dedicated client so the /jobs* + /scheduled-*
// `created_by` interceptor (which lives on evalApiClient) doesn't bleed onto
// cortex requests.

const client = axios.create({
  baseURL: `${getApiBaseURL()}/api/eval/cortex`,
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000,
});

// Attach the session token as ?access_token=… on every cortex request — same
// transport as the rest of the app, just on this isolated client.
client.interceptors.request.use((config) => {
  let token = null;
  try { token = window.localStorage.getItem('acm_session_token') || null; } catch { /* ignore */ }
  if (token) {
    config.params = { ...(config.params || {}), access_token: token };
  }
  return config;
});

// All endpoints below mirror the harness contract 1:1; surface errors with
// the harness payload preserved so callers can show backend `message` verbatim.

export async function checkEphExists(ephName) {
  const r = await client.get('/ephs/exists', { params: { eph_name: ephName } });
  return r.data;
}

export async function listAgents(ephName) {
  const r = await client.get('/agents', { params: { eph_name: ephName } });
  return r.data;
}

export async function getAgent(ephName, agentId) {
  const r = await client.get(`/agents/${encodeURIComponent(agentId)}`, {
    params: { eph_name: ephName },
  });
  return r.data;
}

export async function createAgent(ephName, agentId, yamlContent) {
  const r = await client.post('/agents', { agent_id: agentId, yaml_content: yamlContent }, {
    params: { eph_name: ephName },
  });
  return r.data;
}

export async function updateAgent(ephName, agentId, yamlContent) {
  const r = await client.put(`/agents/${encodeURIComponent(agentId)}`, { yaml_content: yamlContent }, {
    params: { eph_name: ephName },
  });
  return r.data;
}

export async function deleteAgent(ephName, agentId) {
  const r = await client.delete(`/agents/${encodeURIComponent(agentId)}`, {
    params: { eph_name: ephName },
  });
  return r.data;
}

// Convenience: normalise an axios error into { status, code, message, raw }.
// The harness returns `{ error, message, code }`; FastAPI wraps it in `detail`.
export function parseCortexError(err) {
  const status = err?.response?.status ?? 0;
  const data = err?.response?.data;
  const detail = data?.detail ?? data;
  const message = detail?.message || detail?.error || err?.message || 'Unknown error';
  const code = detail?.code || (status === 0 ? 'network' : 'unknown');
  return { status, code, message, raw: detail ?? data ?? null };
}
