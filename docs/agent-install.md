# Agent installation checklist

Use [DEPLOY.md](../DEPLOY.md) as the command reference. This is the same process,
not a second installer. Complete each verification before reporting success.

## Gather the deployment choices

Ask only for missing information:

- Server/SSH target and authorized deployment account.
- Dedicated project directory and template source (directory, Git URL or published npm package).
- Desired URL and whether it is LAN-only or otherwise access-controlled.
- Existing static host/container and configuration path.
- Lab name and initial endpoints; collection may remain off initially.
- Whether automatic Git-backed publication is wanted; default to native Unify.

Do not require a site repository, Docker builder or .env for normal installation.
No npm publication, host services or unrelated infrastructure changes are implied.

## Install

1. Read AGENTS.md and check the chosen directory and hosting boundary. Do not
   overwrite an existing installation or dirty checkout. Install/check Bun 1.4+
   and Unify 0.11.5+ on the build machine, not necessarily on the hosting server.
2. Run native unify init with the chosen template source in an empty project.
   Directory sources must contain only clean template files; ignored runtime
   data is not excluded automatically. Native init skips root package manifests
   and lockfiles. Use unify directly; do not add an installer wrapper.
   Init records template: in unify.yaml; there is no JSON tracking file.
3. Optionally copy site/_examples/config.json to config.json and edit your copy
   with reviewed non-secret endpoints/monitoring policy. Empty defaults need no file.
   Copy content examples into ordinary authored paths before editing. Set
   branding in site/_includes/header.html and footer links in footer.html; add
   authored content under site/. Preview the layout/includes with unify dev.
   Preserve existing settings/content on later edits.
4. Run unify build --clean --audit --strict. Verify dist/index.html and the
   generated navigation. A successful command alone is not the final check.
5. Serve/upload only dist/ with the existing static host. For a Docker web server,
   use a read-only output mount. Preserve routes, TLS, DNS and LAN restrictions;
   validate before reload/recreation. Never serve the project root.
6. Verify the real URL: dashboard, Reports, Guides, Articles, All pages/search
   and mobile navigation. Confirm config.json, .env and state are not served.
   Noindex is not access control. Keep backups of source/config and previous output.

## Automatic Git publishing (optional)

Only if requested, put the initialized site in the user's own repository and
follow DEPLOY.md's optional Docker publisher steps. It must fetch the user's
site, not the pristine template. Docker hosts need Git/Compose, not host Bun.

Preserve an existing .env; set REPO_URL only for this workflow. For private Git,
use repo-scoped read-only credentials and independently verified host keys.
Never put tokens in URLs/logs or auto-trust ssh-keyscan. Create only dedicated
state/published/ssh directories with the configured UID/GID. Validate Compose,
start the builder, then check publication logs and deployment.json. Verify that
an approved pushed change publishes on a later poll while the last site remains
available. No native host background service is needed.

## Add observations (optional)

Start with endpoints. Run bun scripts/collect.mjs and rebuild, then verify the
observation timestamp and honest responding/down indicators. With the optional
Git publisher, set COLLECT=true and recreate only builder instead. For host facts,
use explicit SSH targets; otherwise “local” is the machine/container executing
collection. Use native account permissions and verified host keys.

Do not grant Docker-group access or blanket sudo just to make indicators green.
Docker access is powerful host control. Unsupported/unavailable checks should
stay unknown. Respect optional hosts and observation windows; do not wake
machines outside their approved schedule. Add backup evidence only for existing
jobs and distinguish successful backups from tested restores.

## Handoff

For later updates follow docs/template-updates.md: dry-run, review additions
and overwrites, confirm, build and deploy. Actual config/content are outside
shipped example paths and remain untouched. Shared layout/tooling edits are
overwritten if accepted; preserve/reapply them deliberately. No reconfiguration
or hash baseline is needed. Never automate template updates in the publisher.

Record the site URL, source directory, static-server output mount and collection
method. Include repo/branch/revision and Compose project only when used. List any checks
that remain unknown. Point to management/rollback commands in DEPLOY.md and
the files that need backup. Never include credential values.

Test setup in an isolated fixture before changing a live lab. Never remove
operator data, runtime state or authored reports as an installation repair.
