import express from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';
import { kv } from '@vercel/kv';

const app = express();
app.use(cors());
app.use(express.json());

// --- KV Helpers ---

async function getState() {
  const state = await kv.get('focus:state');
  return state || { focusOrder: [], undercurrent: [], lastTouched: null };
}

async function saveState(state) {
  await kv.set('focus:state', state);
}

async function getThread(id) {
  const thread = await kv.get(`thread:${id}`);
  if (!thread) throw new Error(`Thread ${id} not found`);
  return thread;
}

async function saveThread(thread) {
  await kv.set(`thread:${thread.id}`, thread);
  await kv.sadd('threads', thread.id);
}

async function deleteThread(id) {
  await kv.del(`thread:${id}`);
  await kv.srem('threads', id);
}

async function getAllThreads() {
  const ids = await kv.smembers('threads');
  if (!ids.length) return [];
  const threads = await Promise.all(ids.map(id => kv.get(`thread:${id}`)));
  return threads.filter(Boolean);
}

// --- Utils ---

function getCurrentWeek() {
  const now = new Date();
  const jan1 = new Date(now.getFullYear(), 0, 1);
  const days = Math.floor((now - jan1) / 86400000);
  const weekNum = Math.ceil((days + jan1.getDay() + 1) / 7);
  return `${now.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function getWeekLabel() {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  return monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// --- Routes ---

app.get('/api/state', async (req, res) => {
  try {
    const state = await getState();
    const focusThreads = [];
    for (const id of state.focusOrder) {
      try { focusThreads.push(await getThread(id)); } catch { /* missing, skip */ }
    }
    const allThreads = await getAllThreads();
    res.json({ ...state, focusThreads, allThreads, currentWeek: getCurrentWeek(), weekLabel: getWeekLabel() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/state', async (req, res) => {
  try {
    const state = await getState();
    const updated = { ...state, ...req.body };
    await saveState(updated);
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/teams', async (req, res) => {
  try {
    const threads = await getAllThreads();
    const teams = new Set(threads.map(t => t.team).filter(Boolean));
    res.json([...teams].sort());
  } catch (e) {
    res.json([]);
  }
});

app.get('/api/people', async (req, res) => {
  try {
    const threads = await getAllThreads();
    const pms = new Set(), engLeads = new Set(), uxPartners = new Set();
    for (const t of threads) {
      if (t.pm) pms.add(t.pm);
      if (t.engLead) engLeads.add(t.engLead);
      if (t.uxPartner) uxPartners.add(t.uxPartner);
    }
    res.json({ pms: [...pms].sort(), engLeads: [...engLeads].sort(), uxPartners: [...uxPartners].sort() });
  } catch (e) {
    res.json({ pms: [], engLeads: [], uxPartners: [] });
  }
});

app.get('/api/threads/:id', async (req, res) => {
  try {
    res.json(await getThread(req.params.id));
  } catch {
    res.status(404).json({ error: 'Thread not found' });
  }
});

app.post('/api/threads', async (req, res) => {
  try {
    const state = await getState();
    const id = randomUUID().slice(0, 8);
    const now = new Date().toISOString();
    const stream = req.body.stream || 'undercurrent';

    if (stream === 'undercurrent' && state.undercurrent.length >= 4) {
      return res.status(400).json({ error: 'Staged is full (max 4). Move items to Out of Focus first.' });
    }

    const thread = {
      id, title: req.body.title || 'Untitled', status: 'active',
      type: req.body.type || 'weekly', team: req.body.team || '',
      category: req.body.category || '', workType: req.body.workType || '',
      summary: req.body.summary || '', kpi: req.body.kpi || '',
      pm: req.body.pm || '', engLead: req.body.engLead || '',
      uxPartner: req.body.uxPartner || '', linkedTo: req.body.linkedTo || null,
      state: req.body.state || '', nextAction: req.body.nextAction || '',
      resumeLink: req.body.resumeLink || '', stream, tags: req.body.tags || [],
      createdAt: now, updatedAt: now, weekCreated: getCurrentWeek(),
      quarterStart: req.body.quarterStart || null, quarterEnd: req.body.quarterEnd || null,
      log: []
    };

    await saveThread(thread);

    if (stream === 'focus') {
      state.focusOrder.push(id);
    } else {
      state.undercurrent.push({ id, title: thread.title, tag: req.body.tags?.[0] || 'explore', createdAt: now });
    }

    state.lastTouched = id;
    await saveState(state);
    res.status(201).json(thread);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/focus/reorder', async (req, res) => {
  try {
    const state = await getState();
    const { id, index } = req.body;
    state.focusOrder = state.focusOrder.filter(fid => fid !== id);
    state.focusOrder.splice(index, 0, id);
    await saveState(state);
    res.json({ ok: true, focusOrder: state.focusOrder });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/threads/:id/evolve', async (req, res) => {
  try {
    const thread = await getThread(req.params.id);
    const now = new Date().toISOString();
    const parts = [];
    if (req.body.state) parts.push(`State: ${req.body.state}`);
    if (req.body.nextAction) parts.push(`Next: ${req.body.nextAction}`);
    if (parts.length > 0) {
      thread.log.push({ id: randomUUID().slice(0, 8), type: 'progress', content: parts.join(' → '), date: thread.updatedAt || now });
    }
    thread.updatedAt = now;
    await saveThread(thread);
    const state = await getState();
    state.lastTouched = thread.id;
    await saveState(state);
    res.json(thread);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/threads/:id', async (req, res) => {
  try {
    const thread = await getThread(req.params.id);
    const updated = { ...thread, ...req.body, id: thread.id, log: thread.log, updatedAt: new Date().toISOString() };
    await saveThread(updated);
    const state = await getState();
    state.lastTouched = thread.id;
    if (req.body.title) {
      const ucItem = state.undercurrent.find(u => u.id === thread.id);
      if (ucItem) ucItem.title = req.body.title;
    }
    await saveState(state);
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/threads/:id', async (req, res) => {
  try {
    const state = await getState();
    state.focusOrder = state.focusOrder.filter(id => id !== req.params.id);
    state.undercurrent = state.undercurrent.filter(u => u.id !== req.params.id);
    if (state.lastTouched === req.params.id) state.lastTouched = state.focusOrder[0] || null;
    await saveState(state);
    await deleteThread(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/threads/:id/log', async (req, res) => {
  try {
    const thread = await getThread(req.params.id);
    const entry = { id: randomUUID().slice(0, 8), type: req.body.type || 'note', content: req.body.content || '', date: new Date().toISOString() };
    if (req.body.blocking) entry.blocking = req.body.blocking;
    if (req.body.resolutionDate) entry.resolutionDate = req.body.resolutionDate;
    if (req.body.depStatus) entry.depStatus = req.body.depStatus;
    thread.log.push(entry);
    thread.updatedAt = new Date().toISOString();
    await saveThread(thread);
    const state = await getState();
    state.lastTouched = thread.id;
    await saveState(state);
    res.status(201).json(entry);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/threads/:id/log/:logId', async (req, res) => {
  try {
    const thread = await getThread(req.params.id);
    const entry = thread.log.find(e => e.id === req.params.logId);
    if (!entry) return res.status(404).json({ error: 'Log entry not found' });
    if (req.body.type) entry.type = req.body.type;
    if (req.body.content !== undefined) entry.content = req.body.content;
    if (req.body.answer !== undefined) entry.answer = req.body.answer;
    if (req.body.evidence !== undefined) entry.evidence = req.body.evidence;
    if (req.body.blocking !== undefined) entry.blocking = req.body.blocking;
    if (req.body.resolutionDate !== undefined) entry.resolutionDate = req.body.resolutionDate;
    if (req.body.depStatus !== undefined) entry.depStatus = req.body.depStatus;
    if (req.body.date) entry.date = req.body.date;
    thread.updatedAt = new Date().toISOString();
    await saveThread(thread);
    res.json(entry);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/threads/:id/log/:logId', async (req, res) => {
  try {
    const thread = await getThread(req.params.id);
    thread.log = thread.log.filter(e => e.id !== req.params.logId);
    thread.updatedAt = new Date().toISOString();
    await saveThread(thread);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/promote/:id', async (req, res) => {
  try {
    const state = await getState();
    state.undercurrent = state.undercurrent.filter(u => u.id !== req.params.id);
    if (!state.focusOrder.includes(req.params.id)) state.focusOrder.push(req.params.id);
    const thread = await getThread(req.params.id);
    thread.stream = 'focus';
    thread.updatedAt = new Date().toISOString();
    await saveThread(thread);
    state.lastTouched = req.params.id;
    await saveState(state);
    res.json(thread);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/demote/:id', async (req, res) => {
  try {
    const state = await getState();
    const alreadyStaged = state.undercurrent.some(u => u.id === req.params.id);
    if (!alreadyStaged && state.undercurrent.length >= 4) {
      return res.status(400).json({ error: 'Staged is full (max 4). Move items to Out of Focus first.' });
    }
    state.focusOrder = state.focusOrder.filter(id => id !== req.params.id);
    const thread = await getThread(req.params.id);
    state.undercurrent = state.undercurrent.filter(u => u.id !== req.params.id);
    state.undercurrent.unshift({ id: thread.id, title: thread.title, tag: thread.tags?.[0] || 'explore', createdAt: thread.createdAt });
    thread.stream = 'undercurrent';
    thread.updatedAt = new Date().toISOString();
    await saveThread(thread);
    await saveState(state);
    res.json(thread);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/swap', async (req, res) => {
  try {
    const { demoteId, promoteId } = req.body;
    const state = await getState();
    state.focusOrder = state.focusOrder.filter(id => id !== demoteId);
    state.undercurrent = state.undercurrent.filter(u => u.id !== promoteId);
    if (!state.focusOrder.includes(promoteId)) state.focusOrder.push(promoteId);
    const demoteThread = await getThread(demoteId);
    state.undercurrent = state.undercurrent.filter(u => u.id !== demoteId);
    state.undercurrent.unshift({ id: demoteThread.id, title: demoteThread.title, tag: demoteThread.tags?.[0] || 'explore', createdAt: demoteThread.createdAt });
    demoteThread.stream = 'undercurrent';
    demoteThread.updatedAt = new Date().toISOString();
    await saveThread(demoteThread);
    const promoteThread = await getThread(promoteId);
    promoteThread.stream = 'focus';
    promoteThread.updatedAt = new Date().toISOString();
    await saveThread(promoteThread);
    state.lastTouched = promoteId;
    await saveState(state);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/staged-to-oof/:id', async (req, res) => {
  try {
    const state = await getState();
    state.undercurrent = state.undercurrent.filter(u => u.id !== req.params.id);
    if (!state.focusOrder.includes(req.params.id)) state.focusOrder.push(req.params.id);
    const thread = await getThread(req.params.id);
    thread.stream = 'focus';
    thread.updatedAt = new Date().toISOString();
    await saveThread(thread);
    await saveState(state);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/threads/:id/status', async (req, res) => {
  try {
    const thread = await getThread(req.params.id);
    thread.status = req.body.status;
    thread.updatedAt = new Date().toISOString();
    await saveThread(thread);
    if (req.body.status === 'completed' || req.body.status === 'dropped') {
      const state = await getState();
      state.focusOrder = state.focusOrder.filter(id => id !== thread.id);
      state.undercurrent = state.undercurrent.filter(u => u.id !== thread.id);
      await saveState(state);
    }
    res.json(thread);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/review', async (req, res) => {
  try {
    const threads = await getAllThreads();
    threads.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    res.json({ threads });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default app;
