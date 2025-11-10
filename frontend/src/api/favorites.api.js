// /api/favorites.api.js

import { requestJson, normalizePath } from './http';

async function fetchFavorites() {
  return requestJson('/api/favorites', { method: 'GET' });
}

async function addFavorite(path, icon) {
  const normalizedPath = normalizePath(path || '');
  return requestJson('/api/favorites', {
    method: 'POST',
    body: JSON.stringify({
      path: normalizedPath,
      icon,
    }),
  });
}

async function removeFavorite(path) {
  const normalizedPath = normalizePath(path || '');
  return requestJson('/api/favorites', {
    method: 'DELETE',
    body: JSON.stringify({
      path: normalizedPath,
    }),
  });
}

export {
  fetchFavorites,
  addFavorite,
  removeFavorite
}