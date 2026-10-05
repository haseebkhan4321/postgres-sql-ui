export class ApiError extends Error {
  constructor(body, status) {
    super(body.error || `HTTP ${status}`);
    Object.assign(this, body, { status });
  }
}

async function request(method, url, body) {
  const opts = { method, headers: {} };
  if (body instanceof FormData) {
    opts.body = body;
  } else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch('/api' + url, opts);
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
  if (!res.ok) throw new ApiError(data, res.status);
  return data;
}

export const api = {
  get: url => request('GET', url),
  post: (url, body) => request('POST', url, body ?? {}),
  put: (url, body) => request('PUT', url, body ?? {}),
  del: (url, body) => request('DELETE', url, body),
};

const e = encodeURIComponent;

// URL builders for the per-connection API.
export const paths = {
  conn: id => `/c/${e(id)}`,
  db: (id, db) => `/c/${e(id)}/db/${e(db)}`,
  schema: (id, db, s) => `/c/${e(id)}/db/${e(db)}/schemas/${e(s)}`,
  table: (id, db, s, t) => `/c/${e(id)}/db/${e(db)}/schemas/${e(s)}/tables/${e(t)}`,
};
