# Optional Docker publication

Local builds need only Bun and config.json. Docker publication is optional.
The builder opens no ports; use your existing static server for published/current.
All scheduling runs in the builder container, never in a host service.

## Configure

Commit config.json and site content to YOUR Git repo. The builder reads that
file from the fetched revision for both collection and generation. Changes made
from another clone therefore do not need a local checkout update or image rebuild.

Use environment variables directly, or copy .env.example to ignored .env for
deployment settings. These control Git, polling, collection and Docker paths,
not the site's branding or lab policy.

```sh
mkdir -p state published ssh
REPO_URL=https://git.example.net/team/my-lab-reports.git \
  docker compose -f deploy/compose.yaml up -d --build
```

For the optional .env file, use:
```sh
docker compose --env-file .env -f deploy/compose.yaml up -d --build
```

The default builder UID/GID is 1000. Set PUBLISH_UID/PUBLISH_GID to the owner
of the dedicated state/output directories if different. Existing ownership is
not changed for you. Static output must be readable by your server.

## Private Git and observation

For SSH Git, place a dedicated read-only repo key at ssh/git_key and verified
host keys in ssh/known_hosts. Do not copy an entire home or SSH directory.
Use an ordinary SSH Git URL, not a URL containing a token. HTTPS/public Git
does not require SSH key files.

Collection defaults off. Set COLLECT=true to enable the same container's
existing loop; COLLECT_SECONDS defaults to 1800. A sample outside an observation
window is not probed. LOCAL hosts mean the builder container, not the Docker
host: use a configured SSH target to observe the host.

For collection, place a least-privilege native SSH key at ssh/collect_key and
set SSH_KEY_FILE=/run/ssh/collect_key and
SSH_KNOWN_HOSTS_FILE=/run/ssh/known_hosts. Native account permissions are
operator-owned; the template grants nothing and installs nothing on hosts.

Polling defaults to once a minute (POLL_SECONDS=60, allowed 10–120). Optional
collection defaults to 30 minutes (allowed 60–86400). Configured source, config
or observation changes trigger a build; unchanged input does not rebuild.

## Verify and recover

```sh
bun run test
bun run check
bun run build
docker compose --env-file .env -f deploy/compose.yaml config --quiet
docker compose --env-file .env -f deploy/compose.yaml logs --tail 40 builder
```

Tests use fixtures and localhost, not private hosts. They cover real Unify
builds, npm extraction, navigation/search, observations, backups, retention
and atomic publication failures.

Publication swaps current only after a strict audited build succeeds. Source
fetch/build failures keep the previous release; collection failures keep the
previous observation. Current and previous generated releases are retained.
deployment.json identifies the served Git revision. Builder health indicates
successful checks, not endpoint or backup readiness.

Revert/push source to roll back. Stop only the builder to pause publication;
the static server keeps serving the last good site. Preserve Git, private .env,
SSH keys and collector state. Never edit generated release directories.

## Distribution gate

No automatic publishing workflow or npm install hooks. Before publishing the
MIT package, review npm pack contents and test the actual supported Unify custom
init version against directory, Git and npm sources. Package publication needs
a separate explicit request.
