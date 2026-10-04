# Publish and manage

## Native static hosting

Initialize with `unify init` as shown in [README.md](README.md#install-with-unify).
Edit config.json and site/, then run:

```sh
unify build --clean --audit --strict
```

Serve or upload only dist/ using your existing static host. For Caddy, mount
that output directory read-only and point its root there. Do not serve the
project root: it contains configuration and may contain private files. Keep
existing DNS, TLS and access restrictions. Rebuild and replace the hosted output
when content changes; keep a copy of the previous output for rollback.

This path needs no site Git repository, Docker builder, .env or REPO_URL. Back
up your authored site/ and config.json with your normal backup tool. For a local
preview use unify dev, not a production/public development server.

## Optional: Git-backed Docker publisher

For automatic Git updates, use a dedicated clone of YOUR site's repository.
This optional workflow starts one builder
container with no public ports; your existing web server serves its output.
Git and Docker Compose are the only host prerequisites. No host cron/systemd or
Bun installation is needed.

### 1. Prepare

Clone the site to its chosen directory and work from that root. Edit and commit
`config.json` and content, then push. The builder always reads the fetched revision,
not uncommitted settings in the server clone.

Copy `.env.example` to ignored `.env` and set `REPO_URL` to YOUR site repository.
For private Git use a read-only deploy key at `ssh/git_key` and verified host keys
at `ssh/known_hosts`. Never put credentials in the URL or commit private files.
An HTTPS repository without credentials needs no key.

```sh
mkdir -p state published ssh
docker compose config --quiet
```

Create those directories as the deployment account. The builder defaults to
UID/GID 1000. If different, set `PUBLISH_UID`/`PUBLISH_GID` in `.env` to match
`id -u`/`id -g`. Do not recursively change an existing directory's ownership.
Directories must be dedicated to this site and readable by the web server.

### 2. Start

```sh
docker compose up -d --build
docker compose ps
docker compose logs --tail 40 builder
```

The image contains pinned Unify 0.11.0. The builder does not install dependencies
at startup or on each publication. An initial build needs network access during
image construction; content builds need only Git access.

Wait for the first “published” message and `published/current/index.html`.
Unchanged inputs do not rebuild. Failed fetch/builds retry and retain the last
successful release. Container health measures publishing checks, not lab health.

### 3. Serve with existing Caddy

Add this read-only mount to your EXISTING Caddy service, using your actual
absolute project path. Mount the parent output directory, not the `current`
symlink, so atomic publication switches remain visible:

```yaml
volumes:
  - /srv/lab-reports/published:/srv/lab-reports:ro
```

Add a site block in its existing Caddyfile:

```caddyfile
reports.example.net {
    root * /srv/lab-reports/current
    file_server
}
```

Retain your existing DNS, TLS, LAN restrictions/authentication and unrelated
routes. Validate Caddy configuration before applying it. A changed mount needs
recreating only the existing Caddy service; a Caddyfile-only change needs reload.
Do not expose a private dashboard publicly: noindex is not access control.
If no static server exists, choose/install one separately; the builder is not
an HTTP server. See [Caddy static serving](https://caddyserver.com/docs/caddyfile/directives/file_server).

### 4. Verify

```sh
curl -fsS https://reports.example.net/deployment.json
curl -fsS https://reports.example.net/ -o /dev/null
```

Check the revision against the committed source. Open the URL: dashboard,
Reports, Guides, Articles and All pages must work. Try search and mobile navigation.
Push a small reviewed content change and confirm the revision changes after the
next poll. Do not equate container-running with successful publication.

### Optional: observations in the publisher

Add endpoints to `config.json`, commit/push, set `COLLECT=true` in `.env`, then:

```sh
docker compose up -d --force-recreate builder
```

For hosts, use explicit `ssh` targets—even for the Docker host itself. A host
without ssh is observed locally, meaning the builder container. Add a dedicated
`ssh/collect_key`, verified host keys, and these optional `.env` settings:

```dotenv
SSH_KEY_FILE=/run/ssh/collect_key
SSH_KNOWN_HOSTS_FILE=/run/ssh/known_hosts
```

The account's permissions determine available checks; unavailable Docker/journal
checks stay unknown. Docker group membership grants host control, not read-only
access; do not grant it automatically. Observation windows and optional hosts
avoid probing sleeping machines. [Configuration](docs/configuration.md) links
host and backup examples. Collection defaults to every 30 minutes.

## Manage

The commands below apply to the optional Git-backed Docker publisher. Native
sites use edit → unify build → deploy dist/; no commit or push is required.

| Task | Action |
| --- | --- |
| Content or config change | Commit and push; automatic publication |
| Deployment setting change | `docker compose up -d --force-recreate builder` |
| Template/tooling change | Review/apply update, `git pull --ff-only`, then `docker compose up -d --build builder` |
| Recent logs | `docker compose logs --tail 40 builder` |
| Pause publishing | `docker compose stop builder`; last site stays served |
| Resume | `docker compose start builder` |
| Content rollback | Revert the source commit and push |

Back up Git, private .env, dedicated SSH credentials and state snapshots. Output
is rebuildable, but preserve it for quick recovery. Never edit generated releases
or erase state/credentials to fix a failed build.

### Troubleshooting

- No output: check builder logs, Git access and directory ownership.
- Old content: inspect deployment.json; confirm changes were committed/pushed.
- Wrong branding: config.json in the fetched Git revision is authoritative.
- No observations: collection is off by default; inspect its timestamp and SSH.
- Permission-denied or unknown checks: inspect account permissions, not blanket sudo.
- HTTP 404 after publication: confirm Caddy mounts the parent published directory.

[Agent installation checklist](docs/agent-install.md) follows this same workflow.
