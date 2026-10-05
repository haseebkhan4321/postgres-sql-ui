const express = require('express');
const { getPool } = require('../pools');
const { ident, qualified, wrap } = require('../sql');

const router = express.Router({ mergeParams: true });

const TYPE_RE = /^[A-Za-z_][\w\s\[\]().,"]*$/;
const KINDS = { table: 'TABLE', view: 'VIEW', matview: 'MATERIALIZED VIEW', sequence: 'SEQUENCE', foreign: 'FOREIGN TABLE' };

function fail(message) {
  const err = new Error(message);
  err.status = 400;
  throw err;
}

function need(value, label) {
  if (value === undefined || value === null || String(value).trim() === '') fail(`${label} is required`);
  return String(value).trim();
}

function type(t) {
  t = need(t, 'Column type');
  if (!TYPE_RE.test(t)) fail(`Invalid type "${t}"`);
  return t;
}

function columnSql(c) {
  let s = `${ident(need(c.name, 'Column name'))} ${type(c.type)}`;
  if (c.default !== undefined && c.default !== null && String(c.default).trim() !== '') s += ` DEFAULT ${c.default}`;
  if (c.nullable === false) s += ' NOT NULL';
  return s;
}

// Each builder returns { statements, transactional }.
const builders = {
  create_table(b) {
    const cols = b.columns || [];
    if (!cols.length) fail('At least one column is required');
    const lines = cols.map(columnSql);
    const pk = cols.filter(c => c.pk).map(c => ident(c.name));
    if (pk.length) lines.push(`PRIMARY KEY (${pk.join(', ')})`);
    return [`CREATE TABLE ${qualified(need(b.schema, 'Schema'), need(b.table, 'Table name'))} (\n  ${lines.join(',\n  ')}\n)`];
  },
  drop_relation(b) {
    const kw = KINDS[b.kind || 'table'] || fail('Unknown object kind');
    return [`DROP ${kw} ${qualified(need(b.schema, 'Schema'), need(b.table, 'Name'))}${b.cascade ? ' CASCADE' : ''}`];
  },
  truncate_table(b) {
    return [`TRUNCATE ${qualified(need(b.schema, 'Schema'), need(b.table, 'Table'))}` +
      `${b.restart ? ' RESTART IDENTITY' : ''}${b.cascade ? ' CASCADE' : ''}`];
  },
  rename_table(b) {
    const kw = KINDS[b.kind || 'table'] || fail('Unknown object kind');
    return [`ALTER ${kw} ${qualified(need(b.schema, 'Schema'), need(b.table, 'Table'))} RENAME TO ${ident(need(b.newName, 'New name'))}`];
  },
  add_column(b) {
    return [`ALTER TABLE ${qualified(need(b.schema, 'Schema'), need(b.table, 'Table'))} ADD COLUMN ${columnSql(b.column || {})}`];
  },
  drop_column(b) {
    return [`ALTER TABLE ${qualified(need(b.schema, 'Schema'), need(b.table, 'Table'))} DROP COLUMN ${ident(need(b.name, 'Column'))}${b.cascade ? ' CASCADE' : ''}`];
  },
  alter_column(b) {
    const rel = qualified(need(b.schema, 'Schema'), need(b.table, 'Table'));
    const col = ident(need(b.name, 'Column'));
    const out = [];
    if (b.type) out.push(`ALTER TABLE ${rel} ALTER COLUMN ${col} TYPE ${type(b.type)}${b.using ? ` USING ${b.using}` : ''}`);
    if (b.nullable === true) out.push(`ALTER TABLE ${rel} ALTER COLUMN ${col} DROP NOT NULL`);
    if (b.nullable === false) out.push(`ALTER TABLE ${rel} ALTER COLUMN ${col} SET NOT NULL`);
    if (b.default === null) out.push(`ALTER TABLE ${rel} ALTER COLUMN ${col} DROP DEFAULT`);
    else if (b.default !== undefined && String(b.default).trim() !== '') out.push(`ALTER TABLE ${rel} ALTER COLUMN ${col} SET DEFAULT ${b.default}`);
    if (b.comment !== undefined) out.push(`COMMENT ON COLUMN ${rel}.${col} IS ${b.comment === '' ? 'NULL' : `'${String(b.comment).replace(/'/g, "''")}'`}`);
    if (b.newName && b.newName !== b.name) out.push(`ALTER TABLE ${rel} RENAME COLUMN ${col} TO ${ident(b.newName)}`);
    if (!out.length) fail('Nothing to change');
    return out;
  },
  create_index(b) {
    const cols = (b.columns || []).filter(Boolean);
    if (!cols.length) fail('Pick at least one column');
    const method = (b.method || 'btree').toLowerCase();
    if (!['btree', 'hash', 'gin', 'gist', 'brin', 'spgist'].includes(method)) fail('Unknown index method');
    const name = b.name ? ` ${ident(b.name)}` : '';
    return [`CREATE ${b.unique ? 'UNIQUE ' : ''}INDEX${name} ON ${qualified(need(b.schema, 'Schema'), need(b.table, 'Table'))} USING ${method} (${cols.map(ident).join(', ')})`];
  },
  drop_index(b) {
    return [`DROP INDEX ${qualified(need(b.schema, 'Schema'), need(b.name, 'Index'))}`];
  },
  drop_constraint(b) {
    return [`ALTER TABLE ${qualified(need(b.schema, 'Schema'), need(b.table, 'Table'))} DROP CONSTRAINT ${ident(need(b.name, 'Constraint'))}`];
  },
  create_schema(b) {
    return [`CREATE SCHEMA ${ident(need(b.name, 'Schema name'))}`];
  },
  drop_schema(b) {
    return [`DROP SCHEMA ${ident(need(b.name, 'Schema'))}${b.cascade ? ' CASCADE' : ''}`];
  },
  create_database(b) {
    return [`CREATE DATABASE ${ident(need(b.name, 'Database name'))}`];
  },
  drop_database(b) {
    return [`DROP DATABASE ${ident(need(b.name, 'Database'))} WITH (FORCE)`];
  },
};

const NON_TRANSACTIONAL = new Set(['create_database', 'drop_database']);

router.post('/db/:db/ddl', wrap(async (req, res) => {
  const { action, preview } = req.body;
  const build = builders[action];
  if (!build) fail(`Unknown action "${action}"`);
  const statements = build(req.body);
  const sql = statements.map(s => s + ';').join('\n');
  if (preview) return res.json({ sql });

  // Dropping the database you're connected to isn't allowed, so database ops use the connection's default DB.
  const db = NON_TRANSACTIONAL.has(action) ? undefined : req.params.db;
  const client = await getPool(req.params.id, db).connect();
  try {
    if (NON_TRANSACTIONAL.has(action)) {
      for (const s of statements) await client.query(s);
    } else {
      await client.query('BEGIN');
      for (const s of statements) await client.query(s);
      await client.query('COMMIT');
    }
    res.json({ ok: true, sql });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    err.sql = sql;
    throw err;
  } finally {
    client.release();
  }
}));

module.exports = router;
