import { api, paths } from '../api.js';
import { h, append, clear, toast, modal, confirmSql, formatBytes, route, errorBox } from '../ui.js';
import { link, refresh } from '../app.js';

async function ddl(ctx, body, title, opts) {
  const db = ctx.db || ctx.info.defaultDatabase;
  const { sql } = await api.post(paths.db(ctx.id, db) + '/ddl', { ...body, preview: true });
  if (!await confirmSql(title, sql, opts)) return false;
  await api.post(paths.db(ctx.id, db) + '/ddl', body);
  return true;
}

export async function render(ctx, el) {
  const dbs = await api.get(paths.conn(ctx.id) + '/databases');
  const info = ctx.info;

  const name = h('input', { placeholder: 'new_database' });
  append(el,
    h('div', { class: 'card' },
      h('h3', null, 'Server'),
      h('dl', { class: 'kv' },
        h('dt', null, 'Version'), h('dd', null, info.version),
        h('dt', null, 'User'), h('dd', null, info.user),
        h('dt', null, 'Default database'), h('dd', null, info.defaultDatabase))),
    h('div', { class: 'toolbar' },
      h('h2', { style: { margin: 0 } }, `Databases (${dbs.length})`),
      h('span', { class: 'spacer' }),
      name,
      h('button', {
        class: 'primary',
        onclick: async () => {
          if (!name.value.trim()) return name.focus();
          try {
            if (await ddl(ctx, { action: 'create_database', name: name.value.trim() }, 'Create database')) {
              toast('Database created');
              refresh();
            }
          } catch (err) { toast(err.message, 'error'); }
        },
      }, 'Create database')),
    h('div', { class: 'table-wrap' }, h('table', { class: 'grid' },
      h('thead', null, h('tr', null, ['Database', 'Size', 'Encoding', 'Collation', ''].map(t => h('th', null, t)))),
      h('tbody', null, dbs.map(d => h('tr', null,
        h('td', null, d.can_connect ? h('a', { href: route('c', ctx.id, d.name) }, d.name) : d.name,
          d.name === info.defaultDatabase ? h('span', { class: 'badge', style: { marginLeft: '6px' } }, 'default') : null),
        h('td', { class: 'num' }, formatBytes(d.size)),
        h('td', null, d.encoding),
        h('td', null, d.collation),
        h('td', { class: 'actions' },
          d.can_connect ? h('a', { href: link({ id: ctx.id, db: d.name, tab: 'sql' }) }, 'SQL') : null, ' ',
          h('button', {
            class: 'link-btn danger',
            onclick: async () => {
              try {
                if (await ddl(ctx, { action: 'drop_database', name: d.name }, `Drop database "${d.name}"`, { danger: true, label: 'Drop' })) {
                  toast('Database dropped');
                  refresh();
                }
              } catch (err) { toast(err.message, 'error'); }
            },
          }, 'Drop')))))))
  );
}

export async function renderHistory(ctx, el) {
  const history = await api.get(paths.conn(ctx.id) + '/history');
  append(el,
    h('div', { class: 'toolbar' },
      h('h2', { style: { margin: 0 } }, 'Query history'),
      h('span', { class: 'spacer' }),
      h('button', {
        class: 'danger',
        onclick: async () => {
          const ok = await modal({ title: 'Clear history', body: 'Delete all saved queries for this connection?',
            buttons: [{ label: 'Cancel', value: false }, { label: 'Clear', value: true, class: 'danger' }] });
          if (!ok) return;
          await api.del(paths.conn(ctx.id) + '/history');
          renderHistory(ctx, clear(el)).catch(err => clear(el, errorBox(err)));
        },
      }, 'Clear history')),
    history.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'grid compact' },
      h('thead', null, h('tr', null, ['When', 'Database', 'Status', 'Time', 'SQL', ''].map(t => h('th', null, t)))),
      h('tbody', null, history.map(q => h('tr', null,
        h('td', null, new Date(q.at).toLocaleString()),
        h('td', null, q.db),
        h('td', null, q.ok ? '✓' : h('span', { style: { color: 'var(--danger)' } }, '✗')),
        h('td', { class: 'num' }, `${q.duration} ms`),
        h('td', null, h('code', { style: { whiteSpace: 'pre-wrap' } }, q.sql.length > 400 ? q.sql.slice(0, 400) + '…' : q.sql)),
        h('td', { class: 'actions' }, h('a', {
          href: link({ id: ctx.id, db: q.db, tab: 'sql' }),
          onclick: () => sessionStorage.setItem('pa-sql-load', q.sql),
        }, 'Open')))))))
      : h('div', { class: 'empty' }, 'No queries yet.'));
}
