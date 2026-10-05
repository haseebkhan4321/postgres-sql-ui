# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-10-05

### Added
- ERD **Query window** button. It opens a separate SQL editor window, and the ER diagram highlights the tables, columns and relations used by the selection or by the statement under the cursor. A banner lists the matched tables and offers Focus and Clear.
- The ER diagram reloads automatically after a CREATE, ALTER, DROP or COMMENT statement is run from any SQL editor on the same database.

### Changed
- The ERD export buttons are combined into one **Export ERD** dropdown with draw.io, SVG and PNG options.
- The ERD tab now comes after Import.

## [1.0.0] - 2026-10-05

### Added
- Local Node/Express server that opens a phpMyAdmin-style UI in the browser. The server binds to `127.0.0.1` and rejects requests for any other host.
- Saved connections from `postgres://` URIs, stored in `%APPDATA%\PostAdmin\connections.json`. Includes a connection test, a URI builder, and per-connection colors. SQLAlchemy-style schemes such as `postgresql+asyncpg://` are accepted.
- Sidebar tree of databases, schemas, tables, views, sequences and functions, with a filter.
- Browse grid:
  - Pagination, sorting and a `WHERE` filter. Filters run in a read-only transaction.
  - Inline cell editing, a row edit dialog, copy-to-insert, and single or bulk delete.
  - Editing by `ctid` for tables without a primary key.
  - Primary-key columns are shown first.
- SQL editor (CodeMirror):
  - Autocomplete, and running either the selection or the whole editor.
  - Multiple result sets, EXPLAIN and EXPLAIN ANALYZE, and highlighting of the error position.
  - Query history, and export of results to CSV.
- Structure view: add, change or drop columns; create or drop indexes; drop constraints.
- Operations: create and drop databases, schemas and tables; rename and truncate tables. Every change shows the SQL and asks for confirmation first.
- Export:
  - SQL dumps of one table, several tables or a whole schema, taken from one consistent snapshot. Dumps include sequences, identity resets, foreign keys and views.
  - CSV export of a single table.
- Import:
  - SQL from a file or pasted text, run in a single transaction.
  - CSV into a table via `COPY`, with columns matched by the header row.
- ER diagram tab:
  - Automatic layout, draggable tables, pan and zoom, search, a keys-only mode, and fullscreen.
  - Download as draw.io (`.drawio`), SVG or PNG.
- Light and dark themes.
- Builds a standalone Windows executable with `npm run build:exe`.
- Shows the version in the UI and serves it at `GET /api/version`.

[Unreleased]: https://github.com/haseebkhan4321/postgres-sql-ui/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/haseebkhan4321/postgres-sql-ui/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/haseebkhan4321/postgres-sql-ui/releases/tag/v1.0.0
