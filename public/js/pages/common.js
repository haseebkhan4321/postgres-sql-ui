import { api, paths } from '../api.js';
import { confirmSql, toast } from '../ui.js';

// Previews the generated DDL, asks for confirmation, then runs it. Resolves true when executed.
export async function runDdl(ctx, body, title, opts = {}) {
  const url = paths.db(ctx.id, ctx.db || ctx.info.defaultDatabase) + '/ddl';
  try {
    const { sql } = await api.post(url, { ...body, preview: true });
    if (!await confirmSql(title, sql, opts)) return false;
    await api.post(url, body);
    if (opts.success) toast(opts.success);
    return true;
  } catch (err) {
    toast(err.message + (err.detail ? `\n${err.detail}` : ''), 'error');
    return false;
  }
}

// Display order only: primary-key columns first (or a column named "id" when there's no PK),
// then the rest in their real order. The table itself is never changed.
export function displayColumns(structure) {
  const first = structure.primaryKey.length ? structure.primaryKey : ['id'];
  const lead = first.map(name => structure.columns.find(c => c.name === name)).filter(Boolean);
  return [...lead, ...structure.columns.filter(c => !lead.includes(c))];
}

export function relKind(relkind) {
  return { v: 'view', m: 'matview', S: 'sequence', f: 'foreign' }[relkind] || 'table';
}
