import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || '';

const client = axios.create({
  baseURL: `${BACKEND_URL}/api/eval`,
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000,
});

// List all scheduled batches (optionally filter to enabled only)
export const listScheduledBatches = async (enabledOnly = false) => {
  const params = enabledOnly ? { enabled: 'true' } : {};
  const response = await client.get('/scheduled-batches', { params });
  return response.data;
};

// Get one batch by ID
export const getScheduledBatch = async (batchId) => {
  const response = await client.get(`/scheduled-batches/${batchId}`);
  return response.data;
};

// Create a new batch
// Body: { name, cron_expression, problem_ids: string[], enabled?: bool }
export const createScheduledBatch = async (data) => {
  const response = await client.post('/scheduled-batches', data);
  return response.data;
};

// Update any subset of fields
// Body: { name?, cron_expression?, problem_ids?, enabled? }
export const updateScheduledBatch = async (batchId, data) => {
  const response = await client.put(`/scheduled-batches/${batchId}`, data);
  return response.data;
};

// Hard-delete a batch
export const deleteScheduledBatch = async (batchId) => {
  const response = await client.delete(`/scheduled-batches/${batchId}`);
  return response.data;
};

// Manually fire a batch now (returns {batch_id, eval_job_ids[]})
export const triggerScheduledBatch = async (batchId) => {
  const response = await client.post(`/scheduled-batches/${batchId}/trigger`);
  return response.data;
};
