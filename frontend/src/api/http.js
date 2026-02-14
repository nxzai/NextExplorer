const DEFAULT_API_BASE = '/';
const apiBase = (import.meta.env.VITE_API_URL || DEFAULT_API_BASE).replace(/\/$/, '');

const buildUrl = (endpoint) => `${apiBase}${endpoint}`;

let errorHandler = null;
export const setErrorHandler = (handler) => {
  errorHandler = handler;
};

const encodePath = (relativePath = '') => {
  if (!relativePath) return '';
  return relativePath.split('/').filter(Boolean).map(encodeURIComponent).join('/');
};

const normalizePath = (relativePath = '') => {
  if (!relativePath) {
    return '';
  }
  // Remove leading and trailing slashes
  return relativePath.replace(/^\/+|\/+$/g, '');
};

const requestRaw = async (endpoint, options = {}) => {
  const method = (options.method || 'GET').toUpperCase();
  const headers = {
    ...(options.headers || {}),
  };

  if (method !== 'GET' && method !== 'HEAD' && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  // Add guest session header if present
  const guestSessionId = sessionStorage.getItem('guestSessionId');
  if (guestSessionId) {
    headers['X-Guest-Session'] = guestSessionId;
  }

  try {
    const response = await fetch(buildUrl(endpoint), {
      credentials: options.credentials || 'include', // All requests rely on cookies
      ...options,
      method,
      headers,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const error = errorData?.error;

      const errorInfo = {
        statusCode: response.status,
        ...(typeof error === 'object' ? error : { message: error || `Request failed with status ${response.status}` }),
      };

      const translatedMessage = errorHandler?.(errorInfo) || errorInfo.message;
      throw new Error(translatedMessage);
    }

    return response;
  } catch (error) {
    if (error instanceof TypeError) {
      const translatedMessage = errorHandler?.({
        message: 'Network Error',
        details: 'Failed to connect to server. This is often caused by a PUBLIC_URL/CORS mismatch or a reverse proxy configuration issue.',
      }) || 'Network Error';
      throw new Error(translatedMessage);
    }
    throw error;
  }
};

const requestJson = async (endpoint, options = {}) => {
  const response = await requestRaw(endpoint, options);
  if (response.status === 204) {
    return null;
  }
  return response.json();
};

export { apiBase, buildUrl, encodePath, normalizePath, requestJson, requestRaw };
