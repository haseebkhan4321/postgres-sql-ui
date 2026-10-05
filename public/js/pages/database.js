import { api, paths } from '../api.js';
import { h, append, route } from '../ui.js';
import { link, refresh } from '../app.js';
import { runDdl } from './common.js';

export async function render(ctx, el) {
  const schemas = await api.get(paths.db(ctx.id, ctx.db) + '/schemas');
  const name = h('input', { placeholder: 'new_schema' });
  const showSystem = h('input', { type: 'checkbox', onchange: () => draw() });
  const tbody = h('tbody');

  const draw = () => {
    tbody.replaceChildren(...schemas.filter(s => showSystem.checked || !s.system).map(s => h('tr', null,
      h('td', null, h('a', { href: route('c', ctx.id, ctx.db, s.name) }, s.name),
        s.system ? h('span', { class: 'badge', style: { marginLeft: '6px' } }, 'system') : null),
      h('td', null, s.owner),
      h('td', { class: 'num' }, s.tables),
      h('td', { class: 'actions' },
        h('a', { href: link({ id: ctx.id, db: ctx.db, schema: s.name, tab: 'sql' }) }, 'SQL'), ' ',
        h('a', { href: link({ id: ctx.id, db: ctx.db, schema: s.name, tab: 'export' }) }, 'Export'), ' ',
        s.system ? null : h('button', {
          class: 'link-btn danger',
          onclick: async () => {
            const cascade = confirm(`Also drop every object inside "${s.name}" (CASCADE)?\nCancel = plain DROP, which fails if the schema isn't empty.`);
            if (await runDdl(ctx, { action: 'drop_schema', name: s.name, cascade }, `Drop schema "${s.name}"`,
              { danger: true, label: 'Drop', success: 'Schema dropped' })) refresh();
          },
        }, 'Drop')))));
  };
  draw();

  append(el,
    h('div', { class: 'toolbar' },
      h('h2', { style: { margin: 0 } }, `Schemas in ${ctx.db}`),
      h('label', { class: 'inline' }, showSystem, 'show system schemas'),
      h('span', { class: 'spacer' }),
      name,
      h('button', {
        class: 'primary',
        onclick: async () => {
          if (!name.value.trim()) return name.focus();
          if (await runDdl(ctx, { action: 'create_schema', name: name.value.trim() }, 'Create schema', { success: 'Schema created' })) refresh();
        },
      }, 'Create schema')),
    h('div', { class: 'table-wrap' }, h('table', { class: 'grid' },
      h('thead', null, h('tr', null, ['Schema', 'Owner', 'Tables', ''].map(t => h('th', null, t)))),
      tbody)));
}
