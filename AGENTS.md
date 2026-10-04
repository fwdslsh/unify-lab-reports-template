# Lab reports template

Keep this a normal Unify project. `site/` is authored source; generators write
only Unify's overlay. Do not add a template language, source crawler, database,
background host service or custom init wrapper.

Use `.env`/`site.config.json` for scalar public settings and `lab.json` for host,
endpoint and backup lists/policy. Collection is explicit, bounded and default-off.
Native SSH trust/permissions are operator-owned. Builds never run collection.
Never publish secrets, raw journal messages, container environment or unrelated
private files. No Docker socket, root container or automatic host trust changes.

Preserve the dashboard's alerts, host metrics, container health, backup evidence,
search and thumb-friendly mobile navigation. Missing evidence stays unknown;
running is not healthy, HTTP success is not authenticated readiness, and backup
success is not a restore test.

Verify `bun run test`, `bun run check`, `bun run build`, changed shell syntax,
Compose configuration and the npm payload. New distributions need a clean-history
privacy review. Never modify an existing lab's production content to update this
template. No npm publication without explicit authorization and release gates.
