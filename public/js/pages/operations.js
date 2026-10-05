import { h, append } from '../ui.js';
import { go, refresh } from '../app.js';
import { runDdl, relKind } from './common.js';

export async function render(ctx, el) {
  const s = ctx.structure;
  const kind = relKind(s.relkind);
  const isTable = kind === 'table';
  const newName = h('input', { value: s.table });
  const restart = h('input', { type: 'checkbox' });
  const cascadeTruncate = h('input', { type: 'checkbox' });
  const cascadeDrop = h('input', { type: 'checkbox' });
  const base = { schema: s.schema, table: s.table, kind };

  append(el,
    h('h2', null, `Operations on ${s.schema}.${s.table}`),
    h('div', { class: 'card' },
      h('h3', null, 'Rename'),
      h('div', { class: 'toolbar' }, newName, h('button', {
        class: 'primary',
        onclick: async () => {
          const name = newName.value.trim();
          if (!name || name === s.table) return;
          if (await runDdl(ctx, { action: 'rename_table', ...base, newName: name }, 'Rename', { success: 'Renamed' })) {
            refresh({ rerender: false });
            go({ id: ctx.id, db: ctx.db, schema: ctx.schema, table: name, tab: 'operations' });
          }
        },
      }, 'Rename'))),
    isTable ? h('div', { class: 'card' },
      h('h3', null, 'Empty table (TRUNCATE)'),
      h('p', { class: 'muted' }, 'Removes every row instantly. Cannot be undone.'),
      h('div', { class: 'toolbar' },
        h('label', { class: 'inline' }, restart, 'Reset identity/sequences'),
        h('label', { class: 'inline' }, cascadeTruncate, 'CASCADE to referencing tables'),
        h('button', {
          class: 'danger',
          onclick: async () => {
            if (await runDdl(ctx, { action: 'truncate_table', ...base, restart: restart.checked, cascade: cascadeTruncate.checked },
              'Empty table', { danger: true, label: 'Empty', success: 'Table emptied' })) refresh();
          },
        }, 'Empty table'))) : null,
    h('div', { class: 'card' },
      h('h3', null, `Drop ${kind}`),
      h('p', { class: 'muted' }, 'Deletes the object and all of its data permanently.'),
      h('div', { class: 'toolbar' },
        h('label', { class: 'inline' }, cascadeDrop, 'CASCADE (also drop dependent objects)'),
        h('button', {
          class: 'danger',
          onclick: async () => {
            if (await runDdl(ctx, { action: 'drop_relation', ...base, cascade: cascadeDrop.checked },
              `Drop ${kind}`, { danger: true, label: 'Drop', success: 'Dropped' })) {
              refresh({ rerender: false });
              go({ id: ctx.id, db: ctx.db, schema: ctx.schema });
            }
          },
        }, `Drop ${kind}`))));
}
