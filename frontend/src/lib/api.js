import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const client = axios.create({
  baseURL: API,
  headers: { 'Content-Type': 'application/json' },
});

export const agentApi = {
  list: (params = {}) => client.get('/agents', { params }).then(r => r.data),
  get: (id) => client.get(`/agents/${encodeURIComponent(id)}`).then(r => r.data),
  create: (data) => client.post('/agents', data).then(r => r.data),
  update: (id, data) => client.put(`/agents/${encodeURIComponent(id)}`, data).then(r => r.data),
  delete: (id) => client.delete(`/agents/${encodeURIComponent(id)}`).then(r => r.data),
  clone: (id) => client.post(`/agents/${encodeURIComponent(id)}/clone`).then(r => r.data),
  listVersions: (id) => client.get(`/agents/${encodeURIComponent(id)}/versions`).then(r => r.data),
  getVersion: (id, version) => client.get(`/agents/${encodeURIComponent(id)}/versions/${version}`).then(r => r.data),
  restoreVersion: (id, version) => client.post(`/agents/${encodeURIComponent(id)}/versions/${version}/restore`).then(r => r.data),
};

export default agentApi;
