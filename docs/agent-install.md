# Agent installation checklist

Use [DEPLOY.md](../DEPLOY.md) as the command reference. This is the same process,
not a second installer. Complete each verification before reporting success.

## Gather the deployment choices

Ask only for missing information:

- Server/SSH target and authorized deployment account.
- Dedicated project directory and the site's writable Git repository.
- Desired URL and whether it is LAN-only or otherwise access-controlled.
- Existing static-server container, Compose project and configuration path.
- Lab name and initial endpoints; collection may remain off initially.

If starting from a template, create the user's own site repository first. The
builder must fetch that repository, not the pristine upstream template. No npm
publication, host services or unrelated infrastructure changes are implied.

## Install

1. Read repository AGENTS.md and check the server: Docker/Compose versions,
   account UID/GID, existing containers, chosen directory and Git access. Do
   not overwrite an existing installation or dirty checkout.
2. Clone the user's site repository. For native Unify initialization use an
   empty project and a supported directory/Git/npm source; never run init over
   existing files. Native init does not copy root package manifests/lockfiles.
   Docker deployment does not need them or host Bun.
3. Edit config.json with reviewed non-secret lab identity/endpoints. Commit
   exact paths and push. Preserve all existing content and settings.
4. Copy the non-secret .env.example to ignored .env only if absent, then set
   REPO_URL. Preserve an existing .env. For private Git arrange a repo-scoped
   read-only deploy key and independently verified host keys. Do not paste
   tokens into URLs, logs, reports or prompts. Do not auto-trust ssh-keyscan.
5. Create only the dedicated state, published and ssh directories. Match the
   builder UID/GID to their owner; do not recursively chown unrelated paths.
   Verify key permissions and the web-server read boundary.
6. Run docker compose config --quiet, then docker compose up -d --build.
   Check logs for the first successful publication and verify generated
   index.html/deployment.json. A running container alone is not success.
7. Add the read-only parent published mount and site route to the existing
   static server. Preserve unrelated routes, TLS, DNS and LAN restrictions.
   Validate first. Recreate only that service for mount changes, otherwise
   reload configuration. Stop if the required change exceeds approved scope.
8. Verify the real URL and deployment revision. Manually check dashboard,
   Reports, Guides, Articles, All pages/search and mobile navigation. Confirm
   config.json, .env and state are not served. Noindex is not access control.
9. Push a small approved report/config change. Verify that a later successful
   poll serves its new revision while Caddy remains available.

## Add observations (optional)

Start with endpoints. Set COLLECT=true, recreate only builder, and verify a new
observation timestamp and honest responding/down indicators. For host facts,
add explicit SSH targets, including the Docker host; otherwise “local” means
the builder container. Use native account permissions and verified host keys.

Do not grant Docker-group access or blanket sudo just to make indicators green.
Docker access is powerful host control. Unsupported/unavailable checks should
stay unknown. Respect optional hosts and observation windows; do not wake
machines outside their approved schedule. Add backup evidence only for existing
jobs and distinguish successful backups from tested restores.

## Handoff

Record the site URL, repo/branch/revision, project directory, Compose project,
static-server output mount and whether collection is enabled. List any checks
that remain unknown. Point to management/rollback commands in DEPLOY.md and
the files that need backup. Never include credential values.

Test setup in an isolated fixture before changing a live lab. Never remove
operator data, runtime state or authored reports as an installation repair.
