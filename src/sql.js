// Identifier quoting compatible with pg's Client#escapeIdentifier.
function ident(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

function qualified(schema, table) {
  return `${ident(schema)}.${ident(table)}`;
}

function literal(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date) value = value.toISOString();
  if (Buffer.isBuffer(value)) return `'\\x${value.toString('hex')}'`;
  if (typeof value === 'object') value = JSON.stringify(value);
  // Assumes standard_conforming_strings = on (the default since PG 9.1), so only quotes need escaping.
  return `'${String(value).replace(/'/g, "''")}'`;
}

// Wraps async route handlers so rejected promises reach the error middleware.
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { ident, qualified, literal, wrap };
