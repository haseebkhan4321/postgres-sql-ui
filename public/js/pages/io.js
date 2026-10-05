import { api, paths } from '../api.js';
import { h, append, clear, errorBox, download, spinner } from '../ui.js';
import { refresh } from '../app.js';

function checkbox(label, checked = false) {
  const input = h('input', { type: 'checkbox', checked });
  return { input, el: h('label', { class: 'inline' }, input, label) };
}

export async function renderExport(ctx, el) {
  const level = ctx.table ? 'table' : ctx.schema ? 'schema' : 'database';
  const schemaSelect = h('select');
  const tableBox = h('div', { style: { maxHeight: '260px', overflow: 'auto', border: '1px solid var(--border)', borderRadius: '6px', padding: '6px 10px' } });
  const format = h('select', null, h('option', { value: 'sql' }, 'SQL'), h('option', { value: 'csv' }, 'CSV'));
  const structure = checkbox('Structure (CREATE TABLE, indexes, constraints)', true);
  const data = checkbox('Data (INSERT statements)', true);
  const drop = checkbox('Add DROP … IF EXISTS before each CREATE');
  const opts = h('div', null, structure.el, data.el, drop.el);
  let tableChecks = [];

  const loadTables = async schema => {
    clear(tableBox, spinner());
    const { relations } = await api.get(paths.schema(ctx.id, ctx.db, schema) + '/objects');
    let preselect = null;
    try {
      preselect = JSON.parse(sessionStorage.getItem('pa-export-tables') || 'null');
      sessionStorage.removeItem('pa-export-tables');
    } catch { /* ignore */ }
    const rels = relations.filter(r => ['table', 'view', 'matview'].includes(r.kind));
    tableChecks = rels.map(r => ({ name: r.name, ...checkbox(`${r.name}${r.kind !== 'table' ? ` (${r.kind})` : ''}`, preselect ? preselect.includes(r.name) : true) }));
    clear(tableBox,
      rels.length ? h('div', { class: 'toolbar', style: { marginBottom: '4px' } },
        h('button', { class: 'link-btn', onclick: () => tableChecks.forEach(t => { t.input.checked = true; }) }, 'Select all'),
        h('button', { class: 'link-btn', onclick: () => tableChecks.forEach(t => { t.input.checked = false; }) }, 'Select none')) : null,
      tableChecks.length ? tableChecks.map(t => h('div', null, t.el)) : h('div', { class: 'muted' }, 'No tables in this schema'));
  };

  if (level === 'database') {
    const schemas = await api.get(paths.db(ctx.id, ctx.db) + '/schemas');
    clear(schemaSelect, schemas.filter(s => !s.system).map(s => h('option', { value: s.name }, s.name)));
    schemaSelect.addEventListener('change', () => loadTables(schemaSelect.value));
    if (schemaSelect.value) await loadTables(schemaSelect.value);
  } else if (level === 'schema') {
    await loadTables(ctx.schema);
  }

  const syncFormat = () => { opts.style.display = format.value === 'sql' ? '' : 'none'; };
  format.addEventListener('change', syncFormat);
  syncFormat();

  const status = h('div');
  const run = () => {
    clear(status);
    const schema = ctx.schema || schemaSelect.value;
    const tables = level === 'table' ? [ctx.table] : tableChecks.filter(t => t.input.checked).map(t => t.name);
    if (!tables.length) return clear(status, h('div', { class: 'alert error' }, 'Select at least one table.'));
    if (format.value === 'csv' && tables.length !== 1) return clear(status, h('div', { class: 'alert error' }, 'CSV export works on one table at a time.'));
    const q = new URLSearchParams({ schema, format: format.value, tables: tables.join(',') });
    if (format.value === 'sql') {
      q.set('structure', structure.input.checked ? '1' : '0');
      q.set('data', data.input.checked ? '1' : '0');
      q.set('drop', drop.input.checked ? '1' : '0');
    }
    download(`/api${paths.db(ctx.id, ctx.db)}/export?${q}`);
  };

  append(el,
    h('h2', null, `Export ${level === 'table' ? `${ctx.schema}.${ctx.table}` : level === 'schema' ? `schema ${ctx.schema}` : `database ${ctx.db}`}`),
    h('div', { class: 'card' },
      h('div', { class: 'form-grid' },
        level === 'database' ? [h('label', null, 'Schema'), schemaSelect] : null,
        level !== 'table' ? [h('label', null, 'Tables'), tableBox] : null,
        h('label', null, 'Format'), format,
        h('label', null, 'Options'), opts),
      h('div', { class: 'toolbar', style: { marginTop: '14px' } }, h('button', { class: 'primary', onclick: run }, 'Export')),
      h('p', { class: 'muted small' }, 'SQL exports are taken from one consistent snapshot and can be re-imported from the Import tab or with psql.')),
    status);
}

