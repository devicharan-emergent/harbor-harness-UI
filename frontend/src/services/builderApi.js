import axios from 'axios';

// Use our FastAPI backend as proxy
const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || '';

const builderApiClient = axios.create({
  baseURL: `${BACKEND_URL}/api/builder`,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

// ============ Health Check ============

/**
 * Health check for Builder API
 */
export const checkBuilderHealth = async () => {
  try {
    const response = await builderApiClient.get('/health', { timeout: 5000 });
    return { healthy: response.data.healthy };
  } catch (error) {
    return { healthy: false, error: error.message };
  }
};

export default builderApiClient;
