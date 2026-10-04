---
title: Collection and dashboard settings
description: Configure the lab without changing the site's renderer or layout.
---
# Collection and dashboard settings

Edit `lab.json` to describe the hosts and endpoints you want to observe.
The default lists are empty; no network requests occur during a site build.

```json
{
  "hosts": [
    {"id": "server", "role": "Storage server", "platform": "linux", "ssh": "observer@server.example.net"}
  ],
  "endpoints": [
    {"id": "files", "label": "Files", "url": "https://files.example.net/health", "purpose": "File service reachability"}
  ],
  "backup_jobs": [],
  "backup_expectations": [{"target": "server", "jobs": [], "note": "Confirm data backup coverage"}]
}
```

Host platforms are `linux`, `macos`, or `windows`. Omit `ssh` only when you want
to observe the machine running the collector. Inside Docker that is the
container, **not the host**; use SSH to observe the real host. Windows requires
OpenSSH and PowerShell; Linux remote checks require Bash and Python 3.

Observe manually with `bun run collect`, then rebuild. The Docker publisher can
collect automatically when `.env` contains `LAB_COLLECT=true`. Collection runs
on its own interval, outside Unify's build. No host service is installed.

SSH uses native authentication and strict host-key checking. Verify host keys
before adding them to `known_hosts`. Grant only the read permissions needed for
your observations. Docker-group access is root-equivalent; use a dedicated
trusted account and do not mount a Docker socket into the publisher.
Journal/backup checks that lack permission remain unknown. No sudoers rules,
trust exceptions, or host packages are installed automatically.

Set `optional: true` for intentionally intermittent machines or endpoints.
An optional `window` controls permitted collection hours:

```json
{"timezone": "UTC", "start": "03:00", "end": "08:00"}
```

Attach it to a host or endpoint. Overnight windows are supported. Outside the
window, the collector makes no connection. Configure thresholds and explicit
`container_exclusions`, `endpoint_exclusions`, and `backup_exclusions` in the
same file. Exclusions map exact IDs or glob patterns to a reason; containers use
`host/container`, endpoints use their configured `id`. Excluded items stay visible.

The collector publishes counts and safe metadata, never journal messages,
container environment, credentials, or application stdout. HTTP success proves
reachability only. Missing Docker healthchecks do not imply healthy containers.
