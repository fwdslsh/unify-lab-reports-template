# Template updates without reconfiguration

Settings and content are site-owned. A template update must never reset them.
The template is a normal Unify project; there is no template-specific installer
or updater hidden here.

## Update an installed site

Use Unify 0.11.2 or later from the site's directory:

```sh
unify update --dry-run
unify update
unify build --clean --audit --strict
```

The first command previews without writing anything. Review changes, especially
removals, before applying. The second uses the recorded directory, Git or npm
source. Existing site-owned files stay untouched, unchanged shared files update,
and repeating the same update is a no-op. It never runs template hooks or builds.
Deploy the verified output as usual. No site Git repository is required.

Keep the generated unify.template.json in your backups or version control: it
records the source/revision and file hashes. Do not edit it or copy the template
author's owned-only manifest over it. It is not a second lab configuration file.

## Ownership

| Keep local | Update from template after review |
| --- | --- |
| config.json, unify.yaml, compose.yaml, project README/changelog | scripts/ and site tests/ |
| authored articles, incidents, reviews and guides | deploy/ and setup documentation |
| observation state and published output | shared includes/layout/navigation |
| site-specific package identity/build flags | setup/reference documentation |
| intentional CSS/layout/Compose customizations | unmodified base theme/tooling |

The template's native owned manifest protects config/build/deployment seeds,
the homepage, authored content directories and custom.css. Existing .env, SSH
files, state and output are also declared site-owned and are never distributed.
Your other added files are not template inputs and are left alone. Shared files
you edit, such as CSS/layout or collectors, are protected by conflict detection.
Review new default configuration/Compose suggestions manually; ownership means
an update does not replace your settings, even when the seed was unmodified.

The homepage and sample article are starter content. Existing files remain yours;
missing owned seeds can be added by an update. Review the dry run if you removed
a starter page or have your own dashboard. Docker Compose overrides and
site/assets/custom.css are ordinary options for deployment/theme additions; no
additional override file is required.

## Conflicts and failures

If both you and the template changed a shared file, Unify keeps your bytes,
reports the conflict and exits 1. Other non-conflicting changes may still apply;
an update is not an all-or-nothing merge. Resolve each conflict deliberately and
re-run. There is no force flag. Taking the incoming bytes clears that conflict;
keeping different local bytes can leave it reported on future runs.

Failed fetches leave the project unchanged. Symlinks/path escapes are rejected,
not followed. Never erase config, content or private data to make an update work.

## Existing sites created before 0.11.2

Adopt the exact template revision/version the site previously used. This writes
only the native record, not source/configuration/content:

```sh
unify update --adopt 'https://github.com/fwdslsh/unify-lab-reports-template.git#PREVIOUS_COMMIT'
unify update https://github.com/fwdslsh/unify-lab-reports-template.git --dry-run
unify update https://github.com/fwdslsh/unify-lab-reports-template.git
```

Replace PREVIOUS_COMMIT with the actual adopted commit, not today's version.
If unknown, inspect your site history or backup before adopting; do not invent
a baseline. The explicit update source moves off that pinned old revision; later
unify update calls remember the new source. Named #refs or npm @versions can
select an exact update target. Re-init is not an update and still refuses collisions.

## Optional Git-backed Docker publisher

Update and test on the build machine, commit/push the site including its native
record, then pull the reviewed revision on the Docker host and rebuild builder
when baked tooling changes: docker compose up -d --build builder. The server
does not need host Unify/Bun. It publishes your reviewed site, not template
changes directly. Config, private .env/SSH and dedicated state stay in place.
No automatic template-update job, new service or reconfiguration is needed.

See [Unify's native update reference](https://github.com/fwdslsh/unify/blob/v0.11.2/docs/cli-reference.md#unify-update-template).
