# Configuration

Configuration is optional: missing config.json uses safe empty defaults.
To configure observations, copy site/_examples/config.json to config.json,
edit your copy, then rebuild with `unify build`. Only the optional Git
publisher needs changes committed and pushed. No template update should replace
this file. Defaults apply to settings you omit. Credentials belong in private files,
not in config.json or site content.

## Start small

```json
{
  "hosts": [],
  "endpoints": [
    { "id": "files", "label": "Files", "url": "https://files.example.net/health" }
  ]
}
```

Collect explicitly with `bun scripts/collect.mjs`, then rebuild. For the optional
Docker publisher, enable COLLECT in deployment settings instead. Hosts/endpoints
may be empty; without observations the dashboard says “Not collected.”

## Add hosts or backups

- [Host collection](../site/_examples/docs/runbooks/collection.md): SSH targets, optional
  machines and observation windows.
- [Backup monitoring](../site/_examples/docs/services/backups.md): existing job evidence,
  coverage expectations and exclusions. This does not install backup jobs.

Those examples extend config.json; merge the relevant keys, do not replace your
whole configuration. Native remote probes need no Python or Node.

## Presentation is ordinary HTML

| Edit | Source file |
| --- | --- |
| Brand, home link and badge | site/_includes/header.html |
| Navigation | site/_includes/nav.html |
| Footer and optional shared-files link | site/_includes/footer.html |
| Default site title/description, page shell | site/_layout.html |
| Section titles/descriptions | site/_includes/*-head.html |
| Section headings, introductions and empty states | site/_includes/*.fragment.html |

Keep a title and `<meta name="description" content="…">` in each section head.
The generator reads those eight heads to label its own navigation entries; it
does not crawl source files or compose HTML. Unify handles includes, head merging
and slot fills. Section bodies use a bare slot with a useful preview fallback;
the generator fills it with actual lists or observations only during builds.
There are no generated includes needed by the layout.

Run `unify dev` and start at `/_unify/preview/`, or open `/_unify/preview/_layout.html` or
`/_unify/preview/_includes/nav.html` to preview authored source.
Open `/_unify/preview/_includes/dashboard.fragment.html` for the empty
dashboard template. To preview the layout with an authored page, open
`/_unify/preview/_layout.html?page=_examples/articles/article.md`. No build is required first. Use ?chrome=off to hide Unify's preview controls.

The layout's named `brand` and `footer` slots have authored defaults. An HTML
page can supply `<div slot="brand">…</div>` or `<p slot="footer">…</p>` in its
body; ordinary body content fills the main slot. Markdown uses the same layout
defaults. Avoid moving presentation back into JSON or a second template syntax.

## Monitoring policy

reports supports prefix (lab), timezone (UTC) and weeklyKeep (2). Retention only
manages matching timestamped prefix-spot/prefix-review files. Omitted thresholds
use RAM warning 90%, disk warning 85%, critical 95%, sustained load per core 1.5
and stale observation age 90 minutes. Custom threshold keys are
memoryWarningPercent, diskWarningPercent, criticalPercent, loadPerCore and
staleAfterMinutes. Backups/exclusions default empty, not “protected.”

URL composition/build options belong in standard unify.yaml. For a site hosted
below a URL path, configure Unify's base-url/pretty-urls there; do not change
the header's brand mark expecting it to rewrite URLs.

## Optional Git publisher settings (private .env)

These settings are not needed for native Unify builds or static hosting.
REPO_URL is required only by the optional Git publisher. Compose reads .env
beside root compose.yaml.

| Optional key | Default / purpose |
| --- | --- |
| BRANCH | main |
| COLLECT | false; enable observations |
| POLL_SECONDS | 60; allowed 10–120 |
| COLLECT_SECONDS | 1800; allowed 60–86400 |
| PUBLISH_UID / PUBLISH_GID | 1000 / 1000; match dedicated directory owner |
| STATE_PATH / PUBLISH_PATH / SSH_PATH | ./state / ./published / ./ssh |
| SSH_KEY_FILE | /run/ssh/collect_key, when explicitly set |
| SSH_KNOWN_HOSTS_FILE | /run/ssh/known_hosts, when explicitly set |
| BUILD_CONTEXT | .; useful when Compose is stored outside the site clone |
| SITE_ENV_FILE | .env; optional service environment file |

Host paths are resolved relative to compose.yaml; use absolute paths for an
existing deployment. Never include credentials in REPO_URL. For SSH Git the
default files are ssh/git_key and ssh/known_hosts.

CONFIG_FILE, SNAPSHOT_FILE and PREVIOUS_FILE are advanced input-file overrides
for external collectors/custom integrations, not alternate settings registries.
Normally the publisher chooses them; do not set them to configure branding.
