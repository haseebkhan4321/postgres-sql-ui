import { api, paths } from '../api.js';
import { h, append, toast, formatBytes, formatNumber, route, confirmSql } from '../ui.js';
import { link, refresh, go } from '../app.js';
import { runDdl } from './common.js';

export const COMMON_TYPES = ['integer', 'bigint', 'smallint', 'serial', 'bigserial', 'numeric(12,2)', 'real', 'double precision',
  'boolean', 'text', 'varchar(255)', 'char(1)', 'uuid', 'date', 'time', 'timestamp', 'timestamptz', 'interval',
  'json', 'jsonb', 'bytea', 'inet', 'text[]', 'integer[]'];

export function typeList() {
  const id = 'pa-types';
  if (!document.getElementById(id)) document.body.append(h('datalist', { id }, COMMON_TYPES.map(t => h('option', { value: t }))));
  return id;
}

const KIND_LABEL = { table: 'Table', view: 'View', matview: 'Mat. view', foreign: 'Foreign', sequence: 'Sequence' };

export async function render(ctx, el) {
  const { relations, functions } = await api.get(paths.schema(ctx.id, ctx.db, ctx.schema) + '/objects');
  const rels = relations.filter(r => r.kind !== 'sequence');
  const selected = new Set();
  const tableLink = (r, tab) => link({ id: ctx.id, db: ctx.db, schema: ctx.schema, table: r.name, tab });

  const bulkBtns = [];
  const updateBulk = () => bulkBtns.forEach(b => { b.disabled = !selected.size; });

  const runBulk = async (action, verb, extra = {}) => {
    const items = rels.filter(r => selected.has(r.name));
    const sqls = [];
    for (const r of items) {
      const body = { action, schema: ctx.schema, table: r.name, kind: r.kind, ...extra };
      sqls.push((await api.post(paths.db(ctx.id, ctx.db) + '/ddl', { ...body, preview: true })).sql);
    }
    if (!await confirmSql(`${verb} ${items.length} object(s)`, sqls.join('\n'), { danger: true, label: verb })) return;
    let done = 0;
    for (const r of items) {
      try {
        await api.post(paths.db(ctx.id, ctx.db) + '/ddl', { action, schema: ctx.schema, table: r.name, kind: r.kind, ...extra });
        done++;
      } catch (err) {
        toast(`${r.name}: ${err.message}`, 'error');
      }
    }
    toast(`${verb}: ${done} of ${items.length} done`);
    refresh();
  };

  const allBox = h('input', {
    type: 'checkbox',
    onchange: () => {
      el.querySelectorAll('input.rowsel').forEach(cb => { cb.checked = allBox.checked; cb.onchange(); });
    },
  });

  const totalSize = rels.reduce((n, r) => n + Number(r.size || 0), 0);
  const totalRows = rels.reduce((n, r) => n + Number(r.estimate || 0), 0);

  append(el,
    h('div', { class: 'toolbar' },
      h('h2', { style: { margin: 0 } }, `${ctx.schema} — ${rels.length} relation(s)`),
      h('span', { class: 'spacer' }),
      h('a', { class: 'btn btn-primary', href: link({ ...ctx, tab: 'create' }) }, '+ Create table')),
    rels.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'grid' },
      h('thead', null, h('tr', null, h('th', { class: 'actions' }, allBox),
        ['Name', 'Type', 'Rows (est.)', 'Size', 'Actions', 'Comment'].map(t => h('th', null, t)))),
      h('tbody', null, rels.map(r => {
        const cb = h('input', { type: 'checkbox', class: 'rowsel' });
        cb.onchange = () => { cb.checked ? selected.add(r.name) : selected.delete(r.name); updateBulk(); };
        const isTable = r.kind === 'table';
        return h('tr', null,
          h('td', { class: 'actions' }, cb),
          h('td', null, h('a', { href: tableLink(r) }, r.name)),
          h('td', null, KIND_LABEL[r.kind]),
          h('td', { class: 'num' }, isTable || r.kind === 'matview' ? formatNumber(r.estimate) : ''),
          h('td', { class: 'num' }, formatBytes(r.size)),
          h('td', { class: 'actions' },
            h('a', { href: tableLink(r) }, 'Browse'), ' · ',
            h('a', { href: tableLink(r, 'structure') }, 'Structure'),
            isTable ? [' · ', h('a', { href: tableLink(r, 'insert') }, 'Insert')] : null, ' · ',
            isTable ? [h('button', {
              class: 'link-btn danger',
              onclick: async () => {
                if (await runDdl(ctx, { action: 'truncate_table', schema: ctx.schema, table: r.name }, `Empty "${r.name}"`,
                  { danger: true, label: 'Empty', success: 'Table emptied' })) refresh();
              },
            }, 'Empty'), ' · '] : null,
            h('button', {
              class: 'link-btn danger',
              onclick: async () => {
                if (await runDdl(ctx, { action: 'drop_relation', schema: ctx.schema, table: r.name, kind: r.kind },
                  `Drop "${r.name}"`, { danger: true, label: 'Drop', success: 'Dropped' })) refresh();
              },
            }, 'Drop')),
          h('td', { class: 'muted' }, r.comment || ''));
      })),
      h('tfoot', null, h('tr', null, h('th'), h('th', null, 'Total'), h('th'),
        h('th', { class: 'num' }, formatNumber(totalRows)), h('th', { class: 'num' }, formatBytes(totalSize)), h('th'), h('th')))))
      : h('div', { class: 'empty' }, 'This schema has no tables or views yet.'),
    rels.length ? h('div', { class: 'toolbar', style: { marginTop: '8px' } },
      h('span', { class: 'muted' }, 'With selected:'),
      bulkBtns[0] = h('button', { disabled: true, onclick: () => { exportSelected(); go(ctx, { tab: 'export' }); } }, 'Export'),
      bulkBtns[1] = h('button', { disabled: true, class: 'danger', onclick: () => runBulk('truncate_table', 'Empty') }, 'Empty'),
      bulkBtns[2] = h('button', { disabled: true, class: 'danger', onclick: () => runBulk('drop_relation', 'Drop', { cascade: false }) }, 'Drop'))
      : null,
  );

  // The export tab picks up this selection.
  function exportSelected() {
    try { sessionStorage.setItem('pa-export-tables', JSON.stringify([...selected])); } catch { /* ignore */ }
  }

  if (functions.length) {
    append(el, h('h3', null, `Functions & procedures (${functions.length})`),
      h('div', { class: 'table-wrap' }, h('table', { class: 'grid' },
        h('thead', null, h('tr', null, ['Name', 'Arguments', 'Kind', ''].map(t => h('th', null, t)))),
        h('tbody', null, functions.map(f => h('tr', null,
          h('td', null, f.name), h('td', { class: 'mono' }, f.args), h('td', null, f.kind),
          h('td', { class: 'actions' }, h('a', { href: route('c', ctx.id, ctx.db, ctx.schema) + `?tab=sql&fn=${encodeURIComponent(f.name)}` }, 'View source'))))))));
  }
}

