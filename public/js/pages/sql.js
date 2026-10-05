import { api, paths } from '../api.js';
import { h, append, clear, errorBox, spinner, formatNumber, postDownload, toast } from '../ui.js';
import { refresh } from '../app.js';

const quote = name => /^[a-z_][a-z0-9_]*$/.test(name) ? name : `"${name.replace(/"/g, '""')}"`;

function draftKey(ctx, db) {
  return `pa-sql:${ctx.id}/${db}`;
}

async function initialSql(ctx, db) {
  try {
    const pending = sessionStorage.getItem('pa-sql-load');
    if (pending) { sessionStorage.removeItem('pa-sql-load'); return pending; }
  } catch { /* ignore */ }
  const fn = ctx.params.get('fn');
  if (fn) {
    const defs = await api.get(`${paths.schema(ctx.id, db, ctx.schema)}/functions/${encodeURIComponent(fn)}`);
    return defs.map(d => d.definition).join(';\n\n');
  }
  if (ctx.table) return `SELECT * FROM ${quote(ctx.schema)}.${quote(ctx.table)} LIMIT 100;`;
  try { return localStorage.getItem(draftKey(ctx, db)) || ''; } catch { return ''; }
}

// Table/column names for autocomplete.
async function hintTables(ctx, db) {
  const tables = {};
  try {
    if (ctx.structure) tables[ctx.table] = ctx.structure.columns.map(c => c.name);
    const schema = ctx.schema || 'public';
    const { relations } = await api.get(paths.schema(ctx.id, db, schema) + '/objects');
    for (const r of relations) if (!tables[r.name]) tables[r.name] = [];
  } catch { /* autocomplete is best-effort */ }
  return tables;
}

function resultTable(r) {
  if (!r.fields.length) {
    return h('div', { class: 'alert ok' }, `${r.command || 'OK'}${r.rowCount !== null && r.rowCount !== undefined ? ` — ${formatNumber(r.rowCount)} row(s) affected` : ''}`);
  }
  return h('div', null,
    h('div', { class: 'result-meta' },
      `${formatNumber(r.rowCount ?? r.rows.length)} row(s)`, r.truncated ? ` — showing first ${formatNumber(r.rows.length)}` : '',
      ` · ${r.duration} ms`),
    h('div', { class: 'table-wrap' }, h('table', { class: 'grid' },
      h('thead', null, h('tr', null, h('th', { class: 'rownum' }, '#'), r.fields.map(f => h('th', null, f.name)))),
      h('tbody', null, r.rows.map((row, i) => h('tr', null,
        h('td', { class: 'rownum' }, i + 1),
        row.map(v => v === null ? h('td', { class: 'null' }, 'NULL')
          : h('td', { title: v.length > 200 ? v.slice(0, 2000) : undefined }, v.length > 200 ? v.slice(0, 200) + '…' : v))))))));
}

export async function render(ctx, el) {
  const db = ctx.db || ctx.info.defaultDatabase;
  const textarea = h('textarea');
  const results = h('div');
  const historyList = h('div');
  const statusLine = h('span', { class: 'muted' });

  append(el,
    h('div', { class: 'toolbar' },
      h('h2', { style: { margin: 0 } }, 'Run SQL on ', h('code', null, db), ctx.schema ? [' / ', h('code', null, ctx.schema)] : null),
      h('span', { class: 'spacer' }), statusLine),
    h('div', { class: 'sql-layout' },
      h('div', null, textarea),
      h('div', { class: 'sql-side' }, h('div', { class: 'head' }, 'Recent queries'), historyList)),
    h('div', { class: 'toolbar', style: { marginTop: '8px' } },
      h('button', { class: 'primary', onclick: () => run() }, '▶ Run'),
      h('button', { onclick: () => run('EXPLAIN ') }, 'Explain'),
      h('button', { onclick: () => run('EXPLAIN (ANALYZE, BUFFERS) ') }, 'Explain analyze'),
      h('button', { onclick: exportCsv, title: 'Run the current SELECT and download every row as CSV' }, 'Export result CSV'),
      h('button', { onclick: () => { editor.setValue(''); editor.focus(); } }, 'Clear'),
      h('span', { class: 'muted small' }, 'Ctrl+Enter runs the selection or the whole editor · Ctrl+Space autocompletes')),
    results);

  const editor = CodeMirror.fromTextArea(textarea, {
    mode: 'text/x-pgsql', lineNumbers: true, matchBrackets: true, indentUnit: 2, smartIndent: true,
    extraKeys: {
      'Ctrl-Enter': () => run(), 'Cmd-Enter': () => run(),
      'Ctrl-Space': 'autocomplete',
    },
    hintOptions: { tables: {}, completeSingle: false },
  });
  editor.setValue(await initialSql(ctx, db));
  editor.focus();
  editor.setCursor(editor.lineCount(), 0);
  hintTables(ctx, db).then(tables => editor.setOption('hintOptions', { tables, completeSingle: false }));
  editor.on('change', () => {
    if (ctx.params.get('fn')) return;
    try { localStorage.setItem(draftKey(ctx, db), editor.getValue()); } catch { /* ignore */ }
  });

  let errorMark;

  function currentSql() {
    const sel = editor.getSelection();
    if (sel.trim()) return { sql: sel, offset: editor.indexFromPos(editor.getCursor('from')) };
    return { sql: editor.getValue(), offset: 0 };
  }

  async function run(prefix = '') {
    errorMark?.clear();
    const { sql, offset } = currentSql();
    if (!sql.trim()) return;
    clear(results, spinner('Running…'));
    statusLine.textContent = '';
    try {
      const res = await api.post(paths.db(ctx.id, db) + '/query', { sql: prefix + sql });
      statusLine.textContent = `${res.results.length} statement(s) · ${res.duration} ms`;
      clear(results, res.results.map(r => h('div', { class: 'result-block' }, resultTable(r))));
      if (res.results.some(r => /^(CREATE|DROP|ALTER)$/.test(r.command))) refresh({ rerender: false });
    } catch (err) {
      clear(results, errorBox(err));
      if (err.position) {
        const pos = offset + err.position - 1 - prefix.length;
        if (pos >= 0) {
          const from = editor.posFromIndex(pos);
          const to = editor.posFromIndex(pos + Math.max(1, (editor.getLine(from.line).slice(from.ch).match(/^\S+/) || [''])[0].length));
          errorMark = editor.markText(from, to, { className: 'cm-error-pos' });
          editor.setCursor(from);
        }
      }
    }
    loadHistory();
  }

  function exportCsv() {
    const { sql } = currentSql();
    if (!sql.trim()) return toast('Nothing to export', 'error');
    postDownload(`/api${paths.db(ctx.id, db)}/export-query`, { sql });
  }

  async function loadHistory() {
    const history = await api.get(paths.conn(ctx.id) + '/history').catch(() => []);
    const items = history.filter(q => q.db === db).slice(0, 50);
    clear(historyList, items.length ? items.map(q => h('div', {
      class: 'item history-item' + (q.ok ? '' : ' failed'),
      title: q.sql,
      onclick: () => { editor.setValue(q.sql); editor.focus(); },
    }, q.sql.replace(/\s+/g, ' ').slice(0, 120))) : h('div', { class: 'item muted' }, 'No history yet'));
  }
  loadHistory();
}
