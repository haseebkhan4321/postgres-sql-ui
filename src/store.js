const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const DATA_DIR = process.env.POSTADMIN_DATA ||
  path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'PostAdmin');
const CONN_FILE = path.join(DATA_DIR, 'connections.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const HISTORY_MAX = 200;

fs.mkdirSync(DATA_DIR, { recursive: true });

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function listConnections() {
  return readJson(CONN_FILE, []);
}

function getConnection(id) {
  return listConnections().find(c => c.id === id) || null;
}

function saveConnection({ id, name, uri, color }) {
  const all = listConnections();
  if (id) {
    const existing = all.find(c => c.id === id);
    if (!existing) return null;
    Object.assign(existing, { name, uri, color, updatedAt: new Date().toISOString() });
    writeJson(CONN_FILE, all);
    return existing;
  }
  const conn = { id: crypto.randomUUID(), name, uri, color: color || '#336791', createdAt: new Date().toISOString() };
  all.push(conn);
  writeJson(CONN_FILE, all);
  return conn;
}

function deleteConnection(id) {
  const all = listConnections();
  const next = all.filter(c => c.id !== id);
  writeJson(CONN_FILE, next);
  return next.length !== all.length;
}

function listHistory(connId) {
  const all = readJson(HISTORY_FILE, []);
  return connId ? all.filter(h => h.connId === connId) : all;
}

function addHistory(entry) {
  const all = readJson(HISTORY_FILE, []);
  all.unshift({ ...entry, at: new Date().toISOString() });
  writeJson(HISTORY_FILE, all.slice(0, HISTORY_MAX));
}

function clearHistory(connId) {
  const all = readJson(HISTORY_FILE, []);
  writeJson(HISTORY_FILE, connId ? all.filter(h => h.connId !== connId) : []);
}

module.exports = {
  DATA_DIR, listConnections, getConnection, saveConnection, deleteConnection,
  listHistory, addHistory, clearHistory,
};
