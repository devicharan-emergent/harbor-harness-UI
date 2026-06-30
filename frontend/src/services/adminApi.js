import { authAxios } from '@/contexts/AuthContext';

// Admin allow-list management. All endpoints are admin-gated server-side
// (require_admin → 403 {error:'not_admin'} otherwise). authAxios targets
// getApiBaseURL()/api and appends the access_token.

export const listAdminUsers = async () => {
  const { data } = await authAxios.get('/admin/users');
  return data;
};

export const addAdminUser = async (email, role = 'member') => {
  const { data } = await authAxios.post('/admin/users', { email, role });
  return data;
};

export const updateAdminUser = async (email, patch) => {
  const { data } = await authAxios.patch(`/admin/users/${encodeURIComponent(email)}`, patch);
  return data;
};

export const removeAdminUser = async (email) => {
  const { data } = await authAxios.delete(`/admin/users/${encodeURIComponent(email)}`);
  return data;
};

// Pull a friendly message out of an axios error from these endpoints.
export const adminErrorMessage = (err, fallback = 'Something went wrong') => {
  const d = err?.response?.data?.detail;
  if (typeof d === 'string') return d;
  if (d?.message) return d.message;
  return fallback;
};
