import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import axios from 'axios';

import { getApiBaseURL } from '@/services/apiBase';
const BACKEND_URL = getApiBaseURL();

const CapabilitiesContext = createContext({
  capabilities: null,
  loading: true,
  refresh: () => {},
});

export function CapabilitiesProvider({ children }) {
  const [capabilities, setCapabilities] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const response = await axios.get(`${BACKEND_URL}/api/capabilities`);
      setCapabilities(response.data);
    } catch (error) {
      console.error('Failed to fetch capabilities:', error);
      // Fallback to MongoDB-like capabilities
      setCapabilities({
        data_source: 'mongodb',
        read_only: false,
        features: {
          create: true,
          update: true,
          delete: true,
          clone: true,
          versions: true,
          restore: true,
        },
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <CapabilitiesContext.Provider value={{ capabilities, loading, refresh }}>
      {children}
    </CapabilitiesContext.Provider>
  );
}

export function useCapabilities() {
  return useContext(CapabilitiesContext);
}

export default useCapabilities;
