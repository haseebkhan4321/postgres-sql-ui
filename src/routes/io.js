const express = require('express');
const multer = require('multer');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { from: copyFrom, to: copyTo } = require('pg-copy-streams');
const { getPool } = require('../pools');
const { ident, qualified, literal, wrap } = require('../sql');
const { tableStructure } = require('./meta');

const router = express.Router({ mergeParams: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 512 * 1024 * 1024 } });

const FETCH_SIZE = 1000;
const INSERT_BATCH = 100;

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function attachment(res, filename, type) {
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}"`);
}

// res.write with backpressure so huge exports don't buffer in memory.
function writer(res) {
  return chunk => (res.write(chunk) ? Promise.resolve() : new Promise(r => res.once('drain', r)));
}

// Pipes a COPY TO stream into the response without pipeline(), which would destroy `res` on error
// and leave no way to report it.
function copyToResponse(stream, res) {
  return new Promise((resolve, reject) => {
    stream.once('error', err => { stream.unpipe(res); reject(err); });
    stream.once('end', resolve);
    stream.pipe(res);
  });
}

function stamp() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

// --- SQL dump -------------------------------------------------------------

async function ownedSequences(client, rel) {
  const { rows } = await client.query(`
    SELECT n.nspname AS schema, s.relname AS name, format_type(q.seqtypid, NULL) AS type,
           q.seqincrement AS increment, q.seqmin AS min, q.seqmax AS max, q.seqstart AS start
    FROM pg_depend d
    JOIN pg_class s ON s.oid = d.objid AND s.relkind = 'S'
    JOIN pg_namespace n ON n.oid = s.relnamespace
    JOIN pg_sequence q ON q.seqrelid = s.oid
    WHERE d.refobjid = $1::regclass AND d.deptype = 'a'`, [rel]);
  return rows;
}

function columnDef(c) {
  let def = `  ${ident(c.name)} ${c.type}`;
  if (c.identity) def += ` GENERATED ${c.identity === 'a' ? 'ALWAYS' : 'BY DEFAULT'} AS IDENTITY`;
  else if (c.generated === 's') def += ` GENERATED ALWAYS AS (${c.default}) STORED`;
  else if (c.default !== null) def += ` DEFAULT ${c.default}`;
  if (!c.nullable) def += ' NOT NULL';
  return def;
}

