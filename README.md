# PostAdmin

PostAdmin is a phpMyAdmin-style manager for PostgreSQL that runs on your own computer. Paste a `postgres://` URI and it saves the connection locally. It then opens a web UI in your browser where you can browse, query, edit, import, and export data.

## Run

| How | Command |
| --- | --- |
| Double-click | `start.bat` (installs dependencies the first time) |
| Terminal | `npm install` then `npm start` |
| Standalone exe | `npm run build:exe` builds `dist/postadmin.exe`, which needs no Node install |

The server listens on `http://127.0.0.1:7070`, or the next free port, and opens your browser. You can control it with these settings:

- `PORT=8080` changes the starting port.
- `--no-open` starts the server without opening the browser.
- `npm run dev` restarts the server automatically when the code changes.

## Where data is stored

Everything is stored in `%APPDATA%\PostAdmin\`:

- `connections.json` holds your saved connections. **The URIs, including passwords, are stored in plain text.**
- `history.json` holds the last 200 queries.

Set `POSTADMIN_DATA` to use a different folder.

The server only answers requests addressed to `127.0.0.1` or `localhost`. Other machines on the network can't reach it.

## Features

- **Tree:** the sidebar shows databases, then schemas, then tables, views, materialized views, sequences, and functions. It has a filter box.
- **Browse:**
  - Pages of rows, with sorting by any column and a raw `WHERE` filter. Filters run in a read-only transaction.
  - Double-click a cell to edit it in place.
  - Each row has an edit dialog, a copy-row button, and a delete button. You can also delete many rows at once.
  - Tables without a primary key are edited by `ctid`.
- **SQL:**
  - A CodeMirror editor with autocomplete. Press Ctrl+Enter to run the whole editor or just the selection.
  - Multiple statements each get their own result.
  - EXPLAIN and EXPLAIN ANALYZE.
  - Errors are highlighted at the position Postgres reports.
  - Query history.
  - Export a query's results to CSV.
- **Structure:** view columns, indexes, and constraints. You can add, change, or drop columns, create and drop indexes, and drop constraints.
- **Operations:**
  - Create and drop databases, schemas, and tables.
  - Rename, truncate, and drop tables.
  - Every change shows the SQL first and asks you to confirm.
- **Export:**
  - SQL dumps of one table, several tables, or a whole schema, taken from one consistent snapshot. A dump includes the structure, data, sequences, foreign keys, and views.
  - CSV of a single table.
- **Import:**
  - SQL from a file or pasted text. By default it runs as a single transaction.
  - CSV into a table, using `COPY`. Columns are matched by the header row, and you can empty the table first.

- **ER diagram:**
  - An ERD tab on every database and schema draws the tables and their foreign keys. The layout is automatic, and you can drag tables to rearrange them (the positions are remembered).
  - Pan, zoom, search, a keys-only mode, and fullscreen.
  - **Query window:** opens a separate SQL editor. As you type, the tables and columns your statement uses light up on the diagram, and the diagram reloads when you change the schema.
  - Download the diagram as **draw.io** (`.drawio`, which opens in diagrams.net), **SVG**, or **PNG**.

SSL settings in the URI (`?sslmode=require`) are passed through. This lets hosted providers such as Neon, Supabase, and RDS work.

## Versioning

PostAdmin uses [Semantic Versioning](https://semver.org): `MAJOR.MINOR.PATCH`. Changes are recorded in [CHANGELOG.md](CHANGELOG.md). The current version appears next to the logo and at `GET /api/version`.

To release, add your changes under **Unreleased** in the changelog, commit, and then run one of these:

```sh
npm run release:patch   # bug fixes                 1.0.0 -> 1.0.1
npm run release:minor   # new backward-compatible features   1.0.0 -> 1.1.0
npm run release:major   # breaking changes          1.0.0 -> 2.0.0
```

Each command updates `package.json`, commits, creates a `vX.Y.Z` git tag, and pushes the commit and the tag.
