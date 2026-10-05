import { api, paths } from '../api.js';
import { h, append, clear, toast } from '../ui.js';
import { go, link } from '../app.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const ROW_H = 20;
const HEAD_H = 28;
const PAD_X = 10;
const BADGE_W = 24;
const MIN_W = 170;
const FONT = '12px "Segoe UI", Roboto, Arial, sans-serif';
const FONT_BOLD = 'bold 13px "Segoe UI", Roboto, Arial, sans-serif';

// --- helpers ----------------------------------------------------------------

function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) el.setAttribute(k, v);
  for (const c of children) {
    if (c === null || c === undefined) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const measureCtx = document.createElement('canvas').getContext('2d');
function textWidth(text, font = FONT) {
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function saveBlob(name, blob) {
  const href = URL.createObjectURL(blob);
  const a = h('a', { href, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10000);
}

const xmlEsc = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function loadSaved(key) {
  try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; }
}
function store(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

// --- model ------------------------------------------------------------------

function buildModel(data, keysOnly) {
  const multiSchema = new Set(data.tables.map(t => t.schema)).size > 1;
  const fkCols = new Map(); // table id -> Map(column -> nullable fk?)
  for (const fk of data.foreignKeys) {
    const id = `${fk.from_schema}.${fk.from_table}`;
    if (!fkCols.has(id)) fkCols.set(id, new Set());
    fk.from_columns.forEach(c => fkCols.get(id).add(c));
  }

  const nodes = data.tables.map(t => {
    const id = `${t.schema}.${t.name}`;
    const fks = fkCols.get(id) || new Set();
    // Primary key columns first, matching the Browse grid.
    const ordered = [...t.columns.filter(c => c.pk), ...t.columns.filter(c => !c.pk)];
    const all = ordered.map(c => ({ ...c, fk: fks.has(c.name) }));
    const rows = keysOnly ? all.filter(c => c.pk || c.fk) : all;
    const title = multiSchema ? id : t.name;
    const nameW = Math.max(0, ...rows.map(r => textWidth(r.name)));
    const typeW = Math.max(0, ...rows.map(r => textWidth(r.type)));
    const w = Math.ceil(Math.max(MIN_W, textWidth(title, FONT_BOLD) + PAD_X * 2 + 10, PAD_X + BADGE_W + nameW + 18 + typeW + PAD_X));
    return { id, schema: t.schema, table: t.name, title, comment: t.comment, rows, w, h: HEAD_H + Math.max(rows.length, 1) * ROW_H, x: 0, y: 0 };
  });

  const byId = new Map(nodes.map(n => [n.id, n]));
  const edges = [];
  for (const fk of data.foreignKeys) {
    const from = byId.get(`${fk.from_schema}.${fk.from_table}`);
    const to = byId.get(`${fk.to_schema}.${fk.to_table}`);
    if (!from || !to) continue; // references a schema outside this diagram
    const fromRow = from.rows.findIndex(r => r.name === fk.from_columns[0]);
    const toRow = to.rows.findIndex(r => r.name === fk.to_columns[0]);
    const nullable = fk.from_columns.some(c => from.rows.find(r => r.name === c)?.nullable);
    edges.push({ name: fk.name, from, to, fromRow, toRow, nullable, label: `${fk.from_columns.join(', ')} → ${fk.to_table}.${fk.to_columns.join(', ')}` });
  }
  return { nodes, edges, byId };
}

// Layered layout: each connected group flows left→right by BFS depth from its most-referenced table;
// tables with no relations are packed in a grid underneath.
function autoLayout(nodes, edges) {
  const GAP_X = 90;
  const GAP_Y = 28;
  const MAX_COL_H = 1500;
  const MAX_ROW_W = 4200;
  const adj = new Map(nodes.map(n => [n, new Set()]));
  for (const e of edges) {
    if (e.from === e.to) continue;
    adj.get(e.from).add(e.to);
    adj.get(e.to).add(e.from);
  }
  const order = [...nodes].sort((a, b) => adj.get(b).size - adj.get(a).size || a.id.localeCompare(b.id));
  const seen = new Set();
  const groups = [];
  const isolated = [];
  for (const start of order) {
    if (seen.has(start)) continue;
    seen.add(start);
    if (!adj.get(start).size) { isolated.push(start); continue; }
    const layers = [[start]];
    for (let i = 0; i < layers.length; i++) {
      const next = [];
      for (const n of layers[i]) {
        for (const m of [...adj.get(n)].sort((a, b) => adj.get(b).size - adj.get(a).size)) {
          if (!seen.has(m)) { seen.add(m); next.push(m); }
        }
      }
      if (next.length) layers.push(next);
    }
    groups.push(layers);
  }

  let cx = 0;
  let cy = 0;
  let rowH = 0;
  for (const layers of groups) {
    // Barycenter pass: order each layer by where its neighbours sit in the previous one.
    for (let i = 1; i < layers.length; i++) {
      const pos = new Map(layers[i - 1].map((n, j) => [n, j]));
      const bary = n => {
        const ps = [...adj.get(n)].filter(m => pos.has(m)).map(m => pos.get(m));
        return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : Infinity;
      };
      layers[i].sort((a, b) => bary(a) - bary(b));
    }
    // Place layers as columns, wrapping tall layers into sub-columns.
    const placed = [];
    let x = 0;
    let groupH = 0;
    for (const layer of layers) {
      let colX = x;
      let y = 0;
      let colW = 0;
      for (const n of layer) {
        if (y > 0 && y + n.h > MAX_COL_H) { colX += colW + GAP_X / 2; y = 0; colW = 0; }
        placed.push([n, colX, y]);
        y += n.h + GAP_Y;
        colW = Math.max(colW, n.w);
        groupH = Math.max(groupH, y);
      }
      x = colX + colW + GAP_X;
    }
    const groupW = x - GAP_X;
    if (cx > 0 && cx + groupW > MAX_ROW_W) { cx = 0; cy += rowH + GAP_X; rowH = 0; }
    for (const [n, px, py] of placed) { n.x = cx + px; n.y = cy + py; }
    cx += groupW + GAP_X * 1.5;
    rowH = Math.max(rowH, groupH);
  }

  // Unrelated tables: simple flowing grid below everything else.
  if (isolated.length) {
    isolated.sort((a, b) => a.id.localeCompare(b.id));
    let x = 0;
    let y = groups.length ? cy + rowH + GAP_X : 0;
    let lineH = 0;
    const lineW = Math.max(MAX_ROW_W * 0.75, cx);
    for (const n of isolated) {
      if (x > 0 && x + n.w > lineW) { x = 0; y += lineH + GAP_Y; lineH = 0; }
      n.x = x;
      n.y = y;
      x += n.w + GAP_Y * 1.5;
      lineH = Math.max(lineH, n.h);
    }
  }
}

function rowY(node, row) {
  return node.y + (row < 0 ? HEAD_H / 2 : HEAD_H + row * ROW_H + ROW_H / 2);
}

function edgePath(e) {
  const a = e.from;
  const b = e.to;
  const ay = rowY(a, e.fromRow);
  const by = rowY(b, e.toRow);
  if (a === b) {
    const x = a.x + a.w;
    return `M${x},${ay} C${x + 60},${ay} ${x + 60},${by} ${x},${by}`;
  }
  let ax; let bx; let da; let db;
  if (a.x + a.w + 30 < b.x) { ax = a.x + a.w; bx = b.x; da = 1; db = -1; }
  else if (b.x + b.w + 30 < a.x) { ax = a.x; bx = b.x + b.w; da = -1; db = 1; }
  else { ax = a.x + a.w; bx = b.x + b.w; da = 1; db = 1; } // stacked vertically: loop out on the right
  const k = da === db ? 50 + Math.abs(ax - bx) / 2 : Math.max(40, Math.abs(bx - ax) / 2);
  return `M${ax},${ay} C${ax + da * k},${ay} ${bx + db * k},${by} ${bx},${by}`;
}

function bounds(nodes) {
  if (!nodes.length) return { x: 0, y: 0, w: 100, h: 100 };
  const x1 = Math.min(...nodes.map(n => n.x));
  const y1 = Math.min(...nodes.map(n => n.y));
  const x2 = Math.max(...nodes.map(n => n.x + n.w));
  const y2 = Math.max(...nodes.map(n => n.y + n.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

// --- draw.io export -----------------------------------------------------------

function toDrawio(model, title) {
  const cells = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>'];
  const cellId = new Map();
  model.nodes.forEach((n, i) => {
    const tid = `t${i}`;
    cellId.set(n, tid);
    cells.push(`<mxCell id="${tid}" value="${xmlEsc(n.title)}" style="swimlane;fontStyle=1;childLayout=stackLayout;horizontal=1;startSize=${HEAD_H};horizontalStack=0;resizeParent=1;resizeParentMax=0;resizeLast=0;collapsible=1;marginBottom=0;fillColor=#dae8fc;strokeColor=#6c8ebf;rounded=1;arcSize=4;" vertex="1" parent="1">` +
      `<mxGeometry x="${Math.round(n.x)}" y="${Math.round(n.y)}" width="${n.w + 30}" height="${n.h}" as="geometry"/></mxCell>`);
    n.rows.forEach((r, j) => {
      const tag = [r.pk ? 'PK' : '', r.fk ? 'FK' : ''].filter(Boolean).join(',');
      const label = `${tag ? tag + '  ' : ''}${r.name} : ${r.type}${r.nullable ? '' : ' NN'}`;
      cells.push(`<mxCell id="${tid}r${j}" value="${xmlEsc(label)}" style="text;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;spacingLeft=6;spacingRight=4;overflow=hidden;rotatable=0;points=[[0,0.5],[1,0.5]];portConstraint=eastwest;fontStyle=${r.pk ? 1 : 0};" vertex="1" parent="${tid}">` +
        `<mxGeometry y="${HEAD_H + j * ROW_H}" width="${n.w + 30}" height="${ROW_H}" as="geometry"/></mxCell>`);
    });
  });
  model.edges.forEach((e, i) => {
    const src = e.fromRow >= 0 ? `${cellId.get(e.from)}r${e.fromRow}` : cellId.get(e.from);
    const dst = e.toRow >= 0 ? `${cellId.get(e.to)}r${e.toRow}` : cellId.get(e.to);
    cells.push(`<mxCell id="e${i}" value="" style="edgeStyle=entityRelationEdgeStyle;fontSize=12;endArrow=ERmandOne;startArrow=${e.nullable ? 'ERzeroToMany' : 'ERoneToMany'};endFill=0;startFill=0;" edge="1" parent="1" source="${src}" target="${dst}">` +
      `<mxGeometry relative="1" as="geometry"/></mxCell>`);
  });
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<mxfile host="PostAdmin" type="device"><diagram id="erd" name="${xmlEsc(title)}">` +
    '<mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" math="0" shadow="0">' +
    `<root>${cells.join('')}</root></mxGraphModel></diagram></mxfile>\n`;
}

// --- query reflection -------------------------------------------------------

// Splits SQL into identifier chains (e.g. public.orders → ['public', 'orders'], o.id → ['o', 'id']).
// Comments and string literals are dropped; unquoted names fold to lower case like Postgres does.
function identifierChains(sql) {
  const clean = sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, ' ')
    .replace(/'(?:[^']|'')*'/g, ' ');
  const chains = [];
  let chain = [];
  let expectPart = false;
  const re = /"((?:[^"]|"")+)"|([A-Za-z_][\w$]*)|(\.)|(\S)/g;
  let m;
  while ((m = re.exec(clean))) {
    if (m[1] !== undefined || m[2] !== undefined) {
      const name = m[1] !== undefined ? m[1].replace(/""/g, '"') : m[2].toLowerCase();
      if (expectPart) chain.push(name);
      else { if (chain.length) chains.push(chain); chain = [name]; }
      expectPart = false;
    } else if (m[3]) {
      expectPart = chain.length > 0;
    } else {
      if (chain.length) chains.push(chain);
      chain = [];
      expectPart = false;
    }
  }
  if (chain.length) chains.push(chain);
  return chains;
}

// Which tables (and which of their columns) a query mentions.
function queryReferences(sql, model) {
  const chains = identifierChains(sql);
  const words = new Set(chains.flat());
  const pairs = new Set(chains.flatMap(c => c.slice(1).map((name, i) => `${c[i]}.${name}`)));
  const tables = new Set(model.nodes.filter(n => pairs.has(n.id) || words.has(n.table)));
  const columns = new Map();
  for (const n of tables) columns.set(n, new Set(n.rows.filter(r => words.has(r.name)).map(r => r.name)));
  return { tables, columns };
}

// --- page -------------------------------------------------------------------

export async function render(ctx, el) {
  const scopeLabel = ctx.schema ? `${ctx.db}.${ctx.schema}` : ctx.db;
  const storageKey = `pa-erd:${ctx.id}/${ctx.db}/${ctx.schema || '*'}`;
  const saved = loadSaved(storageKey);
  const q = ctx.schema ? `?schemas=${encodeURIComponent(ctx.schema)}` : '';
  const fetchData = () => api.get(paths.db(ctx.id, ctx.db) + '/erd' + q);
  let data = await fetchData();

  if (!data.tables.length) {
    append(el, h('div', { class: 'card empty' }, 'No tables to diagram here.'));
    return;
  }

  let keysOnly = !!saved.keysOnly;
  let model;
  let view = saved.view || null; // { x, y, k }

  const colors = () => ({
    panel: cssVar('--panel'), border: cssVar('--border'), text: cssVar('--text'), muted: cssVar('--muted'),
    accent: cssVar('--accent'), alt: cssVar('--row-alt'), bg: cssVar('--bg'), danger: cssVar('--danger'),
  });

  // Toolbar
  const search = h('input', { type: 'search', placeholder: 'Find table…', style: { width: '180px' } });
  const keysBox = h('input', { type: 'checkbox', checked: keysOnly });
  const zoomLabel = h('span', { class: 'muted small', style: { minWidth: '42px', textAlign: 'right' } });
  const stats = h('span', { class: 'muted' });
  const fsBtn = h('button', { title: 'Fullscreen (Esc to exit)', onclick: () => toggleFullscreen() }, '⛶ Fullscreen');
  const queryBanner = h('div', { class: 'erd-query-banner', style: { display: 'none' } });
  const wrap = h('div', { class: 'erd-wrap' });
  el.append(wrap);
  append(wrap,
    h('div', { class: 'toolbar' },
      h('h2', { style: { margin: 0 } }, `ER diagram — ${scopeLabel}`),
      stats,
      h('span', { class: 'spacer' }),
      h('button', { title: 'Open a SQL window; the tables your query uses light up here', onclick: () => openQueryWindow() }, '⧉ Query window'),
      search,
      h('label', { class: 'inline' }, keysBox, 'keys only'),
      h('button', { title: 'Re-arrange all tables', onclick: () => { autoLayout(model.nodes, model.edges); persist(); draw(); fit(); } }, 'Auto layout'),
      h('button', { title: 'Zoom out', onclick: () => zoomBy(1 / 1.2) }, '−'),
      zoomLabel,
      h('button', { title: 'Zoom in', onclick: () => zoomBy(1.2) }, '+'),
      h('button', { onclick: () => fit() }, 'Fit'),
      fsBtn,
      exportMenu()),
    h('div', { class: 'muted small', style: { marginBottom: '6px' } },
      'Drag tables to arrange them (positions are remembered) · drag the background to pan · scroll to zoom · double-click a table to open it · hover a table to highlight its relations'),
    queryBanner);

  const svg = s('svg', { class: 'erd', width: '100%', height: '100%', 'font-family': '"Segoe UI", Roboto, Arial, sans-serif', 'font-size': 12 });
  const host = h('div', { class: 'erd-host' });
  host.append(svg);
  wrap.append(host);

  const defs = s('defs');
  const viewport = s('g');
  const edgeLayer = s('g');
  const nodeLayer = s('g');
  viewport.append(edgeLayer, nodeLayer);
  svg.append(defs, viewport);

  function buildDefs(c) {
    defs.replaceChildren(
      // "one" end: two bars next to the referenced table
      s('marker', { id: 'erd-one', viewBox: '-14 -8 16 16', refX: 0, refY: 0, markerWidth: 16, markerHeight: 16, markerUnits: 'userSpaceOnUse', orient: 'auto-start-reverse' },
        s('path', { d: 'M-6,-6 L-6,6 M-10,-6 L-10,6', stroke: c.muted, 'stroke-width': 1.4, fill: 'none' })),
      // "many" end: crow's foot at the referencing table
      s('marker', { id: 'erd-many', viewBox: '-16 -8 18 16', refX: 0, refY: 0, markerWidth: 18, markerHeight: 16, markerUnits: 'userSpaceOnUse', orient: 'auto-start-reverse' },
        s('path', { d: 'M-12,0 L0,-6 M-12,0 L0,6 M-12,0 L0,0 M-15,-6 L-15,6', stroke: c.muted, 'stroke-width': 1.4, fill: 'none' })),
      s('marker', { id: 'erd-one-hi', viewBox: '-14 -8 16 16', refX: 0, refY: 0, markerWidth: 16, markerHeight: 16, markerUnits: 'userSpaceOnUse', orient: 'auto-start-reverse' },
        s('path', { d: 'M-6,-6 L-6,6 M-10,-6 L-10,6', stroke: c.accent, 'stroke-width': 2, fill: 'none' })),
      s('marker', { id: 'erd-many-hi', viewBox: '-16 -8 18 16', refX: 0, refY: 0, markerWidth: 18, markerHeight: 16, markerUnits: 'userSpaceOnUse', orient: 'auto-start-reverse' },
        s('path', { d: 'M-12,0 L0,-6 M-12,0 L0,6 M-12,0 L0,0 M-15,-6 L-15,6', stroke: c.accent, 'stroke-width': 2, fill: 'none' })));
  }

  function rebuild() {
    model = buildModel(data, keysOnly);
    const positions = saved.positions || {};
    const missing = model.nodes.filter(n => !positions[n.id]);
    if (missing.length === model.nodes.length) {
      autoLayout(model.nodes, model.edges);
    } else {
      for (const n of model.nodes) if (positions[n.id]) Object.assign(n, positions[n.id]);
      if (missing.length) {
        // New tables since the last visit: lay them out on their own and park them below.
        const b = bounds(model.nodes.filter(n => positions[n.id]));
        autoLayout(missing, model.edges.filter(e => missing.includes(e.from) && missing.includes(e.to)));
        for (const n of missing) n.y += b.y + b.h + 120;
      }
    }
    stats.textContent = `${model.nodes.length} tables · ${model.edges.length} relations`;
  }

  function persist() {
    saved.positions = Object.fromEntries(model.nodes.map(n => [n.id, { x: Math.round(n.x), y: Math.round(n.y) }]));
    saved.keysOnly = keysOnly;
    saved.view = view;
    store(storageKey, saved);
  }

  const edgeEls = new Map(); // edge -> path

  function drawEdges() {
    for (const [e, path] of edgeEls) path.setAttribute('d', edgePath(e));
  }

  function draw() {
    const c = colors();
    buildDefs(c);
    edgeEls.clear();
    edgeLayer.replaceChildren(...model.edges.map(e => {
      const path = s('path', {
        d: edgePath(e), fill: 'none', stroke: c.muted, 'stroke-width': 1.3, opacity: 0.75,
        'stroke-dasharray': e.nullable ? '5 3' : null,
        'marker-start': 'url(#erd-many)', 'marker-end': 'url(#erd-one)',
      }, s('title', {}, `${e.name}\n${e.from.table}.${e.label}`));
      edgeEls.set(e, path);
      return path;
    }));

    nodeLayer.replaceChildren(...model.nodes.map(n => {
      const g = s('g', { transform: `translate(${n.x},${n.y})`, class: 'erd-table', 'data-id': n.id });
      g.append(
        s('title', {}, n.comment ? `${n.id}\n${n.comment}` : n.id),
        s('rect', { x: 2, y: 3, width: n.w, height: n.h, rx: 6, fill: '#000', opacity: 0.12 }),
        s('rect', { class: 'erd-frame', width: n.w, height: n.h, rx: 6, fill: c.panel, stroke: c.border, 'stroke-width': 1 }),
        s('path', { d: `M0,6 a6,6 0 0 1 6,-6 h${n.w - 12} a6,6 0 0 1 6,6 v${HEAD_H - 6} h${-n.w} z`, fill: c.accent }),
        s('text', { x: PAD_X, y: HEAD_H / 2 + 4.5, fill: '#fff', 'font-weight': 'bold', 'font-size': 13 }, n.title));
      n.rows.forEach((r, i) => {
        const y = HEAD_H + i * ROW_H;
        if (i % 2) g.append(s('rect', { x: 1, y, width: n.w - 2, height: ROW_H, fill: c.alt }));
        const badge = r.pk ? 'PK' : r.fk ? 'FK' : '';
        if (badge) {
          g.append(s('text', { x: PAD_X, y: y + 14, 'font-size': 9, 'font-weight': 'bold', fill: r.pk ? '#d4a017' : c.accent }, badge));
        }
        g.append(
          s('text', { x: PAD_X + BADGE_W, y: y + 14, fill: c.text, 'font-weight': r.pk ? 'bold' : null }, r.name),
          s('text', { x: n.w - PAD_X, y: y + 14, fill: c.muted, 'text-anchor': 'end' }, r.type + (r.nullable ? '' : ' ●')));
      });
      if (!n.rows.length) g.append(s('text', { x: PAD_X, y: HEAD_H + 14, fill: c.muted, 'font-style': 'italic' }, 'no key columns'));
      n.el = g;
      return g;
    }));
    setQuery(querySql); // nodes were rebuilt: recompute query matches + emphasis
  }

  // --- view transform -------------------------------------------------------

  function applyView() {
    viewport.setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.k})`);
    zoomLabel.textContent = `${Math.round(view.k * 100)}%`;
  }

  function fit(nodes = model.nodes) {
    const b = bounds(nodes);
    const W = host.clientWidth || 1000;
    const H = host.clientHeight || 600;
    const k = Math.min(1.2, Math.max(0.1, Math.min((W - 40) / b.w, (H - 40) / b.h)));
    view = { k, x: (W - b.w * k) / 2 - b.x * k, y: (H - b.h * k) / 2 - b.y * k };
    applyView();
    persist();
  }

  function zoomBy(f, cx = host.clientWidth / 2, cy = host.clientHeight / 2) {
    const k = Math.min(3, Math.max(0.08, view.k * f));
    view = { k, x: cx - (cx - view.x) * (k / view.k), y: cy - (cy - view.y) * (k / view.k) };
    applyView();
    persist();
  }

  svg.addEventListener('wheel', ev => {
    ev.preventDefault();
    const r = svg.getBoundingClientRect();
    zoomBy(ev.deltaY < 0 ? 1.12 : 1 / 1.12, ev.clientX - r.left, ev.clientY - r.top);
  }, { passive: false });

  // --- dragging & panning ----------------------------------------------------

  let drag = null;
  svg.addEventListener('pointerdown', ev => {
    if (ev.button !== 0) return;
    const g = ev.target.closest('.erd-table');
    const node = g && model.byId.get(g.dataset.id);
    drag = node
      ? { type: 'node', node, sx: ev.clientX, sy: ev.clientY, ox: node.x, oy: node.y }
      : { type: 'pan', sx: ev.clientX, sy: ev.clientY, ox: view.x, oy: view.y };
    if (node) nodeLayer.append(node.el); // bring to front
    svg.setPointerCapture(ev.pointerId);
    svg.classList.add('dragging');
  });
  svg.addEventListener('pointermove', ev => {
    if (!drag) return;
    const dx = ev.clientX - drag.sx;
    const dy = ev.clientY - drag.sy;
    if (drag.type === 'node') {
      drag.node.x = drag.ox + dx / view.k;
      drag.node.y = drag.oy + dy / view.k;
      drag.node.el.setAttribute('transform', `translate(${drag.node.x},${drag.node.y})`);
      drawEdges();
    } else {
      view.x = drag.ox + dx;
      view.y = drag.oy + dy;
      applyView();
    }
  });
  const endDrag = () => {
    if (!drag) return;
    drag = null;
    svg.classList.remove('dragging');
    persist();
  };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);

  svg.addEventListener('dblclick', ev => {
    const g = ev.target.closest('.erd-table');
    const node = g && model.byId.get(g.dataset.id);
    if (node) go({ id: ctx.id, db: ctx.db, schema: node.schema, table: node.table });
  });

  // Hover: highlight a table's relations.
  svg.addEventListener('pointerover', ev => {
    if (drag) return;
    const g = ev.target.closest('.erd-table');
    highlight(g ? model.byId.get(g.dataset.id) : null);
  });

  let highlighted = null;
  function highlight(node) {
    if (node === highlighted) return;
    highlighted = node;
    styleEdges();
  }

  // --- emphasis: hover, search and the linked query window ---------------------

  let querySql = '';
  let queryRefs = null; // { tables: Set<node>, columns: Map<node, Set<name>> } or null

  function styleEdges() {
    const c = colors();
    for (const [e, path] of edgeEls) {
      let state = 'normal';
      if (highlighted) state = e.from === highlighted || e.to === highlighted ? 'on' : 'dim';
      else if (queryRefs) state = queryRefs.tables.has(e.from) && queryRefs.tables.has(e.to) ? 'on' : 'dim';
      const on = state === 'on';
      path.setAttribute('stroke', on ? c.accent : c.muted);
      path.setAttribute('stroke-width', on ? 2.2 : 1.3);
      path.setAttribute('opacity', state === 'dim' ? 0.2 : on ? 1 : 0.75);
      path.setAttribute('marker-start', on ? 'url(#erd-many-hi)' : 'url(#erd-many)');
      path.setAttribute('marker-end', on ? 'url(#erd-one-hi)' : 'url(#erd-one)');
      if (on) edgeLayer.append(path);
    }
  }

  function applyEmphasis() {
    const term = search.value.trim().toLowerCase();
    const c = colors();
    for (const n of model.nodes) {
      const frame = n.el.querySelector('.erd-frame');
      n.el.querySelectorAll('.erd-qrow').forEach(r => r.remove());
      const searchHit = term && n.id.toLowerCase().includes(term);
      const queryHit = queryRefs?.tables.has(n);
      frame.setAttribute('stroke', searchHit ? c.danger : queryHit ? c.accent : c.border);
      frame.setAttribute('stroke-width', searchHit || queryHit ? 3 : 1);
      const dim = (term && !searchHit) || (queryRefs && !queryHit && !searchHit);
      n.el.setAttribute('opacity', dim ? 0.3 : 1);
      if (queryHit) {
        const cols = queryRefs.columns.get(n);
        n.rows.forEach((r, i) => {
          if (!cols.has(r.name)) return;
          const y = HEAD_H + i * ROW_H;
          n.el.append(
            s('rect', { class: 'erd-qrow', x: 1, y, width: n.w - 2, height: ROW_H, fill: c.accent, opacity: 0.18, 'pointer-events': 'none' }),
            s('rect', { class: 'erd-qrow', x: 1, y, width: 3, height: ROW_H, fill: c.accent, 'pointer-events': 'none' }));
        });
      }
    }
    styleEdges();
  }
  search.addEventListener('input', applyEmphasis);

  function setQuery(sql) {
    querySql = sql || '';
    queryRefs = querySql.trim() ? queryReferences(querySql, model) : null;
    if (queryRefs && !queryRefs.tables.size) queryRefs = null;
    if (!queryRefs) {
      queryBanner.style.display = querySql.trim() ? '' : 'none';
      clear(queryBanner, h('span', { class: 'muted' }, 'Query window linked — no tables from this diagram in the current query yet.'));
    } else {
      const names = [...queryRefs.tables].map(n => n.title);
      const colCount = [...queryRefs.columns.values()].reduce((a, s2) => a + s2.size, 0);
      queryBanner.style.display = '';
      clear(queryBanner,
        h('strong', null, `Query uses ${names.length} table${names.length === 1 ? '' : 's'}`),
        h('span', { class: 'muted' }, ` (${colCount} column${colCount === 1 ? '' : 's'}): `),
        h('span', { class: 'mono' }, names.join(', ')),
        h('span', { class: 'spacer' }),
        h('button', { onclick: () => fit([...queryRefs.tables]) }, 'Focus'),
        h('button', { onclick: () => setQuery('') }, 'Clear'));
    }
    applyEmphasis();
  }

  function openQueryWindow() {
    const url = `${location.pathname}${link({ id: ctx.id, db: ctx.db, schema: ctx.schema, tab: 'sql' })}&popup=1`;
    const win = window.open(url, `pa-query-${ctx.id}-${ctx.db}`, 'width=1000,height=720');
    if (!win) return toast('Popup blocked — allow popups for this site', 'error');
    win.focus();
  }

  // Messages from any SQL editor on the same connection + database (BroadcastChannel spans windows).
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel('postadmin-sql') : null;
  if (channel) {
    channel.onmessage = async ({ data: m }) => {
      if (!wrap.isConnected) { channel.close(); return; }
      if (m.connId !== ctx.id || m.db !== ctx.db) return;
      if (m.type === 'sql') setQuery(m.sql);
      if (m.type === 'ran' && m.schemaChanged) {
        try {
          persist();
          data = await fetchData();
          rebuild();
          draw();
          toast('Schema changed — diagram updated');
        } catch (err) {
          toast(err.message, 'error');
        }
      }
    };
    channel.postMessage({ type: 'erd-ready', connId: ctx.id, db: ctx.db });
  }
  search.addEventListener('keydown', ev => {
    if (ev.key !== 'Enter') return;
    const term = search.value.trim().toLowerCase();
    const n = model.nodes.find(x => x.id.toLowerCase().includes(term));
    if (!n) return toast('No matching table', 'error');
    const k = Math.max(view.k, 0.9);
    view = { k, x: host.clientWidth / 2 - (n.x + n.w / 2) * k, y: host.clientHeight / 2 - (n.y + n.h / 2) * k };
    applyView();
  });

  keysBox.addEventListener('change', () => {
    persist();
    keysOnly = keysBox.checked;
    saved.keysOnly = keysOnly;
    rebuild();
    draw();
    persist();
  });

  // --- fullscreen -----------------------------------------------------------

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else wrap.requestFullscreen().catch(err => toast(`Fullscreen unavailable: ${err.message}`, 'error'));
  }
  const onFullscreen = () => {
    if (!wrap.isConnected) return document.removeEventListener('fullscreenchange', onFullscreen);
    const on = document.fullscreenElement === wrap;
    fsBtn.textContent = on ? '✕ Exit fullscreen' : '⛶ Fullscreen';
    requestAnimationFrame(() => fit());
  };
  document.addEventListener('fullscreenchange', onFullscreen);

  // --- exports --------------------------------------------------------------

  const fileBase = `erd-${scopeLabel.replace(/[^\w.-]+/g, '_')}`;

  function exportMenu() {
    const items = [
      ['draw.io (.drawio)', 'Editable in diagrams.net / draw.io', () => exportDrawio()],
      ['SVG image', 'Vector, sharp at any zoom', () => exportSvg()],
      ['PNG image', 'Raster, 2× resolution', () => exportPng()],
    ];
    const menu = h('div', { class: 'dropdown-menu' }, items.map(([label, hint, action]) =>
      h('button', { class: 'dropdown-item', onclick: () => { close(); action(); } },
        h('span', null, label), h('span', { class: 'muted small' }, hint))));
    const btn = h('button', { class: 'primary', 'aria-haspopup': 'menu', onclick: ev => { ev.stopPropagation(); menu.classList.contains('open') ? close() : open(); } }, '⬇ Export ERD ▾');
    const onDoc = ev => { if (!root.contains(ev.target)) close(); };
    const onKey = ev => { if (ev.key === 'Escape') close(); };
    function open() {
      menu.classList.add('open');
      document.addEventListener('pointerdown', onDoc);
      document.addEventListener('keydown', onKey);
    }
    function close() {
      menu.classList.remove('open');
      document.removeEventListener('pointerdown', onDoc);
      document.removeEventListener('keydown', onKey);
    }
    const root = h('div', { class: 'dropdown' }, btn, menu);
    return root;
  }

  function exportDrawio() {
    saveBlob(`${fileBase}.drawio`, new Blob([toDrawio(model, scopeLabel)], { type: 'application/xml' }));
    toast('Saved .drawio — open it at app.diagrams.net (File → Open) or drag it into draw.io');
  }

  function standaloneSvg() {
    const b = bounds(model.nodes);
    const pad = 40;
    const clone = svg.cloneNode(true);
    clone.setAttribute('xmlns', SVGNS);
    clone.setAttribute('viewBox', `${b.x - pad} ${b.y - pad} ${b.w + pad * 2 + 60} ${b.h + pad * 2}`);
    clone.setAttribute('width', b.w + pad * 2 + 60);
    clone.setAttribute('height', b.h + pad * 2);
    clone.setAttribute('font-family', '"Segoe UI", Roboto, Arial, sans-serif');
    clone.setAttribute('font-size', '12');
    clone.removeAttribute('class');
    clone.querySelector('g').removeAttribute('transform');
    clone.insertBefore(s('rect', { x: b.x - pad, y: b.y - pad, width: b.w + pad * 2 + 60, height: b.h + pad * 2, fill: colors().bg }), clone.firstChild.nextSibling);
    return { markup: new XMLSerializer().serializeToString(clone), w: b.w + pad * 2 + 60, h: b.h + pad * 2 };
  }

  function exportSvg() {
    saveBlob(`${fileBase}.svg`, new Blob([standaloneSvg().markup], { type: 'image/svg+xml' }));
  }

  function exportPng() {
    const { markup, w, h: ht } = standaloneSvg();
    const scale = Math.min(2, 12000 / Math.max(w, ht));
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(ht * scale);
      const g = canvas.getContext('2d');
      g.scale(scale, scale);
      g.drawImage(img, 0, 0);
      canvas.toBlob(blob => blob ? saveBlob(`${fileBase}.png`, blob) : toast('Diagram too large for PNG; use SVG', 'error'), 'image/png');
    };
    img.onerror = () => toast('PNG export failed; use SVG instead', 'error');
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup);
  }

  // --- go -------------------------------------------------------------------

  rebuild();
  draw();
  if (view) applyView();
  else fit();
}
