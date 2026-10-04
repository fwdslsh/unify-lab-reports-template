---
title: Backup scope and recovery
description: Configure expected backup coverage and assess available evidence.
---
# Backup scope and recovery

Backups are observed, not created by this template. Configure your existing
backup jobs in `lab.json`:

```json
{
  "id": "server-local",
  "host": "server",
  "unit": "backup-local",
  "label": "Server · local",
  "max_age_hours": 36,
  "scope": "Selected application data",
  "receipt_path": "/var/lib/backups/last-success",
  "completion_marker": "/var/lib/backups/SNAPSHOT_COMPLETE",
  "offsite": false
}
```

`unit` names an existing Linux systemd backup service without `.service`.
`receipt_path` and `completion_marker` are optional absolute paths on that host.
A receipt contains a timezone-qualified ISO timestamp. The marker confirms that
the snapshot completed. Explicit receipt/marker failures never fall back to a
passing systemd timestamp. Without explicit files, a successful completed
systemd run supplies weaker evidence, which the dashboard labels accordingly.

`backup_expectations` describe hosts and stateful containers that should be
protected. Each contains `target`, `jobs` (job IDs), and `note`. Targets can use
globs. An empty job list produces a coverage gap. Overlapping expectations are
rejected rather than double-counted. Set `needs_offsite: true` where local-only
protection is insufficient. Exclude intentionally unmanaged targets with a
reason in `backup_exclusions`.

No configured expectations means **not assessed**, not protected.
A successful backup is not a verified restore. Record restore drills in a report.

Site recovery: preserve Git source, private `.env`, SSH keys, and collector state.
Rebuild static output from source. A normal Git revert rolls back content; a
failed build leaves the previous published release served.
