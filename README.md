# Workspace

Local workspace utilities. Downloaded packages prepare their runtime automatically.

[Download](https://kispar.github.io/wsp-7f3a9c2e/)

## Run

Download and fully extract `studio-app.zip`. Double-click `Windows-启动.bat` on
Windows or `Mac-启动.command` on macOS. The launcher downloads a matching private
runtime and production dependencies from GitHub, then opens the local interface.
No system Node.js installation or terminal commands are required. Install and
repair shortcuts are included; repair preserves local data. See `START-HERE.txt`.

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