async function dumpRelation(client, write, s, opts, deferred) {
  const rel = qualified(s.schema, s.table);
  const isView = s.relkind === 'v' || s.relkind === 'm';
  await write(`\n--\n-- ${isView ? 'View' : 'Table'}: ${rel}\n--\n\n`);

  if (opts.structure) {
    if (isView) {
      const kw = s.relkind === 'm' ? 'MATERIALIZED VIEW' : 'VIEW';
      if (opts.drop) await write(`DROP ${kw} IF EXISTS ${rel} CASCADE;\n`);
      deferred.views.push(`CREATE ${kw} ${rel} AS\n${s.view_def.trim().replace(/;$/, '')};\n`);
      return;
    }
    const sequences = await ownedSequences(client, rel);
    if (opts.drop) await write(`DROP TABLE IF EXISTS ${rel} CASCADE;\n`);
    for (const q of sequences) {
      await write(`CREATE SEQUENCE IF NOT EXISTS ${qualified(q.schema, q.name)} AS ${q.type} ` +
        `INCREMENT ${q.increment} MINVALUE ${q.min} MAXVALUE ${q.max} START ${q.start};\n`);
    }
    const lines = s.columns.map(columnDef);
    for (const k of s.constraints) {
      if (k.type === 'f') deferred.foreignKeys.push(`ALTER TABLE ${rel} ADD CONSTRAINT ${ident(k.name)} ${k.definition};`);
      else if (k.type !== 'n') lines.push(`  CONSTRAINT ${ident(k.name)} ${k.definition}`);
    }
    await write(`CREATE TABLE ${rel} (\n${lines.join(',\n')}\n);\n`);
    for (const q of sequences) {
      const col = s.columns.find(c => c.default && c.default.includes(q.name));
      if (col) await write(`ALTER SEQUENCE ${qualified(q.schema, q.name)} OWNED BY ${rel}.${ident(col.name)};\n`);
    }
    for (const i of s.indexes) if (!i.constraint_backed) await write(`${i.definition};\n`);
    if (s.comment) await write(`COMMENT ON TABLE ${rel} IS ${literal(s.comment)};\n`);
    for (const c of s.columns) {
      if (c.comment) await write(`COMMENT ON COLUMN ${rel}.${ident(c.name)} IS ${literal(c.comment)};\n`);
    }
    for (const q of sequences) {
      const { rows } = await client.query(`SELECT last_value, is_called FROM ${qualified(q.schema, q.name)}`);
      deferred.sequences.push(`SELECT setval(${literal(qualified(q.schema, q.name))}, ${rows[0].last_value}, ${rows[0].is_called});`);
    }
    // Identity sequences are recreated by CREATE TABLE, so move them past the imported ids.
    for (const c of s.columns.filter(col => col.identity)) {
      const max = `(SELECT max(${ident(c.name)}) FROM ${rel})`;
      deferred.sequences.push(`SELECT setval(pg_get_serial_sequence(${literal(rel)}, ${literal(c.name)}), COALESCE(${max}, 1), ${max} IS NOT NULL);`);
    }
  }

  if (opts.data && !isView) {
    const cols = s.columns.filter(c => c.generated !== 's');
    if (!cols.length) return;
    const overriding = cols.some(c => c.identity === 'a') ? ' OVERRIDING SYSTEM VALUE' : '';
    const head = `INSERT INTO ${rel} (${cols.map(c => ident(c.name)).join(', ')})${overriding} VALUES\n`;
    await write('\n');
    await client.query(`DECLARE dump_cur NO SCROLL CURSOR FOR SELECT ${cols.map(c => `${ident(c.name)}::text`).join(', ')} FROM ${rel}`);
    for (;;) {
      const { rows } = await client.query({ text: `FETCH ${FETCH_SIZE} FROM dump_cur`, rowMode: 'array' });
      if (!rows.length) break;
      for (let i = 0; i < rows.length; i += INSERT_BATCH) {
        const values = rows.slice(i, i + INSERT_BATCH).map(r => `  (${r.map(literal).join(', ')})`);
        await write(head + values.join(',\n') + ';\n');
      }
    }
    await client.query('CLOSE dump_cur');
  }
}

router.get('/db/:db/export', wrap(async (req, res) => {
  const { schema } = req.query;
  const format = req.query.format || 'sql';
  if (!schema) throw badRequest('schema is required');
  const p = getPool(req.params.id, req.params.db);
  const client = await p.connect();
  let started = false;
  try {
    // One consistent snapshot for the whole export.
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    let tables = String(req.query.tables || '').split(',').filter(Boolean);
    if (!tables.length) {
      const { rows } = await client.query(`
        SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relkind IN ('r', 'p', 'v', 'm') AND NOT c.relispartition
        ORDER BY c.relkind IN ('v', 'm'), c.relname`, [schema]);
      tables = rows.map(r => r.relname);
    }

    if (format === 'csv') {
      if (tables.length !== 1) throw badRequest('CSV export needs exactly one table');
      attachment(res, `${tables[0]}-${stamp()}.csv`, 'text/csv; charset=utf-8');
      started = true;
      const stream = client.query(copyTo(`COPY (SELECT * FROM ${qualified(schema, tables[0])}) TO STDOUT WITH (FORMAT csv, HEADER true)`));
      await copyToResponse(stream, res);
      await client.query('COMMIT');
      return;
    }

    const opts = { structure: req.query.structure !== '0', data: req.query.data !== '0', drop: req.query.drop === '1' };
    const name = tables.length === 1 ? tables[0] : `${req.params.db}-${schema}`;
    attachment(res, `${name}-${stamp()}.sql`, 'application/sql; charset=utf-8');
    started = true;
    const write = writer(res);
    await write(`-- PostAdmin SQL export\n-- Database: ${req.params.db}  Schema: ${schema}\n-- Generated: ${new Date().toISOString()}\n\n` +
      `SET client_encoding = 'UTF8';\nSET standard_conforming_strings = on;\n\nBEGIN;\n`);
    if (opts.structure && schema !== 'public') await write(`CREATE SCHEMA IF NOT EXISTS ${ident(schema)};\n`);

    const deferred = { foreignKeys: [], sequences: [], views: [] };
    for (const t of tables) {
      await dumpRelation(client, write, await tableStructure(client, schema, t), opts, deferred);
    }
    if (deferred.views.length) await write('\n-- Views\n' + deferred.views.join('\n'));
    if (deferred.foreignKeys.length) await write('\n-- Foreign keys\n' + deferred.foreignKeys.join('\n') + '\n');
    if (deferred.sequences.length) await write('\n-- Sequence values\n' + deferred.sequences.join('\n') + '\n');
    await write('\nCOMMIT;\n');
    await client.query('COMMIT');
    res.end();
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (!started) throw err;
    res.end(`\n-- EXPORT FAILED: ${err.message}\n`);
  } finally {
    client.release();
  }
}));

