import { h, append, modal, formatBytes, formatNumber } from '../ui.js';
import { refresh } from '../app.js';
import { runDdl } from './common.js';
import { typeList } from './schema.js';

const CONSTRAINT_TYPES = { p: 'PRIMARY KEY', u: 'UNIQUE', f: 'FOREIGN KEY', c: 'CHECK', x: 'EXCLUDE', t: 'TRIGGER', n: 'NOT NULL' };

async function columnDialog(ctx, column) {
  const listId = typeList();
  const name = h('input', { value: column?.name || '', style: { width: '100%' } });
  const type = h('input', { value: column?.type || '', list: listId, style: { width: '100%' } });
  const using = h('input', { placeholder: `optional, e.g. ${column?.name || 'col'}::integer`, style: { width: '100%' } });
  const def = h('input', { value: column?.default || '', placeholder: 'expression, e.g. 0 or now()', style: { width: '100%' } });
  const nullable = h('input', { type: 'checkbox', checked: column ? column.nullable : true });
  const comment = h('input', { value: column?.comment || '', style: { width: '100%' } });

  const body = h('div', { class: 'form-grid', style: { gridTemplateColumns: 'max-content 1fr' } },
    h('label', null, 'Name'), name,
    h('label', null, 'Type'), type,
    column ? [h('label', null, 'USING'), using] : null,
    h('label', null, 'Default'), def,
    h('label', null, 'Nullable'), h('label', { class: 'inline' }, nullable, 'allow NULL'),
    h('label', null, 'Comment'), comment);

  const ok = await modal({
    title: column ? `Change column "${column.name}"` : 'Add column',
    body,
    buttons: [{ label: 'Cancel', value: false }, { label: 'Continue', value: true, class: 'primary' }],
  });
  if (!ok) return;

  const base = { schema: ctx.schema, table: ctx.table };
  let req;
  if (!column) {
    req = { action: 'add_column', ...base, column: { name: name.value, type: type.value, default: def.value, nullable: nullable.checked } };
  } else {
    req = { action: 'alter_column', ...base, name: column.name };
    if (type.value.trim() !== column.type) { req.type = type.value.trim(); if (using.value.trim()) req.using = using.value.trim(); }
    if (nullable.checked !== column.nullable) req.nullable = nullable.checked;
    if (def.value.trim() !== (column.default || '')) req.default = def.value.trim() === '' ? null : def.value.trim();
    if (comment.value !== (column.comment || '')) req.comment = comment.value;
    if (name.value.trim() && name.value.trim() !== column.name) req.newName = name.value.trim();
  }
  if (await runDdl(ctx, req, req.action === 'add_column' ? 'Add column' : 'Change column', { success: 'Structure updated' })) refresh();
}

async function indexDialog(ctx) {
  const name = h('input', { placeholder: 'auto-generated if empty', style: { width: '100%' } });
  const method = h('select', null, ['btree', 'hash', 'gin', 'gist', 'brin'].map(m => h('option', { value: m }, m)));
  const unique = h('input', { type: 'checkbox' });
  const boxes = ctx.structure.columns.map(c => ({ c, cb: h('input', { type: 'checkbox' }) }));
  const ok = await modal({
    title: 'Create index',
    body: h('div', { class: 'form-grid', style: { gridTemplateColumns: 'max-content 1fr' } },
      h('label', null, 'Name'), name,
      h('label', null, 'Method'), method,
      h('label', null, 'Unique'), h('label', { class: 'inline' }, unique, 'UNIQUE'),
      h('label', null, 'Columns'), h('div', null, boxes.map(b => h('label', { class: 'inline', style: { marginRight: '12px' } }, b.cb, b.c.name)))),
    buttons: [{ label: 'Cancel', value: false }, { label: 'Continue', value: true, class: 'primary' }],
  });
  if (!ok) return;
  const req = {
    action: 'create_index', schema: ctx.schema, table: ctx.table, name: name.value.trim() || undefined,
    method: method.value, unique: unique.checked, columns: boxes.filter(b => b.cb.checked).map(b => b.c.name),
  };
  if (await runDdl(ctx, req, 'Create index', { success: 'Index created' })) refresh();
}

