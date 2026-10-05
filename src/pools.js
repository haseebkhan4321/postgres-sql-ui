const { Pool, types } = require('pg');
const { parse } = require('pg-connection-string');
const store = require('./store');

// Keep precision: return raw text for bigint, numeric, dates and timestamps.
const RAW = [20, 1700, 1082, 1083, 1114, 1184, 1266];
for (const oid of RAW) types.setTypeParser(oid, v => v);

const pools = new Map(); // key: `${connId}:${db}` -> Pool

// Accept SQLAlchemy-style schemes such as postgresql+asyncpg:// or postgresql+psycopg2://.
function normalizeUri(uri) {
  return String(uri).trim().replace(/^postgres(ql)?\+[\w-]+:\/\//i, 'postgresql://');
}

function buildConfig(uri, database) {
  const cfg = parse(normalizeUri(uri));
  if (database) cfg.database = database;
  // Many hosted providers (Neon, Supabase, RDS) need SSL but use certs Node can't verify by default.
  if (cfg.ssl === true || (cfg.ssl && typeof cfg.ssl === 'object' && cfg.ssl.rejectUnauthorized === undefined)) {
    cfg.ssl = { rejectUnauthorized: false };
  }
  return {
    ...cfg,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    application_name: 'PostAdmin',
  };
}

function defaultDatabase(uri) {
  return parse(normalizeUri(uri)).database || 'postgres';
}

function getPool(connId, database) {
  const conn = store.getConnection(connId);
  if (!conn) {
    const err = new Error('Connection not found');
    err.status = 404;
    throw err;
  }
  const db = database || defaultDatabase(conn.uri);
  const key = `${connId}:${db}`;
  let pool = pools.get(key);
  if (!pool) {
    pool = new Pool(buildConfig(conn.uri, db));
    pool.on('error', () => {}); // idle client errors shouldn't crash the server
    pools.set(key, pool);
  }
  return pool;
}

async function closePools(connId) {
  for (const [key, pool] of pools) {
    if (key.startsWith(connId + ':')) {
      pools.delete(key);
      await pool.end().catch(() => {});
    }
  }
}

async function testUri(uri) {
  const pool = new Pool({ ...buildConfig(uri), max: 1 });
  try {
    const { rows } = await pool.query('SELECT version() AS version, current_database() AS database, current_user AS user');
    return rows[0];
  } finally {
    await pool.end().catch(() => {});
  }
}

module.exports = { getPool, closePools, testUri, defaultDatabase, normalizeUri };
