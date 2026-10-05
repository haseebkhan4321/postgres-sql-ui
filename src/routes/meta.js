const express = require('express');
const { getPool, defaultDatabase } = require('../pools');
const store = require('../store');
const { qualified, wrap } = require('../sql');

const router = express.Router({ mergeParams: true });

const pool = req => getPool(req.params.id, req.params.db);

router.get('/info', wrap(async (req, res) => {
  const conn = store.getConnection(req.params.id);
  if (!conn) return res.status(404).json({ error: 'Connection not found' });
  const { rows } = await getPool(req.params.id).query(
    "SELECT version() AS version, current_user AS user, current_setting('server_version') AS server_version");
  res.json({ name: conn.name, color: conn.color, defaultDatabase: defaultDatabase(conn.uri), ...rows[0] });
}));

router.get('/databases', wrap(async (req, res) => {
  const { rows } = await getPool(req.params.id).query(`
    SELECT datname AS name,
           CASE WHEN has_database_privilege(datname, 'CONNECT') THEN pg_database_size(oid) END AS size,
           pg_encoding_to_char(encoding) AS encoding, datcollate AS collation,
           has_database_privilege(datname, 'CONNECT') AS can_connect
    FROM pg_database WHERE NOT datistemplate AND datallowconn ORDER BY datname`);
  res.json(rows);
}));

router.get('/db/:db/schemas', wrap(async (req, res) => {
  const { rows } = await pool(req).query(`
    SELECT n.nspname AS name, pg_get_userbyid(n.nspowner) AS owner,
           (n.nspname IN ('pg_catalog', 'information_schema') OR n.nspname LIKE 'pg\\_%') AS system,
           (SELECT count(*)::int FROM pg_class c WHERE c.relnamespace = n.oid AND c.relkind IN ('r', 'p')) AS tables
    FROM pg_namespace n
    WHERE n.nspname NOT LIKE 'pg\\_toast%' AND n.nspname NOT LIKE 'pg\\_temp\\_%'
    ORDER BY system, (n.nspname <> 'public'), n.nspname`);
  res.json(rows);
}));

router.get('/db/:db/schemas/:schema/objects', wrap(async (req, res) => {
  const p = pool(req);
  const [rels, funcs] = await Promise.all([
    p.query(`
      SELECT c.relname AS name,
             CASE c.relkind WHEN 'r' THEN 'table' WHEN 'p' THEN 'table' WHEN 'v' THEN 'view'
               WHEN 'm' THEN 'matview' WHEN 'S' THEN 'sequence' WHEN 'f' THEN 'foreign' END AS kind,
             GREATEST(c.reltuples, 0)::bigint AS estimate,
             CASE WHEN c.relkind IN ('r', 'p', 'm') THEN pg_total_relation_size(c.oid) END AS size,
             obj_description(c.oid, 'pg_class') AS comment
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f') AND NOT c.relispartition
      ORDER BY c.relname`, [req.params.schema]),
    p.query(`
      SELECT p.proname AS name, pg_get_function_identity_arguments(p.oid) AS args,
             CASE p.prokind WHEN 'p' THEN 'procedure' ELSE 'function' END AS kind
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = $1 AND p.prokind IN ('f', 'p')
      ORDER BY p.proname`, [req.params.schema]),
  ]);
  res.json({ relations: rels.rows, functions: funcs.rows });
}));

// Accepts a Pool (queries run in parallel) or a single Client (queries must run one at a time).
async function tableStructure(p, schema, table) {
  const rel = qualified(schema, table);
  const isPool = typeof p.totalCount === 'number';
  const runAll = isPool
    ? thunks => Promise.all(thunks.map(t => t()))
    : async thunks => { const out = []; for (const t of thunks) out.push(await t()); return out; };
  const [info, columns, indexes, constraints, pk] = await runAll([
    () => p.query(`
      SELECT c.relkind, GREATEST(c.reltuples, 0)::bigint AS estimate,
             pg_total_relation_size(c.oid) AS total_size, pg_relation_size(c.oid) AS data_size,
             obj_description(c.oid, 'pg_class') AS comment, pg_get_userbyid(c.relowner) AS owner,
             CASE WHEN c.relkind IN ('v', 'm') THEN pg_get_viewdef(c.oid, true) END AS view_def
      FROM pg_class c WHERE c.oid = $1::regclass`, [rel]),
    () => p.query(`
      SELECT a.attnum AS num, a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type,
             NOT a.attnotnull AS nullable, pg_get_expr(d.adbin, d.adrelid) AS "default",
             a.attidentity AS identity, a.attgenerated AS generated,
             col_description(a.attrelid, a.attnum) AS comment, t.typcategory AS category
      FROM pg_attribute a
      JOIN pg_type t ON t.oid = a.atttypid
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY a.attnum`, [rel]),
    () => p.query(`
      SELECT i.relname AS name, pg_get_indexdef(x.indexrelid) AS definition,
             x.indisunique AS unique, x.indisprimary AS primary,
             pg_relation_size(x.indexrelid) AS size,
             EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conindid = x.indexrelid AND k.conrelid = x.indrelid) AS constraint_backed
      FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid
      WHERE x.indrelid = $1::regclass ORDER BY x.indisprimary DESC, i.relname`, [rel]),
    () => p.query(`
      SELECT conname AS name, contype AS type, pg_get_constraintdef(oid, true) AS definition
      FROM pg_constraint WHERE conrelid = $1::regclass
      ORDER BY CASE contype WHEN 'p' THEN 0 WHEN 'u' THEN 1 WHEN 'f' THEN 2 ELSE 3 END, conname`, [rel]),
    () => p.query(`
      SELECT a.attname AS name
      FROM pg_index x
      JOIN LATERAL unnest(x.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
      JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = k.attnum
      WHERE x.indrelid = $1::regclass AND x.indisprimary
      ORDER BY k.ord`, [rel]),
  ]);
  return {
    schema, table,
    ...info.rows[0],
    columns: columns.rows,
    indexes: indexes.rows,
    constraints: constraints.rows,
    primaryKey: pk.rows.map(r => r.name),
  };
}

