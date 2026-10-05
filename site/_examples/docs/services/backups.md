---
title: Backup scope and recovery
description: Monitor existing backup evidence and explicitly declare expected coverage.
---

# Backup scope

Configure backups in the same config.json. The template does not create backup
jobs, grant permissions or install host services.

```json
{
  "backups": {
    "jobs": [
      { "id": "server-copy", "host": "server", "unit": "backup-data",
        "label": "Server data", "maxAgeHours": 36, "scope": "Application data",
        "receiptPath": "/var/lib/backup/last-success",
        "completionMarker": "/var/lib/backup/completed", "offsite": true }
    ],
    "expectations": [
      { "target": "server", "jobs": ["server-copy"],
        "note": "Application data", "needsOffsite": true },
      { "target": "server/database-*", "jobs": ["server-copy"], "note": "Database state" }
    ]
  },
  "exclusions": { "backups": { "server/cache-*": "Reproducible cache" } }
}
```

Each job references a configured host and an existing Linux systemd unit
(without .service). A receipt contains one real ISO success timestamp with a
timezone. If supplied, a missing receipt or completion marker cannot fall back
to an unrelated successful unit run. Without explicit receipt/marker paths,
the observer uses the unit's last completed successful run; it may be unknown
after reboot.

Set offsite only for an established off-host copy. Expectations name stateful
hosts/containers, monitored job IDs and a scope note. Empty jobs creates a
coverage gap; overlapping patterns are rejected. Add/remove expectations or
record an exclusion to adjust scope. Unconfigured resources are not silently
declared backed up.

No targets means “Not assessed.” Missing/stale/failed evidence needs review.
A successful job or configured scope is never proof of a working restore.
Keep credentials and private backup artifacts outside the site.
