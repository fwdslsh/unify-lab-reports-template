# Unify lab reports template

A static dashboard, reports, guides and articles. One runtime, one site config,
no database, and no monitoring service required.

## Start

Install Bun 1.4+, then:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run dev
```

Edit **config.json**. It contains branding, report retention, hosts, endpoints,
thresholds, backup jobs and exclusions. No .env file is needed to build or
preview the site. Unify's own build options remain in unify.yaml.

The starter has no hosts or fake telemetry. The dashboard honestly shows
“Not collected” until you configure and run collection.

## Source layout

- site/index.html: the homepage, including the generated dashboard fragment.
- site/articles/, site/incidents/, site/health/, site/docs/: authored content.
- includes/: shared navigation and footer.
- scripts/: JavaScript generator, collector, retention and publishing tools.
- config.json: the single source of site and lab settings.
- state/: ignored observation snapshots and publisher cache, not source.

Unify discovers source pages and metadata, composes HTML/Markdown, rewrites
URLs and builds search content. The generator uses that inventory; it does not
crawl another content source or replace authored files. The homepage has no
search; All pages provides the searchable directory.

## Observe your lab

```sh
bun run collect
bun run build
bun run test
```

Collection is explicit and read-only. Building is offline and never contacts
hosts or runs collection. SSH uses native accounts and strict host-key checking.
Linux checks use Bash and existing native utilities, not Python, Node or jq on
the observed host. macOS and Windows provide basic native host facts.

Linux observations include resources, container health/restarts, system-log
error counts and existing backup evidence. Raw logs, container environments and
HTTP response bodies are never published. Missing evidence stays unknown.
Optional hosts/endpoints and observation windows prevent intentional downtime
from becoming false outages.

See the [collection guide](site/docs/runbooks/collection.md) and
[backup guide](site/docs/services/backups.md) for config.json examples.
For a different config or snapshot, pass --config/--output to collect or use
CONFIG_FILE/SNAPSHOT_FILE. These are file locations, not a second settings
registry.

## Write and retain reports

Write ordinary Markdown or HTML. Every page needs title and description.
Incidents and weekly reviews also need a real ISO observation date.
Optional tags, series and part metadata drive navigation.

The default policy keeps two weekly snapshots and no spot reports. Only
timestamped files matching reports.prefix qualify. Unknown files, articles,
incidents, symlinks, invalid/future dates and modified snapshots are preserved
or stop cleanup. HTML/Markdown twins count as one snapshot.

```sh
bun run retain:health                  # preview only
bun run retain:health -- --apply --commit
```

Deletion requires Git recovery. Publication never deletes or auto-commits
authored reports.

## Host and distribute

See [DEPLOY.md](DEPLOY.md) for optional Docker publication. The builder fetches
your Git repo and reads config.json from that revision, avoiding a stale
image-baked or host-clone config. It publishes good builds atomically and retains
the last good site on failure. Optional collection uses that same container;
no host cron/systemd, extra server, privileged mode or Docker socket.

.env.example contains only optional deployment settings. It is not required for
local use and does not duplicate branding, inventory or policy.

Package: **@fwdslsh/unify-lab-reports-template**. npm pack creates an allowlisted
flat project payload with tests and lockfile, but no private environment, state
or installation hooks. Nothing is automatically published.

Unify's custom init support for directory/Git/npm sources is still in development.
The tested 0.10.1 cannot initialize this package directly yet. Before releasing,
verify all three sources using the real supported init contract; no custom
installer or speculative template manifest is supplied.

MIT licensed, including the theme, under the project owner's authorization.
External dependencies retain their own licenses.