export async function renderImport(ctx, el) {
  const level = ctx.table ? 'table' : ctx.schema ? 'schema' : 'database';
  const format = h('select', null, h('option', { value: 'sql' }, 'SQL'), level === 'table' ? h('option', { value: 'csv' }, 'CSV') : null);
  if (level === 'table') format.value = 'csv';
  const file = h('input', { type: 'file', accept: '.sql,.csv,.txt,.tsv' });
  const pasted = h('textarea', { rows: 8, style: { width: '100%' }, placeholder: '…or paste SQL here' });
  const tx = checkbox('Run everything in one transaction (rolls back on any error)', true);

  const header = checkbox('First line is a header (columns matched by name)', true);
  const delimiter = h('select', null, [[',', 'comma ,'], [';', 'semicolon ;'], ['\\t', 'tab'], ['|', 'pipe |']].map(([v, l]) => h('option', { value: v }, l)));
  const nullStr = h('input', { placeholder: 'empty', style: { width: '100px' } });
  const truncate = checkbox('Empty the table first (TRUNCATE)');

  const zone = h('div', { class: 'drop-zone' }, 'Drop a file here or ', file);
  zone.addEventListener('dragover', ev => { ev.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', ev => {
    ev.preventDefault();
    zone.classList.remove('over');
    if (ev.dataTransfer.files.length) {
      file.files = ev.dataTransfer.files;
      if (/\.csv$|\.tsv$/i.test(file.files[0].name) && level === 'table') format.value = 'csv';
      sync();
    }
  });

  const sqlOpts = h('div', null, h('div', { style: { margin: '8px 0' } }, pasted), tx.el);
  const csvOpts = h('div', { class: 'form-grid', style: { marginTop: '8px' } },
    h('label', null, 'Header'), header.el,
    h('label', null, 'Delimiter'), delimiter,
    h('label', null, 'NULL as'), nullStr,
    h('label', null, 'Before import'), truncate.el);

  const sync = () => {
    sqlOpts.style.display = format.value === 'sql' ? '' : 'none';
    csvOpts.style.display = format.value === 'csv' ? '' : 'none';
  };
  format.addEventListener('change', sync);
  file.addEventListener('change', sync);
  sync();

  const status = h('div');
  const button = h('button', {
    class: 'primary',
    onclick: async () => {
      const fd = new FormData();
      fd.append('format', format.value);
      if (file.files[0]) fd.append('file', file.files[0]);
      else if (format.value === 'sql' && pasted.value.trim()) fd.append('sql', pasted.value);
      else return clear(status, h('div', { class: 'alert error' }, 'Choose a file first.'));
      if (format.value === 'csv') {
        fd.append('schema', ctx.schema);
        fd.append('table', ctx.table);
        fd.append('header', header.input.checked ? '1' : '0');
        fd.append('delimiter', delimiter.value);
        fd.append('null', nullStr.value);
        fd.append('truncate', truncate.input.checked ? '1' : '0');
      } else {
        fd.append('transaction', tx.input.checked ? '1' : '0');
      }
      button.disabled = true;
      clear(status, spinner('Importing…'));
      try {
        const db = ctx.db || ctx.info.defaultDatabase;
        const res = await api.post(paths.db(ctx.id, db) + '/import', fd);
        clear(status, h('div', { class: 'alert ok' },
          `Import finished in ${res.duration} ms${res.rows !== undefined ? ` — ${res.rows} row(s) loaded` : ''}.`));
        refresh({ rerender: false });
      } catch (err) {
        clear(status, errorBox(err));
      } finally {
        button.disabled = false;
      }
    },
  }, 'Import');

  append(el,
    h('h2', null, `Import into ${level === 'table' ? `${ctx.schema}.${ctx.table}` : level === 'schema' ? `${ctx.db} (schema ${ctx.schema})` : ctx.db}`),
    h('div', { class: 'card' },
      h('div', { class: 'form-grid' }, h('label', null, 'Format'), format),
      h('div', { style: { marginTop: '12px' } }, zone),
      sqlOpts, csvOpts,
      h('div', { class: 'toolbar', style: { marginTop: '14px' } }, button),
      level !== 'table' ? h('p', { class: 'muted small' }, 'To import CSV, open the target table and use its Import tab.') : null),
    status);
}