export async function render(ctx, el) {
  const s = ctx.structure;
  const isTable = !ctx.isView && s.relkind !== 'f';
  const drop = (body, title) => async () => {
    if (await runDdl(ctx, body, title, { danger: true, label: 'Drop', success: 'Dropped' })) refresh();
  };

  append(el,
    h('div', { class: 'toolbar' },
      h('h2', { style: { margin: 0 } }, `${s.schema}.${s.table}`),
      h('span', { class: 'muted' }, `${formatNumber(s.estimate)} rows (est.) · data ${formatBytes(s.data_size)} · total ${formatBytes(s.total_size)} · owner ${s.owner}`),
      h('span', { class: 'spacer' }),
      isTable ? h('button', { class: 'primary', onclick: () => columnDialog(ctx) }, '+ Add column') : null),
    s.comment ? h('div', { class: 'alert info' }, s.comment) : null,
    h('div', { class: 'table-wrap' }, h('table', { class: 'grid' },
      h('thead', null, h('tr', null, ['#', 'Column', 'Type', 'Nullable', 'Default', 'Comment', isTable ? 'Actions' : ''].map(t => h('th', null, t)))),
      h('tbody', null, s.columns.map(c => h('tr', null,
        h('td', { class: 'rownum' }, c.num),
        h('td', null, h('strong', null, c.name),
          s.primaryKey.includes(c.name) ? h('span', { class: 'badge pk', style: { marginLeft: '6px' } }, 'PK') : null,
          c.identity ? h('span', { class: 'badge', style: { marginLeft: '4px' } }, 'identity') : null,
          c.generated === 's' ? h('span', { class: 'badge', style: { marginLeft: '4px' } }, 'generated') : null),
        h('td', { class: 'mono' }, c.type),
        h('td', null, c.nullable ? 'YES' : 'NO'),
        h('td', { class: 'mono' }, c.default ?? ''),
        h('td', { class: 'muted' }, c.comment || ''),
        h('td', { class: 'actions' }, isTable ? [
          h('button', { class: 'link-btn', onclick: () => columnDialog(ctx, c) }, 'Change'), ' ',
          h('button', { class: 'link-btn danger', onclick: drop({ action: 'drop_column', schema: s.schema, table: s.table, name: c.name }, `Drop column "${c.name}"`) }, 'Drop'),
        ] : null)))))));

  if (s.view_def) {
    append(el, h('h3', null, 'View definition'), h('pre', { class: 'sql-preview' }, s.view_def));
  }

  if (isTable || s.indexes.length) {
    append(el,
      h('div', { class: 'toolbar', style: { marginTop: '18px' } },
        h('h3', { style: { margin: 0 } }, `Indexes (${s.indexes.length})`),
        h('span', { class: 'spacer' }),
        isTable ? h('button', { onclick: () => indexDialog(ctx) }, '+ Create index') : null),
      s.indexes.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'grid' },
        h('thead', null, h('tr', null, ['Name', 'Definition', 'Size', ''].map(t => h('th', null, t)))),
        h('tbody', null, s.indexes.map(i => h('tr', null,
          h('td', null, i.name, i.primary ? h('span', { class: 'badge pk', style: { marginLeft: '6px' } }, 'PK')
            : i.unique ? h('span', { class: 'badge', style: { marginLeft: '6px' } }, 'UNIQUE') : null),
          h('td', { class: 'mono' }, i.definition),
          h('td', { class: 'num' }, formatBytes(i.size)),
          h('td', { class: 'actions' }, i.constraint_backed ? h('span', { class: 'muted small' }, 'via constraint')
            : h('button', { class: 'link-btn danger', onclick: drop({ action: 'drop_index', schema: s.schema, name: i.name }, `Drop index "${i.name}"`) }, 'Drop')))))))
        : h('div', { class: 'muted' }, 'No indexes.'));
  }

  const constraints = s.constraints.filter(k => k.type !== 'n');
  if (constraints.length) {
    append(el,
      h('h3', null, `Constraints (${constraints.length})`),
      h('div', { class: 'table-wrap' }, h('table', { class: 'grid' },
        h('thead', null, h('tr', null, ['Name', 'Type', 'Definition', ''].map(t => h('th', null, t)))),
        h('tbody', null, constraints.map(k => h('tr', null,
          h('td', null, k.name),
          h('td', null, CONSTRAINT_TYPES[k.type] || k.type),
          h('td', { class: 'mono' }, k.definition),
          h('td', { class: 'actions' }, h('button', {
            class: 'link-btn danger',
            onclick: drop({ action: 'drop_constraint', schema: s.schema, table: s.table, name: k.name }, `Drop constraint "${k.name}"`),
          }, 'Drop'))))))));
  }
}
