# Unify lab reports template

A configurable Unify site with a compact dashboard, Markdown/HTML reports,
guides, articles, searchable page directory, and thumb-friendly mobile navigation.
No database, hosted control plane, or required monitoring service.

## Start

Requirements: Bun 1.4+, Python 3.10+, and Git. Docker is optional. Windows users
can run the publishing container or use WSL2; remote Windows observation uses
native OpenSSH and PowerShell.

Copy `.env.example` to ignored `.env`, set your branding, then:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run dev
```

The default lab lists are empty. The dashboard shows **not collected**, not
fictional healthy hosts. All site builds are offline: building never probes a
host, invokes collection, installs a service or modifies report sources.

## Configure your lab

- `.env`: branding, public footer links, timezone, retention and optional
  collection/publishing settings. Inherited environment wins over `.env`,
  which wins over `site.config.json` defaults.
- `lab.json`: host definitions, endpoint URLs, thresholds, backup jobs,
  expected coverage and exclusions. Configure these lists rather than editing code.
- `state/`: ignored collector snapshots and restart baselines. Private runtime
  state is not packaged or served.

The starter [collection guide](site/docs/runbooks/collection.md) and
[backup guide](site/docs/services/backups.md) show complete examples and explain
what each signal proves. Use `LAB_CONFIG` for another configuration file and
`LAB_SNAPSHOT` for an existing compatible snapshot. Paths are relative to the
project root unless absolute. Do not put credentials in public settings or URLs.

```sh
bun run collect                       # explicit read-only collection
bun run build                         # strict audited static build
bun run test                          # fixture-based regressions
bun run retain:health                 # retention preview, no deletion
```

Collection uses configured native SSH accounts with strict host-key checking.
It supports Linux, macOS and Windows basic host facts. Linux also supplies
Docker health/restarts, bounded system-log error counts and existing backup-job
evidence. It installs nothing on hosts and never copies raw logs or environment.
Unsupported or inaccessible signals remain unknown. Optional hosts/endpoints
and observation windows prevent intentional downtime from looking like failure.

## Write reports

Write ordinary Markdown or HTML in `site/articles/`, `site/incidents/`,
`site/health/`, and `site/docs/`. Give each page a title and description; incidents
and weekly reviews also require a real ISO observation date. Optional `tags`,
`series`, and `part` drive navigation through Unify's source inventory.
Generated collections and the dashboard never write back to these files.
An authored `site/index.html` or inventory page can replace its generated view.

Weekly retention uses `REPORTS_HEALTH_PREFIX` (default `lab`) and
`REPORTS_WEEKLY_KEEP` (default two). Only matching timestamped review/spot files
qualify. Spots are not published. `--apply --commit` is explicit and requires
Git recovery; modified reports, invalid dates, symlinks and collisions stop or
skip cleanup. Publisher builds do not delete or automatically commit source.

## Docker publication

See [DEPLOY.md](DEPLOY.md). The optional non-root builder checks YOUR site repo,
builds changed source or observation/configuration input, and atomically updates
static output. A failed build retains the previous release. Use an existing
Caddy/nginx/static host to serve it; the builder opens no ports. Collection is
default-off and uses the same container's existing loop when enabled. No Docker
socket, privileged mode or native host cron/systemd service is required.

## Template distribution

Planned npm package: `@fwdslsh/unify-lab-reports-template`. `npm pack` produces the same
flat project files used by directory and Git sources, with an explicit allowlist
and no install hooks. Source content is anonymous examples, not a sanitized copy
of private lab history. Development tests and the lockfile are included so the
scaffold remains independently verifiable.

Unify's custom `init` support for directories, Git and npm is in development.
The currently pinned 0.10.1 does not yet accept this package as an init source.
No speculative manifest, installer wrapper or command syntax is supplied.
Release acceptance must run the packed artifact through the real custom-init
contract once its implementation is available, then update the tested Unify pin.

To inspect the npm artifact now:

```sh
npm pack --ignore-scripts
tar -tzf fwdslsh-unify-lab-reports-template-0.1.0-alpha.1.tgz
```

No npm release or public repository publication is automatic. See
[NOTICE.md](NOTICE.md) for attribution. Template code is MIT licensed; the reused
website visual theme retains its CC-BY-4.0 license.
