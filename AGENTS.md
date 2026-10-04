# Lab reports template

Native unify init is the primary installation path. A site repository, Docker
and automatic publishing are optional. Follow docs/agent-install.md and DEPLOY.md.
Only Git-backed Docker publishing needs Git/Compose, not host Bun. For configuration use docs/configuration.md;
for template ownership/update limits use docs/template-updates.md. Never rerun
init over operator data or claim a nonexistent update command works.

Keep this a normal Unify project. site/ is authored source; generators write
only Unify's overlay. site/index.html is explicit, includes/ is flat, and
config.json is the only site/lab configuration file. Do not add a custom
template language, source crawler, database, Python dependency, host background
service, duplicate configuration registry or custom init wrapper.

Bun runs the JavaScript tools and tests. Collection is explicit, bounded,
read-only and default-off. Native SSH trust/permissions are operator-owned.
Builds never collect. Never publish credentials, HTTP bodies, raw journal text,
container environments or unrelated files. No Docker socket/root container.

Keep dashboard alerts, visible host metrics, container health, backup evidence,
search and mobile bottom navigation. Missing evidence stays unknown. Running
is not healthy, HTTP success is not authenticated readiness, and backup success
is not a restore test.

Verify bun run test, bun run check, bun run build, shell syntax, root Compose and
the npm payload. Do not change an existing lab's production site through this
template. No npm publication without explicit authorization and release gates.
