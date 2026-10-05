const express = require('express');
const { getPool } = require('../pools');
const store = require('../store');
const { wrap } = require('../sql');

const router = express.Router({ mergeParams: true });

const MAX_ROWS = 1000;

function displayValue(v) {
  if (v === null || v === undefined) return null;
  if (Buffer.isBuffer(v)) return '\\x' + v.toString('hex');
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function shapeResult(r, duration) {
  const fields = (r.fields || []).map(f => ({ name: f.name, typeId: f.dataTypeID }));
  const rows = (r.rows || []).slice(0, MAX_ROWS).map(row => fields.map((f, i) => displayValue(row[i])));
  return {
    command: r.command,
    rowCount: r.rowCount,
    fields,
    rows,
    truncated: (r.rows || []).length > MAX_ROWS,
    duration,
  };
}

router.post('/db/:db/query', wrap(async (req, res) => {
  const sql = String(req.body.sql || '');
  if (!sql.trim()) return res.status(400).json({ error: 'SQL is empty' });

  const p = getPool(req.params.id, req.params.db);
  const client = await p.connect();
  const started = Date.now();
  let ok = false;
  try {
    // rowMode 'array' keeps duplicate column names (e.g. joins selecting two "id" columns).
    const out = await client.query({ text: sql, rowMode: 'array' });
    const duration = Date.now() - started;
    const results = (Array.isArray(out) ? out : [out]).map(r => shapeResult(r, duration));
    ok = true;
    res.json({ results, duration });
  } finally {
    store.addHistory({ connId: req.params.id, db: req.params.db, sql, ok, duration: Date.now() - started });
    // Destroy the client so a dangling BEGIN or session SET never leaks into later requests.
    client.release(true);
  }
}));

router.get('/history', (req, res) => {
  res.json(store.listHistory(req.params.id));
});

router.delete('/history', (req, res) => {
  store.clearHistory(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
