import { api } from '../api.js';
import { h, append, clear, toast, modal, errorBox, route } from '../ui.js';
import { forgetConnection } from '../app.js';

const COLORS = ['#336791', '#1e8449', '#c0392b', '#8e44ad', '#d35400', '#16a085', '#7f8c8d'];

function buildUri({ host, port, user, password, database, sslmode }) {
  const auth = user ? encodeURIComponent(user) + (password ? ':' + encodeURIComponent(password) : '') + '@' : '';
  const q = sslmode ? `?sslmode=${sslmode}` : '';
  return `postgresql://${auth}${host || 'localhost'}:${port || 5432}/${encodeURIComponent(database || 'postgres')}${q}`;
}

async function editConnection(existing, onSaved) {
  const name = h('input', { value: existing?.name || '', placeholder: 'My database', style: { width: '100%' } });
  const uri = h('input', {
    value: existing?.uri || '', placeholder: 'postgresql://user:password@host:5432/dbname?sslmode=require',
    style: { width: '100%' }, class: 'mono',
  });
  let color = existing?.color || COLORS[0];
  const swatches = h('div', { class: 'inline' }, COLORS.map(c => {
    const sw = h('span', {
      style: { width: '20px', height: '20px', borderRadius: '50%', background: c, cursor: 'pointer', display: 'inline-block',
        outline: c === color ? '2px solid var(--text)' : 'none', outlineOffset: '2px' },
      onclick: () => {
        color = c;
        for (const s of swatches.children) s.style.outline = 'none';
        sw.style.outline = '2px solid var(--text)';
      },
    });
    return sw;
  }));

  const parts = { host: h('input', { placeholder: 'localhost' }), port: h('input', { placeholder: '5432', style: { width: '80px' } }),
    user: h('input', { placeholder: 'postgres' }), password: h('input', { type: 'password' }),
    database: h('input', { placeholder: 'postgres' }),
    sslmode: h('select', null, ['', 'disable', 'prefer', 'require', 'verify-full'].map(m => h('option', { value: m }, m || '(default)'))) };
  const builder = h('details', { style: { marginTop: '8px' } },
    h('summary', { class: 'muted', style: { cursor: 'pointer' } }, 'Build URI from fields'),
    h('div', { class: 'form-grid', style: { marginTop: '8px' } },
      Object.entries(parts).flatMap(([k, el]) => [h('label', null, k), el]),
      h('span'), h('button', {
        onclick: () => {
          uri.value = buildUri(Object.fromEntries(Object.entries(parts).map(([k, el]) => [k, el.value.trim()])));
        },
      }, 'Fill URI')));

  const status = h('div');
  const test = async () => {
    clear(status, h('div', { class: 'muted' }, 'Testing…'));
    try {
      const r = await api.post('/connections/test', { uri: uri.value.trim() });
      clear(status, h('div', { class: 'alert ok' }, `Connected to "${r.database}" as ${r.user}\n${r.version}`));
    } catch (err) {
      clear(status, errorBox(err));
    }
    return false;
  };

  const saved = await modal({
    title: existing ? 'Edit connection' : 'New connection',
    body: h('div', null,
      h('div', { class: 'form-grid', style: { gridTemplateColumns: 'max-content 1fr' } },
        h('label', null, 'Name'), name,
        h('label', null, 'URI'), uri,
        h('label', null, 'Color'), swatches),
      builder,
      h('p', { class: 'muted small' }, 'Saved in plain text on this computer only. SSL settings in the URI (sslmode=require) are honoured.'),
      status),
    buttons: [
      { label: 'Test connection', action: test },
      { label: 'Cancel', value: null },
      {
        label: 'Save', class: 'primary',
        action: async () => {
          const body = { name: name.value.trim() || 'Untitled', uri: uri.value.trim(), color };
          try {
            const res = existing ? await api.put(`/connections/${existing.id}`, body) : await api.post('/connections', body);
            if (existing) forgetConnection(existing.id);
            onSaved(res);
            return true;
          } catch (err) {
            clear(status, errorBox(err));
            return false;
          }
        },
        value: true,
      },
    ],
  });
  return saved;
}

export async function render(ctx, el) {
  const conns = await api.get('/connections');
  const reload = () => render(ctx, clear(el));

  const list = conns.map(c => h('div', { class: 'conn-card', style: { borderLeftColor: c.color } },
    h('a', { class: 'name', href: route('c', c.id) }, c.name),
    h('div', { class: 'uri' }, c.uri),
    h('div', { class: 'row' },
      h('a', { class: 'btn btn-primary', href: route('c', c.id) }, 'Open'),
      h('button', {
        onclick: async () => {
          try {
            const r = await api.post('/connections/test', { id: c.id });
            toast(`OK — ${r.version.split(' on ')[0]}`);
          } catch (err) { toast(err.message, 'error'); }
        },
      }, 'Test'),
      h('button', { onclick: async () => editConnection(await api.get(`/connections/${c.id}`), () => { toast('Saved'); reload(); }) }, 'Edit'),
      h('button', {
        class: 'danger',
        onclick: async () => {
          const ok = await modal({
            title: 'Delete connection', body: `Remove "${c.name}" from saved connections? The database itself is not touched.`,
            buttons: [{ label: 'Cancel', value: false }, { label: 'Delete', value: true, class: 'danger' }],
          });
          if (!ok) return;
          await api.del(`/connections/${c.id}`);
          forgetConnection(c.id);
          toast('Connection removed');
          reload();
        },
      }, 'Delete'))));

  append(el,
    h('div', { class: 'toolbar' },
      h('h2', { style: { margin: 0 } }, 'Saved connections'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'primary', onclick: () => editConnection(null, c => { toast('Connection saved'); location.hash = route('c', c.id); }) }, '+ New connection')),
    conns.length ? h('div', { class: 'conn-list' }, list)
      : h('div', { class: 'card empty' },
        h('p', null, 'No connections yet. Paste a PostgreSQL URI to get started.'),
        h('button', { class: 'primary', onclick: () => editConnection(null, c => { location.hash = route('c', c.id); }) }, '+ New connection')),
  );
}
