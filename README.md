# PostAdmin

PostAdmin is a phpMyAdmin-style manager for PostgreSQL that runs on your own computer. Paste a `postgres://` URI and it saves the connection locally. It then opens a web UI in your browser where you can browse, query, edit, import, and export data.

## Install (Windows)

1. Go to the [latest release](https://github.com/haseebkhan4321/postgres-sql-ui/releases/latest).
2. Download **`PostAdmin-Setup-X.Y.Z.exe`** and run it. You don't need Node.js or admin rights. By default it installs for your user only, and it can install for all users if you choose that.
3. The wizard adds a **PostAdmin** Start-menu shortcut, and a desktop icon if you tick that option. It can also start PostAdmin when it finishes.

### The launcher

Starting PostAdmin opens a small launcher window. It starts the server, then opens PostAdmin in your browser.

- The big round button starts and stops the server. It glows blue when the server is stopped, amber while it's starting, and green while it's running.
- **Open in browser** (or the address under the button) opens the UI. A short log shows what the server printed.
- Closing the window doesn't stop PostAdmin. It keeps running in the **system tray**, like Laragon. On Windows 11, click the **^** arrow next to the clock to see the icon, or drag it onto the taskbar to keep it visible. The icon's dot is green while the server runs.
- Click the tray icon to bring the window back. Right-click it for **Open in browser**, **Start/Stop server**, **Start with Windows** (starts in the tray at login) and **Exit**. **Exit** stops the server.
- Starting PostAdmin again while it's already running just brings up the existing window.

If Windows SmartScreen says "Windows protected your PC", click **More info**, then **Run anyway**. This happens because the installer isn't code-signed. The server itself runs on the official signed Node.js, so **Smart App Control** doesn't block it.

- **Update:** when a newer release is on GitHub, PostAdmin shows a banner at the top of the page with a **Download** link. Run the new setup over the old one. It replaces the old version and keeps your connections. If you dismiss the banner, it stays hidden until the next version comes out. The check runs at most every 6 hours, and nothing happens if you're offline. Set `POSTADMIN_NO_UPDATE_CHECK=1` to turn it off.
- **Uninstall:** use *Settings → Apps → PostAdmin*, or the *Uninstall PostAdmin* shortcut. Your saved connections and history in `%APPDATA%\PostAdmin\` are kept. Delete that folder if you want them gone too.
- **Portable:** the same release also includes `postadmin.exe`, a single file you can run from anywhere without installing it. It runs in a console window, without the launcher. It isn't signed, so it won't run on PCs with Smart App Control turned on. Use the installer on those PCs.

## Run from source

| How | Command |
| --- | --- |
| Double-click | `start.bat` (installs dependencies the first time) |
| Terminal | `npm install` then `npm start` |

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

After every push to `master`, the [Release workflow](.github/workflows/release.yml) checks the version in `package.json`. If GitHub has no `vX.Y.Z` tag for it yet, the workflow builds `postadmin.exe` and `PostAdmin-Setup-X.Y.Z.exe` on Windows, then publishes a GitHub Release with both files attached and creates the tag. The release notes come from that version's section in the changelog. Tags don't have to be pushed, so pushing from GitHub Desktop works. If the push step of a `release:*` script fails, push the commit with Desktop instead. You can watch the build in the repository's **Actions** tab.

## Code signing

Releases are set up for free signing through [SignPath Foundation](https://signpath.org). [CODE_SIGNING.md](CODE_SIGNING.md) is the project's code signing policy. The Release workflow signs the launcher and then the installer, but only once these are configured in the repository settings:

| Setting (Settings → Secrets and variables → Actions) | Kind | Value |
| --- | --- | --- |
| `SIGNPATH_API_TOKEN` | Secret | API token of the SignPath CI user (submitter permission) |
| `SIGNPATH_ORGANIZATION_ID` | Variable | SignPath organization ID |
| `SIGNPATH_PROJECT_SLUG` | Variable | SignPath project slug |
| `SIGNPATH_SIGNING_POLICY_SLUG` | Variable | e.g. `release-signing` |

The SignPath project needs two artifact configurations, with the slugs `launcher` and `installer`. Their contents are in [.signpath/artifact-configurations/](.signpath/artifact-configurations/). Until `SIGNPATH_ORGANIZATION_ID` is set, releases are built unsigned.

## Building the installer locally

You need [Inno Setup 6](https://jrsoftware.org/isdl.php) installed. The launcher is built with the C# compiler that comes with Windows (.NET Framework 4.x), so it needs nothing extra.

```sh
npm run build:exe        # dist/postadmin.exe (standalone server, bundles Node)
npm run build:launcher   # dist/PostAdmin-Launcher.exe (from launcher/Launcher.cs)
npm run build:installer  # dist/PostAdmin-Setup-X.Y.Z.exe (from installer/postadmin.iss)
npm run build:all        # all three, in order
```

The installer puts the launcher in the install folder as `PostAdmin.exe`. The server goes in `server\`: the official `node.exe` from nodejs.org (Node 22, checked against its published SHA-256 and cached in `dist/cache`), plus the app in `server\app\`. That Node build is signed, so Windows Smart App Control allows it, while the pkg-built `postadmin.exe` is unsigned and gets blocked. To try the launcher without installing, run `dist/PostAdmin-Launcher.exe`. It finds `postadmin.exe` in the same folder. The icon is `launcher/postadmin.ico`, and `launcher/make-icon.ps1` regenerates it.

The build script looks for `ISCC.exe` in the usual Inno Setup folders. If it's somewhere else, set `ISCC` to its full path. The installer version is read from `package.json`.
