import { h } from '../ui.js';

const LONG_TYPES = /^(text|json|jsonb|xml|character varying$|bytea)|\[\]$/;

// One input per column with a Value / NULL / DEFAULT selector.
// mode 'insert' allows DEFAULT; 'edit' starts from the current value.
export function rowForm(columns, values = {}, { mode = 'insert' } = {}) {
  const fields = columns.map(c => {
    const generated = c.generated === 's';
    const hasDefault = c.default !== null || !!c.identity || generated;
    const initial = values[c.name];
    const long = LONG_TYPES.test(c.type) || (initial && String(initial).length > 60);
    const input = long
      ? h('textarea', { rows: 3, style: { width: '100%' }, value: initial ?? '' })
      : h('input', { style: { width: '100%' }, value: initial ?? '' });
    if (c.type === 'boolean') input.placeholder = 'true / false';

    const select = h('select', null,
      h('option', { value: 'value' }, 'Value'),
      c.nullable ? h('option', { value: 'null' }, 'NULL') : null,
      mode === 'insert' || generated ? h('option', { value: 'default' }, 'DEFAULT') : null,
      mode === 'edit' ? h('option', { value: 'keep' }, 'Unchanged') : null);

    if (generated) select.value = mode === 'insert' ? 'default' : 'keep';
    else if (mode === 'insert') select.value = values[c.name] !== undefined ? (values[c.name] === null ? 'null' : 'value') : (hasDefault ? 'default' : 'value');
    else select.value = initial === null ? 'null' : 'value';
    select.disabled = generated;

    const sync = () => { input.disabled = select.value !== 'value'; };
    select.addEventListener('change', () => { sync(); if (select.value === 'value') input.focus(); });
    input.addEventListener('input', () => { if (select.value !== 'value') { select.value = 'value'; sync(); } });
    sync();

    return {
      column: c,
      row: h('tr', null,
        h('td', null, h('strong', null, c.name), h('div', { class: 'muted small' }, c.type,
          c.identity ? ' · identity' : '', generated ? ' · generated' : '')),
        h('td', null, select),
        h('td', { style: { width: '100%' } }, input,
          hasDefault && c.default ? h('div', { class: 'muted small' }, 'default: ', h('code', null, c.default)) : null)),
      read() {
        if (select.value === 'default' || select.value === 'keep') return undefined;
        if (select.value === 'null') return null;
        return input.value;
      },
      changed() {
        const v = this.read();
        return v !== undefined && v !== initial;
      },
    };
  });

  return {
    el: h('div', { class: 'table-wrap' }, h('table', { class: 'grid compact' },
      h('thead', null, h('tr', null, h('th', null, 'Column'), h('th', null, 'Function'), h('th', null, 'Value'))),
      h('tbody', null, fields.map(f => f.row)))),
    // Values to send: only fields with an explicit value (and, in edit mode, only changed ones).
    values() {
      const out = {};
      for (const f of fields) {
        const v = f.read();
        if (v === undefined) continue;
        if (mode === 'edit' && !f.changed()) continue;
        out[f.column.name] = v;
      }
      return out;
    },
  };
}
