const BASE = '/api';

async function request(url, options = {}) {
  try {
    const res = await fetch(`${BASE}${url}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Request failed' }));
      console.error(`API error [${options.method || 'GET'} ${url}]:`, err);
      throw new Error(err.error || 'Request failed');
    }
    return res.json();
  } catch (e) {
    console.error(`API request failed [${options.method || 'GET'} ${url}]:`, e.message);
    throw e;
  }
}

export const fetchState = () => request('/state');
export const updateState = (data) => request('/state', { method: 'PUT', body: data });
export const getThread = (id) => request(`/threads/${id}`);
export const createThread = (data) => request('/threads', { method: 'POST', body: data });
export const updateThread = (id, data) => request(`/threads/${id}`, { method: 'PUT', body: data });
export const deleteThread = (id) => request(`/threads/${id}`, { method: 'DELETE' });
export const addLogEntry = (id, entry) => request(`/threads/${id}/log`, { method: 'POST', body: entry });
export const editLogEntry = (id, logId, data) => request(`/threads/${id}/log/${logId}`, { method: 'PUT', body: data });
export const deleteLogEntry = (id, logId) => request(`/threads/${id}/log/${logId}`, { method: 'DELETE' });
export const promoteToFocus = (id) => request(`/promote/${id}`, { method: 'POST' });
export const demoteToUndercurrent = (id) => request(`/demote/${id}`, { method: 'POST' });
export const updateThreadStatus = (id, status) => request(`/threads/${id}/status`, { method: 'POST', body: { status } });
export const fetchReviewData = () => request('/review');
export const fetchTeams = () => request('/teams');
export const reorderFocus = (id, index) => request('/focus/reorder', { method: 'POST', body: { id, index } });
export const fetchPeople = () => request('/people');
export const evolveThread = (id, data) => request(`/threads/${id}/evolve`, { method: 'POST', body: data });
export const swapFocusStaged = (demoteId, promoteId) => request('/swap', { method: 'POST', body: { demoteId, promoteId } });
export const stagedToOutOfFocus = (id) => request(`/staged-to-oof/${id}`, { method: 'POST' });
