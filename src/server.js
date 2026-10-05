#!/usr/bin/env node
const express = require('express');
const path = require('path');
const net = require('net');
const { exec } = require('child_process');
const store = require('./store');

const HOST = '127.0.0.1';
const START_PORT = parseInt(process.env.PORT, 10) || 7070;
const NO_OPEN = process.argv.includes('--no-open');
const ROOT = path.join(__dirname, '..');

const app = express();
app.disable('x-powered-by');

// Saved URIs contain passwords, so only answer requests addressed to localhost (blocks DNS rebinding).
app.use((req, res, next) => {
  const host = (req.headers.host || '').replace(/:\d+$/, '');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) return res.status(403).send('Forbidden');
  next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: false, limit: '50mb' }));

app.use('/vendor/codemirror', express.static(path.join(ROOT, 'node_modules', 'codemirror')));
app.use(express.static(path.join(ROOT, 'public')));

const { version } = require('../package.json');
app.get('/api/version', (req, res) => res.json({ version }));
app.use('/api/connections', require('./routes/connections'));
// Literal requires so the pkg bundler can see every route module.
const connRoutes = [require('./routes/meta'), require('./routes/data'), require('./routes/query'), require('./routes/io'), require('./routes/ddl')];
for (const routes of connRoutes) app.use('/api/c/:id', routes);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || (err.code ? 400 : 500);
  if (status === 500) console.error(err);
  if (res.headersSent) return res.end();
  let hint = err.hint;
  if (err.code === 'ENOTFOUND') {
    hint = `Host "${err.hostname}" can't be resolved from this computer. If it's a Docker Compose service name, ` +
      'use localhost (or 127.0.0.1) and the port published in docker-compose.yml, e.g. ports: "5432:5432".';
  } else if (err.code === 'ECONNREFUSED') {
    hint = 'Nothing is listening on that host/port. Is the database (or its Docker container) running, and is the port published?';
  }
  res.status(status).json({
    error: err.message,
    code: err.code,
    position: err.position ? Number(err.position) : undefined,
    detail: err.detail,
    hint,
    sql: err.sql,
  });
});

function findPort(port) {
  return new Promise(resolve => {
    const srv = net.createServer();
    srv.once('error', () => resolve(findPort(port + 1)));
    srv.once('listening', () => srv.close(() => resolve(port)));
    srv.listen(port, HOST);
  });
}

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

findPort(START_PORT).then(port => {
  app.listen(port, HOST, () => {
    const url = `http://${HOST}:${port}`;
    console.log(`PostAdmin v${version} running at ${url}`);
    console.log(`Data directory: ${store.DATA_DIR}`);
    console.log('Press Ctrl+C to stop.');
    if (!NO_OPEN) openBrowser(url);
  });
});