// --- Create table -----------------------------------------------------------

export function columnEditor(initial = [{ name: 'id', type: 'bigserial', pk: true, nullable: false }]) {
  const listId = typeList();
  const tbody = h('tbody');
  const rows = [];

  const addRow = (c = {}) => {
    const r = {
      name: h('input', { value: c.name || '', placeholder: 'column_name' }),
      type: h('input', { value: c.type || '', placeholder: 'text', list: listId }),
      def: h('input', { value: c.default || '', placeholder: 'e.g. now()' }),
      nullable: h('input', { type: 'checkbox', checked: c.nullable !== false }),
      pk: h('input', { type: 'checkbox', checked: !!c.pk }),
    };
    r.tr = h('tr', null, h('td', null, r.name), h('td', null, r.type), h('td', null, r.def),
      h('td', { style: { textAlign: 'center' } }, r.nullable), h('td', { style: { textAlign: 'center' } }, r.pk),
      h('td', null, h('button', { class: 'link-btn danger', onclick: () => { r.tr.remove(); rows.splice(rows.indexOf(r), 1); } }, '✕')));
    r.pk.addEventListener('change', () => { if (r.pk.checked) r.nullable.checked = false; });
    rows.push(r);
    tbody.append(r.tr);
  };
  initial.forEach(addRow);

  const el = h('div', null,
    h('div', { class: 'table-wrap' }, h('table', { class: 'grid' },
      h('thead', null, h('tr', null, ['Name', 'Type', 'Default', 'Null', 'PK', ''].map(t => h('th', null, t)))), tbody)),
    h('div', { class: 'toolbar', style: { marginTop: '8px' } }, h('button', { onclick: () => addRow() }, '+ Add column')));

  const value = () => rows.filter(r => r.name.value.trim()).map(r => ({
    name: r.name.value.trim(), type: r.type.value.trim() || 'text', default: r.def.value.trim(),
    nullable: r.nullable.checked, pk: r.pk.checked,
  }));
  return { el, value, addRow };
}

export async function renderCreate(ctx, el) {
  const name = h('input', { placeholder: 'table_name' });
  const editor = columnEditor([
    { name: 'id', type: 'bigserial', pk: true, nullable: false },
    { name: 'created_at', type: 'timestamptz', default: 'now()', nullable: false },
  ]);
  append(el,
    h('h2', null, `Create table in ${ctx.schema}`),
    h('div', { class: 'card' },
      h('div', { class: 'form-grid' }, h('label', null, 'Table name'), name),
      h('h3', null, 'Columns'),
      editor.el,
      h('div', { class: 'toolbar', style: { marginTop: '12px' } },
        h('button', {
          class: 'primary',
          onclick: async () => {
            if (!name.value.trim()) return name.focus();
            const table = name.value.trim();
            if (await runDdl(ctx, { action: 'create_table', schema: ctx.schema, table, columns: editor.value() },
              'Create table', { label: 'Create', success: `Table "${table}" created` })) {
              refresh({ rerender: false });
              go({ id: ctx.id, db: ctx.db, schema: ctx.schema, table, tab: 'structure' });
            }
          },
        }, 'Create table'))));
}
