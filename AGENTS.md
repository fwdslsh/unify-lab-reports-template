# Lab reports template

Use native Unify 0.11.6+ init, dev, build and update. A site repository,
Docker and automatic publishing are optional. Follow docs/agent-install.md,
DEPLOY.md and docs/template-updates.md; do not add an installer/updater wrapper.

Keep this a normal Unify project. Authored layouts, includes and slotted
section templates live in site/_includes/ and preview without generated files.
Generators write only Unify's overlay. An authored site/index.html or
site/index.md overrides the generated dashboard.

Ship starter configuration and content only under site/_examples/. Operators
copy examples to config.json or their authored site paths. With no config.json,
safe empty defaults apply; an explicitly selected missing config is an error.
Configuration is collection/monitoring policy, not presentation.

Native init records template.source and retains template.keep in unify.yaml.
No JSON ownership/hash manifest. Existing kept files are never overwritten;
missing kept files are added. Default protected paths are unify.yaml, theme.css,
header and footer. Add exact paths for other shared-file customizations.
Unlisted shared changes require confirmation. Actual config/content outside
shipped paths are untouched. Never silently accept overwrites or rerun init over
operator data. See docs/template-updates.md for the exact contract.

Bun runs the JavaScript tools/tests. Collection is explicit, bounded, read-only
and default-off. Builds never collect. Native SSH trust is operator-owned.
No database, Python, host background service, duplicated configuration registry,
custom template language, source crawler, root container or Docker socket.
Never publish credentials, HTTP bodies, raw journals or container environments.

Preserve dashboard alerts, host metrics, container health, backup evidence,
search and mobile bottom navigation. Missing evidence stays unknown.
Running is not healthy; HTTP success is not authenticated readiness;
backup success is not a restore test.

Verify tests, strict builds/audit, shell syntax, Compose and the actual npm
payload. No npm publication without explicit authorization and release gates.
