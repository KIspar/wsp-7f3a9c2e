# Workspace

Local workspace utilities. Complete downloads include their core runtime.

[Download](https://kispar.github.io/wsp-7f3a9c2e/)

## Run

Download the matching **`studio-full-<platform>.zip`** and fully extract it.
Double-click `Windows-启动.bat` on Windows or `Mac-启动.command` on macOS.
The complete package includes Node.js and production dependencies: even the
first launch needs no environment download or system Node installation. It can
be copied to a new computer using a USB drive. Each OS/CPU needs its own package.

`studio-app.zip` and GitHub source archives do not bundle the runtime; avoid them
for a new offline installation. Repair first checks and reuses a healthy local
environment; missing/broken components require an online download or a fresh
complete package. Local data is preserved. See `START-HERE.txt`.

Optional Python video processing tools and speech models are not included in
the core package. Online model calls, balances and GitHub updates need internet;
offline installation does not make these services available offline.

For source development:

```sh
npm ci
npm run dev
```

The development interface runs at `http://127.0.0.1:5173`. Use the address printed by the launcher if a port is occupied.

```sh
npm run build
npm start
```

The production launcher serves the application locally, starting at port `4310`. Closing the launcher stops its background service.

## Updates

Stable releases include `latest.json` and `studio-app.tar.gz`. The local version panel checks and downloads public releases without a GitHub login. Installation saves pending changes, backs up local files, and restarts the application. Failed startup restores the previous version.

Use `npm start` for installation; development mode supports checking and downloading only. Earlier installations without an updater require one manual upgrade.

## Local files

Runtime data stays in `data/`, or the directory selected with `STUDIO_DATA`. Keep credentials, databases, generated files and backups out of Git. Stop the service before restoring a backup. Do not share a data directory between running services.

## Checks

```sh
npm run typecheck
npm test -- --maxWorkers=4
```

Additional operational notes are in `docs/`.
