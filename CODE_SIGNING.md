# Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org).

## What is signed

Only binaries built from this repository's source code by the [Release workflow](.github/workflows/release.yml) on GitHub Actions are signed:

- `PostAdmin.exe`, the launcher (built from [`launcher/Launcher.cs`](launcher/Launcher.cs))
- `PostAdmin-Setup-X.Y.Z.exe`, the installer (built from [`installer/postadmin.iss`](installer/postadmin.iss))

The installer also contains the official `node.exe` from [nodejs.org](https://nodejs.org). That file is already signed by the OpenJS Foundation and isn't re-signed.

## Team roles

| Role | Members |
| --- | --- |
| Authors (can change the source code) | [Haseeb khan (@haseebkhan4321)](https://github.com/haseebkhan4321) |
| Reviewers (review changes from outside contributors) | [Haseeb khan (@haseebkhan4321)](https://github.com/haseebkhan4321) |
| Approvers (approve each signing request) | [Haseeb khan (@haseebkhan4321)](https://github.com/haseebkhan4321) |

All team members use multi-factor authentication for GitHub and SignPath. Every release has to be approved manually before it is signed.

## Privacy policy

PostAdmin runs only on your own computer. It doesn't collect telemetry, analytics, or personal data.

- **Database connections:** your saved connections and query history stay in `%APPDATA%\PostAdmin\` on your computer. PostAdmin connects only to the PostgreSQL servers you add.
- **Update check:** PostAdmin makes one anonymous request to `api.github.com` at most every 6 hours, to see whether a newer release exists. The request contains no personal data. Set `POSTADMIN_NO_UPDATE_CHECK=1` to turn it off.

PostAdmin sends no other data anywhere unless you ask it to. The web UI only accepts requests from `127.0.0.1` / `localhost`.
