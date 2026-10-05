import { api, paths } from './api.js';
import { h, clear, route, formatNumber } from './ui.js';

const treeEl = document.getElementById('tree');
const filterEl = document.getElementById('tree-filter');

const cache = new Map(); // api url -> Promise
const expanded = loadExpanded();

function loadExpanded() {
  try { return new Set(JSON.parse(localStorage.getItem('pa-tree') || '[]')); } catch { return new Set(); }
}
function saveExpanded() {
  try { localStorage.setItem('pa-tree', JSON.stringify([...expanded].slice(-300))); } catch { /* ignore */ }
}

function load(url) {
  if (!cache.has(url)) cache.set(url, api.get(url).catch(err => { cache.delete(url); throw err; }));
  return cache.get(url);
}

export function invalidateTree() {
  cache.clear();
}

const ICONS = { conn: '🖧', db: '🛢', schema: '📁', table: '▦', view: '👁', matview: '◫', sequence: '#', foreign: '⇄', function: 'ƒ', procedure: 'ƒ' };
const GROUPS = [['table', 'Tables'], ['view', 'Views'], ['matview', 'Materialized views'], ['foreign', 'Foreign tables'], ['sequence', 'Sequences']];

let currentCtx = {};

function node({ key, icon, label, meta, href, active, title, loadChildren, dim }) {
  const isOpen = key && expanded.has(key);
  const children = h('div', { class: 'tree-children' });
  const toggle = h('span', { class: 'tree-toggle' }, loadChildren ? (isOpen ? '▼' : '▶') : '');
  const row = h(href ? 'a' : 'div', {
    class: 'tree-row' + (active ? ' active' : ''), href, title: title || label,
    style: dim ? { opacity: 0.6 } : undefined,
  }, toggle, h('span', { class: 'tree-icon' }, icon), h('span', { class: 'tree-label' }, label),
  meta !== undefined ? h('span', { class: 'tree-meta' }, meta) : null);

  const el = h('div', { class: 'tree-node' }, row, children);
  const open = async () => {
    toggle.textContent = '▼';
    clear(children, h('div', { class: 'tree-loading' }, 'loading…'));
    try {
      clear(children, await loadChildren());
    } catch (err) {
      clear(children, h('div', { class: 'tree-empty' }, err.message));
    }
  };
  if (loadChildren) {
    toggle.addEventListener('click', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      if (expanded.has(key)) {
        expanded.delete(key);
        toggle.textContent = '▶';
        clear(children);
      } else {
        expanded.add(key);
        open();
      }
      saveExpanded();
    });
    // Clicking the label navigates and also expands.
    row.addEventListener('click', () => {
      if (!expanded.has(key)) { expanded.add(key); saveExpanded(); open(); }
    });
    if (isOpen) open();
  }
  return el;
}

async function databases(id) {
  const dbs = await load(paths.conn(id) + '/databases');
  if (!dbs.length) return h('div', { class: 'tree-empty' }, 'no databases');
  return dbs.filter(d => d.can_connect).map(d => node({
    key: `db:${id}/${d.name}`,
    icon: ICONS.db,
    label: d.name,
    href: route('c', id, d.name),
    active: currentCtx.db === d.name && !currentCtx.schema,
    loadChildren: () => schemas(id, d.name),
  }));
}

async function schemas(id, db) {
  const list = await load(paths.db(id, db) + '/schemas');
  return list.map(s => node({
    key: `s:${id}/${db}/${s.name}`,
    icon: ICONS.schema,
    label: s.name,
    meta: s.tables || undefined,
    dim: s.system,
    href: route('c', id, db, s.name),
    active: currentCtx.db === db && currentCtx.schema === s.name && !currentCtx.table,
    loadChildren: () => objects(id, db, s.name),
  }));
}

async function objects(id, db, schema) {
  const { relations, functions } = await load(paths.schema(id, db, schema) + '/objects');
  const q = filterEl.value.trim().toLowerCase();
  const match = name => !q || name.toLowerCase().includes(q);
  const out = [];
  for (const [kind, title] of GROUPS) {
    const items = relations.filter(r => r.kind === kind && match(r.name));
    if (!items.length) continue;
    out.push(h('div', { class: 'tree-group' }, `${title} (${items.length})`));
    for (const r of items) {
      const isRel = kind !== 'sequence';
      out.push(node({
        icon: ICONS[kind],
        label: r.name,
        meta: kind === 'table' && r.estimate > 0 ? '~' + formatNumber(r.estimate) : undefined,
        title: r.comment ? `${r.name} — ${r.comment}` : r.name,
        href: isRel ? route('c', id, db, schema, r.name) : undefined,
        active: currentCtx.db === db && currentCtx.schema === schema && currentCtx.table === r.name,
      }));
    }
  }
  const funcs = functions.filter(f => match(f.name));
  if (funcs.length) {
    out.push(node({
      key: `f:${id}/${db}/${schema}`,
      icon: ICONS.function,
      label: `Functions (${funcs.length})`,
      loadChildren: async () => funcs.map(f => node({
        icon: ICONS[f.kind], label: `${f.name}(${f.args})`,
        href: route('c', id, db, schema) + `?tab=sql&fn=${encodeURIComponent(f.name)}`,
      })),
    }));
  }
  return out.length ? out : h('div', { class: 'tree-empty' }, q ? 'no matches' : 'empty');
}

export async function renderTree(ctx) {
  currentCtx = ctx;
  if (!ctx.id) {
    const conns = await api.get('/connections').catch(() => []);
    clear(treeEl, conns.length
      ? conns.map(c => node({ icon: ICONS.conn, label: c.name, href: route('c', c.id) }))
      : h('div', { class: 'tree-empty' }, 'Add a connection to begin'));
    return;
  }
  // The current database and schema are always expanded.
  if (ctx.db) expanded.add(`db:${ctx.id}/${ctx.db}`);
  if (ctx.schema) expanded.add(`s:${ctx.id}/${ctx.db}/${ctx.schema}`);
  saveExpanded();
  const scroll = treeEl.scrollTop;
  try {
    clear(treeEl, await databases(ctx.id));
  } catch (err) {
    clear(treeEl, h('div', { class: 'tree-empty' }, err.message));
  }
  treeEl.scrollTop = scroll;
}
