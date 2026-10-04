# Lab reports

A static lab dashboard with reports, guides and articles. Docker publishes Git
updates automatically. No database, host service or separate monitoring stack.

## Install on a server

The server needs Git and Docker Compose. It does not need Bun or Python.

1. Create your own repository from this template, then clone it to the server.
2. Edit `config.json`: your lab name and the endpoints you want to observe.
3. Copy `.env.example` to private `.env` and set your site's `REPO_URL`.
4. Follow [DEPLOY.md](DEPLOY.md) to start the builder and connect your existing
   web server. [Agent installation steps](docs/agent-install.md) cover the same
   process with checks and a handoff checklist.

Start with reports only. Enable collection when you want dashboard observations;
add SSH hosts and backup evidence later. An empty dashboard says “Not collected,”
not that the lab is healthy.

## Configure

- `config.json`: branding, hosts, endpoints and optional monitoring policy.
- `.env`: private Docker deployment settings only.
- `site/`: your Markdown/HTML reports and guides.

Defaults keep two weekly reviews, no spot reports, and conservative alert
thresholds. Only add optional settings when you need to change them. Examples
and defaults are in [Configuration](docs/configuration.md).

## Publish and manage

Commit and push reviewed content/config changes. The builder checks Git every
minute and atomically publishes successful audited builds. It keeps the last
good site on failure. Building never probes your lab; collection is separate.

Reports lists reviews and incidents. Guides and Articles contain longer-lived
material. All pages provides search. The brand opens the dashboard; the homepage
has no search. On phones navigation is a bottom bar.

[DEPLOY.md](DEPLOY.md#manage) covers logs, image updates, rollback and backup.
[Template updates](docs/template-updates.md) explains ownership and the current
Unify update limitation. Never rerun init over an existing site expecting a
safe update; it currently refuses existing files.

## Author locally (optional)

Install Bun 1.4+, then:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run dev
bun run test
bun run build
```

Every page needs a title and description; incidents and weekly reviews also
need their actual ISO observation date. Write new articles in `site/articles/`,
incidents in `site/incidents/`, reviews in `site/health/`. Optional tags, series
and part metadata drive navigation. Do not publish secrets, raw logs or databases.

Health retention previews with `bun run retain:health`; apply with
`bun run retain:health -- --apply --commit`. It checkpoints managed snapshots
in Git before deletion, preserving unknown/modified files. Publication does not
delete or automatically commit authored content.

## Native Unify initialization

Unify 0.11 supports directory, Git and npm template sources. From an empty
project directory, with Unify installed:

```sh
unify init /path/to/clean/template
# Or a repository you can clone:
unify init https://git.example.net/team/unify-lab-reports-template.git
```

Use a clean template checkout: directory init copies regular files, including
ignored runtime data if present. Use Git or the packed npm payload to avoid that.
Unify skips the template's root package manifest/lockfile. That is fine for Docker:
the image already contains pinned Unify. Run `unify dev` or `unify build` directly
for a native scaffold, not `bun run` package scripts that were not copied.

## Maintainers

[Maintainer checks](docs/maintaining.md) cover tests, packaging and release gates.
The package is `@fwdslsh/unify-lab-reports-template`; nothing is published to npm
automatically. MIT licensed, including the theme; dependencies keep their licenses.
