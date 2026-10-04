---
title: Collection and dashboard settings
description: Configure one file and collect native read-only observations.
---

# Collection

Edit config.json, then run `bun run collect` and `bun run build`.
Building alone never contacts your lab.

```json
{
  "site": { "brand": "My lab", "title": "Lab reports" },
  "reports": { "prefix": "lab", "timezone": "UTC", "weeklyKeep": 2 },
  "hosts": [
    { "id": "server", "role": "Applications", "platform": "linux", "ssh": "observer@server.example.net" },
    { "id": "workstation", "platform": "windows", "ssh": "observer@desktop.example.net", "optional": true,
      "window": { "timezone": "UTC", "start": "03:00", "end": "08:00" } }
  ],
  "endpoints": [
    { "id": "files", "label": "Files", "url": "https://files.example.net/health", "purpose": "File service reachability" }
  ],
  "backups": { "jobs": [], "expectations": [
    { "target": "server", "jobs": [], "note": "Confirm data backup coverage" }
  ] }
}
```

Platforms are linux, macos and windows. Native SSH uses strict host-key checking;
configure verified keys and a read-only account yourself. No software, trust
changes or permission grants are installed. Omitting ssh observes the computer
running the collector—inside Docker, that means the builder container.

Native Linux checks require Bash, GNU coreutils and existing system tools, not
Python, Node or jq on the host. Linux supplies container metadata, resource
usage, bounded journal counts and backup evidence. macOS/Windows provide basic
host facts; unsupported checks stay unknown. No raw journal text, Docker
environment, host secret files or HTTP bodies are copied.

thresholds supports memoryWarningPercent (90), diskWarningPercent (85),
criticalPercent (95), loadPerCore (1.5) and staleAfterMinutes (90). Load is not CPU
utilization. Running without a Docker healthcheck is neutral, not healthy.

exclusions.containers maps host/container patterns to reasons;
exclusions.endpoints uses endpoint IDs; exclusions.backups uses host or
host/container targets. Excluded indicators stay visible and neutral.

Observation windows use timezone/start/end. Overnight windows work.
Optional/unprobed resources do not become false outages. Observations are dated
snapshots, not continuous monitoring or authenticated readiness checks.

See [backup scope](../services/backups.html) and [observed inventory](../inventory/observed.html).
