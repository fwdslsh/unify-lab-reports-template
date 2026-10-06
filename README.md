# Lab reports

A static lab dashboard with reports, guides and articles. Start with native
Unify; Git, Docker and automatic publication are optional. No database, host
service or separate monitoring stack.

## Install with Unify

Install Bun 1.4+ and Unify 0.11.6+, then initialize an empty project:

```sh
bun add --global @fwdslsh/unify@^0.11.6
mkdir my-lab-reports
cd my-lab-reports
unify init @fwdslsh/unify-lab-reports-template --audit
unify dev
```

The npm package supplies the template files; no template Git checkout is needed.
You can instead use `unify init https://github.com/fwdslsh/unify-lab-reports-template.git`
or `unify init /path/to/clean/template` with downloaded files.
Directory sources must be clean: Unify copies regular files, including ignored
runtime data if present.

Edit the branding in `site/_includes/header.html` and the palette/fonts in
`site/assets/theme.css`, then write Markdown/HTML under `site/`.
Preview with `unify dev`. Publish by building and serving **only dist/** with
any static web server:

```sh
unify build --clean --audit --strict
```

No site repository, `.env`, Docker container or `REPO_URL` is needed. Native init
skips root package manifests/lockfiles, so use `unify dev` and `unify build`
directly, not package scripts. [DEPLOY.md](DEPLOY.md) covers static hosting and
the optional automatic publisher. [Agent installation steps](docs/agent-install.md)
follow the same native setup path.

Start with reports only. Enable collection when you want dashboard observations;
add SSH hosts and backup evidence later. An empty dashboard says “Not collected,”
not that the lab is healthy.

## Configure

- `config.json`: optional hosts, endpoints and monitoring policy; absent means empty defaults.
- `.env`: optional private deployment/collection settings; not needed to build.
- `site/`: your Markdown/HTML reports, guides, layout and presentation.

All includes live in `site/_includes/`. Edit the header/footer and section
templates directly; `unify dev` previews them without a generator or collected
data. Generated lists fill their native slots during a build. An authored
`site/index.html` or `site/index.md` can replace the generated dashboard.

To configure monitoring, copy the example once and edit your copy:

```sh
cp site/_examples/config.json config.json
```

Article and guide starters also live in site/_examples/. Copy them into
site/articles/ or site/docs/ before editing; underscore examples are not published.

Defaults keep two weekly reviews, no spot reports, and conservative alert
thresholds. Only add optional settings when you need to change them. Examples
and defaults are in [Configuration](docs/configuration.md).

## Update the template

From your site's directory:

```sh
unify update --dry-run
unify update
unify build --clean --audit --strict
```

Unify records template.source in unify.yaml and preserves its template.keep
list. Build flags, theme, header and footer are protected by default. Your actual
config.json and authored reports are not shipped, so stay untouched. Add exact
paths to keep other shared-file customizations. Unprotected changes require
confirmation; accepting replaces them. See [Template updates](docs/template-updates.md).

## Optional: dashboard observations

Add endpoints to `config.json`, then collect explicitly and rebuild:

```sh
bun scripts/collect.mjs
unify build --clean --audit --strict
```

Collection works without Git. It is separate from building and is never enabled
implicitly. Add SSH hosts and backup evidence only when wanted; see
[Configuration](docs/configuration.md).

## Optional: Git-backed automatic publishing

If you want automatic updates across hosts, put your initialized site in YOUR
repository and push it. Follow [DEPLOY.md](DEPLOY.md#optional-git-backed-docker-publisher)
to run the Docker publisher with that repository's `REPO_URL`. It checks Git
every minute, atomically publishes successful audited builds and keeps the last
good site on failure. This workflow needs Git and Docker Compose, but no host
Bun or Python. It is not required to use the template.

Reports lists reviews and incidents. Guides and Articles contain longer-lived
material. All pages provides search. The brand opens the dashboard; the homepage
has no search. On phones navigation is a bottom bar.

[DEPLOY.md](DEPLOY.md#manage) covers logs, image updates, rollback and backup.
[Template updates](docs/template-updates.md) explains native updates and overwrite review.
Use update for an existing site; init still refuses existing files.

## Author and manage content

Every page needs a title and description; incidents and weekly reviews also
need their actual ISO observation date. Write new articles in `site/articles/`,
incidents in `site/incidents/`, reviews in `site/health/`. Optional tags, series
and part metadata drive navigation. Do not publish secrets, raw logs or databases.

Preview health retention with `bun scripts/retain-health.mjs`; this needs no Git.
Applying automatic deletion is an optional Git-backed safety feature:
`bun scripts/retain-health.mjs --apply --commit` checkpoints managed snapshots
before deletion. Without Git, archive old reviews yourself. Builds and publication
never delete or automatically commit authored content.

## Maintainers

[Maintainer checks](docs/maintaining.md) cover tests, packaging and release gates.
The package is `@fwdslsh/unify-lab-reports-template`. A push to main with a new
package.json version publishes through GitHub Actions using npm trusted publishing;
pull requests and manual runs only verify.
MIT licensed, including the theme; dependencies keep their licenses.