router.get('/db/:db/schemas/:schema/tables/:table/structure', wrap(async (req, res) => {
  res.json(await tableStructure(pool(req), req.params.schema, req.params.table));
}));

// Tables, columns and foreign keys for the ER diagram. ?schemas=a,b (default: all non-system schemas).
router.get('/db/:db/erd', wrap(async (req, res) => {
  const p = pool(req);
  let schemas = String(req.query.schemas || '').split(',').filter(Boolean);
  if (!schemas.length) {
    const { rows } = await p.query(`
      SELECT nspname FROM pg_namespace
      WHERE nspname NOT IN ('pg_catalog', 'information_schema') AND nspname NOT LIKE 'pg\\_%'`);
    schemas = rows.map(r => r.nspname);
  }
  const [columns, fks] = await Promise.all([
    p.query(`
      SELECT n.nspname AS schema, c.relname AS table, a.attname AS name,
             format_type(a.atttypid, a.atttypmod) AS type, NOT a.attnotnull AS nullable,
             (pk.attnum IS NOT NULL) AS pk, obj_description(c.oid, 'pg_class') AS comment
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      LEFT JOIN LATERAL (
        SELECT k.attnum FROM pg_index x, unnest(x.indkey) AS k(attnum)
        WHERE x.indrelid = c.oid AND x.indisprimary AND k.attnum = a.attnum
      ) pk ON true
      WHERE n.nspname = ANY($1) AND c.relkind IN ('r', 'p') AND NOT c.relispartition
      ORDER BY n.nspname, c.relname, a.attnum`, [schemas]),
    p.query(`
      SELECT k.conname AS name,
             sn.nspname AS from_schema, sc.relname AS from_table,
             tn.nspname AS to_schema, tc.relname AS to_table,
             ARRAY(SELECT a.attname FROM unnest(k.conkey) WITH ORDINALITY u(n, o)
                   JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = u.n ORDER BY u.o)::text[] AS from_columns,
             ARRAY(SELECT a.attname FROM unnest(k.confkey) WITH ORDINALITY u(n, o)
                   JOIN pg_attribute a ON a.attrelid = k.confrelid AND a.attnum = u.n ORDER BY u.o)::text[] AS to_columns
      FROM pg_constraint k
      JOIN pg_class sc ON sc.oid = k.conrelid JOIN pg_namespace sn ON sn.oid = sc.relnamespace
      JOIN pg_class tc ON tc.oid = k.confrelid JOIN pg_namespace tn ON tn.oid = tc.relnamespace
      WHERE k.contype = 'f' AND sn.nspname = ANY($1)
      ORDER BY sc.relname, k.conname`, [schemas]),
  ]);

  const tables = new Map();
  for (const c of columns.rows) {
    const key = `${c.schema}.${c.table}`;
    if (!tables.has(key)) tables.set(key, { schema: c.schema, name: c.table, comment: c.comment, columns: [] });
    tables.get(key).columns.push({ name: c.name, type: c.type, nullable: c.nullable, pk: c.pk });
  }
  res.json({ schemas, tables: [...tables.values()], foreignKeys: fks.rows });
}));

router.get('/db/:db/schemas/:schema/functions/:name', wrap(async (req, res) => {
  const { rows } = await pool(req).query(`
    SELECT p.proname AS name, pg_get_function_identity_arguments(p.oid) AS args,
           pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = $1 AND p.proname = $2 AND p.prokind IN ('f', 'p')`, [req.params.schema, req.params.name]);
  res.json(rows);
}));

module.exports = router;
module.exports.tableStructure = tableStructure;
