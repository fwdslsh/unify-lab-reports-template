# Deploy a lab reports site

## Local development

Install Bun 1.4+, Python 3.10+ and Git. Copy `.env.example` to `.env`, edit the
public identity settings and run `bun install --frozen-lockfile --ignore-scripts`
then `bun run dev`. Restart development after changing root `.env`/JSON settings;
Unify watches authored source, not root configuration. No collection is implicit.
Python helpers called directly read JSON defaults/exported environment; the
documented `bun run` commands load `.env` normally.

Unify builds the normal `site/` source and calls `scripts/gen.mjs` for generated
overlay pages/includes. Unify owns metadata parsing, composition, URLs and
search. There is no custom template engine. `unify.yaml` contains only supported
Unify CLI settings, not lab configuration.

## Continuous Git publication

Create your own site Git repo from the template, commit your authored sources
and point `.env`'s `REPO_URL` at that repo. Public HTTPS repositories need no key.
For private SSH repositories, put a repo-scoped read-only `git_key` and verified
`known_hosts` in a dedicated `ssh/` directory. Collection can use a different
`collect_key`, explicitly selected by `LAB_SSH_KEY_FILE`. These files are ignored
and mounted read-only, never copied into an image or npm artifact.

Set `STATE_PATH`, `PUBLISH_PATH`, `SSH_PATH`, and `LAB_CONFIG_PATH` for dedicated
directories/files. Compose paths are relative to `deploy/compose.yaml`. If you
install Compose elsewhere, make all paths explicit, including `SITE_ENV_FILE`.
Match `PUBLISH_UID/GID` to ownership/read permissions on state and output; Docker
does not repair existing host directory ownership. Create those directories with
the intended ownership before starting. Docker Compose 2.24+ is required.

```sh
docker compose --env-file .env -f deploy/compose.yaml config --quiet
docker compose --env-file .env -f deploy/compose.yaml up -d --build
docker compose --env-file .env -f deploy/compose.yaml logs --tail 40 builder
```

An existing static server must serve `<PUBLISH_PATH>/current` read-only. The
builder opens no port and has no reverse-proxy or TLS dependency. Do not expose
private inventory publicly without reviewing it. The site defaults to noindex;
noindex is not access control. Keep your network/authentication boundary at the
static server or proxy.

The container runs non-root, read-only, with no Linux capabilities, Docker socket
or host-home mount. Tools are image-baked; no startup package installation.
Git fetch/builds have a five-minute deadline. Checks occur every minute unless
`POLL_SECONDS` is explicitly changed (10–120 seconds). Unchanged Git/config/data
input is a no-op. Environment overrides and observation/config file content are
fingerprinted privately; unrelated environment values are not published.

## Optional observations

Configure `lab.json` and set `LAB_COLLECT=true`. Collection runs in the same
container on `LAB_COLLECT_SECONDS` (default 1800; 60–86400). It uses read-only
SSH observations and HTTP reachability samples. `LAB_CONFIG_PATH` is mounted at
`/run/lab/lab.json`; state snapshots and the previous restart baseline live under
`/state`. Do not select local observation to monitor the Docker host: local
means the container itself. No collector installs host services or sudo rules.

Verify SSH host keys independently before enabling collection. Grant only the
native permissions needed for each signal; Docker-group access is root-equivalent.
Unavailable journal/backup/Docker checks remain unknown. Collection has a separate
five-minute deadline and failure retains the previous complete observation.
It does not run during Unify builds or automatically push observations into Git.
Authored reports remain Git-backed; ephemeral observation state is separately
backed up with your deployment configuration.

After `.env` changes, recreate the builder with the normal Compose command.
Changing the mounted lab configuration or a complete snapshot triggers a new
build without a source commit. Changes to image-baked scripts require rebuilding
the builder; ordinary site content needs only a reviewed Git push.

## Verification and recovery

`bun run check`, `bun run build` and `bun run test` use local fixtures, not private
hosts. Tests cover actual Unify builds, mobile navigation, search, observations,
backups, retention, public/private input boundaries and atomic rollback. npm
payload tests extract a real packed artifact and build it in a fresh directory.

`deployment.json` identifies the served Git revision. A successful check drives
container health, not endpoint readiness. A failed fetch/build keeps the previous
release; current and previous generated releases are retained. Source rollback is
a normal reviewed Git revert/push. Stop only the builder to pause publication;
your static server continues serving the last good output.

Preserve source Git, private `.env`, SSH keys, lab configuration and collector
state. Static output is reproducible and is not the source of truth. Do not edit
release directories or erase rollback artifacts as part of source cleanup.

## Release gate

This repo is the directory/Git/npm template payload, not a custom scaffolder.
Before releasing to npm, verify package contents, test the
actual supported Unify custom-init version, and smoke-test directory, Git and
npm sources. There are no npm lifecycle installation scripts or automatic
publishing workflows. Package publication requires a separate explicit request.
