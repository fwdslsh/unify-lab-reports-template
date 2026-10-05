# Template updates

Use Unify 0.11.5+ from your site's directory:

```sh
unify update --dry-run
unify update
unify build --clean --audit --strict
```

Init records the source in **unify.yaml**, for example:

```yaml
template: https://github.com/fwdslsh/unify-lab-reports-template.git
```

There is no JSON tracking file, baseline adoption or automatic merge.

## What changes

Update compares the current template's shipped files with your site and lists
what it would add or overwrite. Differing files require confirmation.
Declining (or closed stdin) writes nothing. Use --yes only after reviewing the
dry-run. Identical files are a no-op; files no longer shipped are not deleted.
Symlinks and escaping paths are skipped, not followed.

The template ships settings/content seeds under **site/_examples/**.
Copy them to config.json and ordinary authored paths before customizing.
Updates can refresh examples without touching those copies, your reports,
.env, credentials, collected state or output. Examples are never published.

Shared layouts, includes, styles, tooling, deployment files and documentation
are shipped files. **Local edits to those files will be overwritten if you
accept.** Review the list, decline when necessary, preserve your customizations,
then apply/review the new shared files before rebuilding. An authored homepage
can override the generated dashboard and use native brand/footer slot fills;
that homepage is not shipped by the template.

## Existing sites

Remove an obsolete unify.template.json only after confirming it holds no
operator data. Set template: to the chosen directory, Git URL or npm source
in unify.yaml. Native updates need no previous revision/hash baseline.
Keep actual configuration/content out of shipped example paths. Never
guess which files are safe to delete; inspect leftovers separately.

## Deployment

Verify the resulting site, then deploy dist/ with your existing static host.
For the optional Git publisher, commit/push reviewed changes, pull the site
on the server and rebuild only builder when tooling or its baked Unify changes.
Never run automatic template updates in the publisher; it builds reviewed site
revisions, not unreviewed upstream changes.

[Native contract](https://github.com/fwdslsh/unify/blob/v0.11.5/docs/templates.md).
