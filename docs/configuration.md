# Configuration

Edit **config.json**, then rebuild with `unify build`. Only the optional Git
publisher needs changes committed and pushed. No template update should replace
this file. Defaults apply to settings you omit. Credentials belong in private files,
not in config.json or site content.

## Start small

```json
{
  "site": { "brand": "My lab", "title": "Lab reports" },
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

- [Host collection](../site/docs/runbooks/collection.md): SSH targets, optional
  machines and observation windows.
- [Backup monitoring](../site/docs/services/backups.md): existing job evidence,
  coverage expectations and exclusions. This does not install backup jobs.

Those examples extend config.json; merge the relevant keys, do not replace your
whole configuration. Native remote probes need no Python or Node.

## Optional site settings

site supports brand, title, description, footer, prefix (brand mark, not URL
base path), badge, filesUrl and filesLabel. The defaults are “My lab”, “Lab
reports”, “Lab reports and dashboard”, “Private lab reports”, “/”, “Lab”, empty
filesUrl, and “Shared files”. Empty filesUrl hides the shared-files link.

Existing sites may optionally preserve custom homeLabel and section copy with
articlesDescription, incidentsDescription, healthDescription, healthIntro,
reportsDescription, reportsIntro, directoryDescription and sitemapDescription.
Leave these out unless you intentionally customize that text.

reports supports prefix (lab), timezone (UTC) and weeklyKeep (2). Retention only
manages matching timestamped prefix-spot/prefix-review files. Omitted thresholds
use RAM warning 90%, disk warning 85%, critical 95%, sustained load per core 1.5
and stale observation age 90 minutes. Custom threshold keys are
memoryWarningPercent, diskWarningPercent, criticalPercent, loadPerCore and
staleAfterMinutes. Backups/exclusions default empty, not “protected.”

URL composition/build options belong in standard unify.yaml. For a site hosted
below a URL path, configure Unify's base-url/pretty-urls there; do not change
site.prefix expecting it to rewrite URLs.

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