// Export the result of an arbitrary SELECT as CSV (used by the SQL editor).
router.post('/db/:db/export-query', wrap(async (req, res) => {
  const sql = String(req.body.sql || '').trim().replace(/;\s*$/, '');
  if (!sql) throw badRequest('SQL is empty');
  const client = await getPool(req.params.id, req.params.db).connect();
  try {
    await client.query('BEGIN READ ONLY');
    const stream = client.query(copyTo(`COPY (${sql}) TO STDOUT WITH (FORMAT csv, HEADER true)`));
    attachment(res, `query-${stamp()}.csv`, 'text/csv; charset=utf-8');
    await copyToResponse(stream, res);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (res.headersSent) return res.end();
    res.removeHeader('Content-Type');
    res.removeHeader('Content-Disposition');
    throw err;
  } finally {
    client.release(true);
  }
}));

// --- Import ---------------------------------------------------------------

// Parses only the header line of a CSV, honouring quotes.
function csvHeader(text, delimiter) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { out.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') break;
    else cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

router.post('/db/:db/import', upload.single('file'), wrap(async (req, res) => {
  const format = req.body.format || 'sql';
  const p = getPool(req.params.id, req.params.db);
  const client = await p.connect();
  const started = Date.now();
  try {
    if (format === 'csv') {
      const { schema, table } = req.body;
      if (!req.file || !schema || !table) throw badRequest('CSV import needs a file, schema and table');
      let buf = req.file.buffer;
      if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) buf = buf.subarray(3); // strip UTF-8 BOM
      const delimiter = req.body.delimiter === '\\t' ? '\t' : (req.body.delimiter || ',');
      const header = req.body.header !== '0';
      const rel = qualified(schema, table);
      const columns = header ? `(${csvHeader(buf.subarray(0, 65536).toString('utf8'), delimiter).map(ident).join(', ')})` : '';
      const nullStr = req.body.null ?? '';

      await client.query('BEGIN');
      if (req.body.truncate === '1') await client.query(`TRUNCATE ${rel}`);
      const copySql = `COPY ${rel} ${columns} FROM STDIN WITH (FORMAT csv, HEADER ${header}, DELIMITER ${literal(delimiter)}, NULL ${literal(nullStr)})`;
      const stream = client.query(copyFrom(copySql));
      await pipeline(Readable.from([buf]), stream);
      await client.query('COMMIT');
      return res.json({ ok: true, rows: stream.rowCount, duration: Date.now() - started });
    }

    const sql = req.file ? req.file.buffer.toString('utf8').replace(/^﻿/, '') : String(req.body.sql || '');
    if (!sql.trim()) throw badRequest('No SQL to import');
    const useTx = req.body.transaction !== '0';
    if (useTx) await client.query('BEGIN');
    await client.query(sql);
    if (useTx) await client.query('COMMIT');
    res.json({ ok: true, duration: Date.now() - started });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release(true);
  }
}));

module.exports = router;
