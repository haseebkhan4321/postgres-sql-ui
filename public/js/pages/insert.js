import { api, paths } from '../api.js';
import { h, append, clear, toast, errorBox } from '../ui.js';
import { go } from '../app.js';
import { rowForm } from './rowform.js';
import { displayColumns } from './common.js';

export async function render(ctx, el) {
  let prefill = {};
  try {
    prefill = JSON.parse(sessionStorage.getItem('pa-insert-prefill') || '{}');
    sessionStorage.removeItem('pa-insert-prefill');
  } catch { /* ignore */ }

  const columns = displayColumns(ctx.structure);
  const status = h('div');
  const forms = h('div');
  const after = h('select', null,
    h('option', { value: 'browse' }, 'Go back to Browse'),
    h('option', { value: 'again' }, 'Insert another row'));
  const formList = [];

  const addForm = values => {
    const f = rowForm(columns, values, { mode: 'insert' });
    formList.push(f);
    append(forms, h('div', { style: { marginBottom: '12px' } }, formList.length > 1 ? h('h3', null, `Row ${formList.length}`) : null, f.el));
  };
  addForm(prefill);

  const submit = async () => {
    clear(status);
    let inserted = 0;
    for (const f of formList) {
      try {
        await api.post(paths.table(ctx.id, ctx.db, ctx.schema, ctx.table) + '/rows', { values: f.values() });
        inserted++;
      } catch (err) {
        clear(status, errorBox(err));
        if (inserted) toast(`${inserted} row(s) inserted before the error`);
        return;
      }
    }
    toast(`Inserted ${inserted} row(s)`);
    if (after.value === 'browse') go(ctx, { tab: undefined });
    else {
      formList.length = 0;
      clear(forms);
      addForm({});
    }
  };

  append(el,
    h('h2', null, `Insert into ${ctx.schema}.${ctx.table}`),
    status,
    forms,
    h('div', { class: 'toolbar' },
      h('button', { class: 'primary', onclick: submit }, 'Insert'),
      h('button', { onclick: () => addForm({}) }, '+ Another row'),
      h('span', { class: 'muted' }, 'Then:'), after));
}
