# Template updates

Use Unify 0.11.6+ from your site's directory:

```sh
unify update --dry-run
unify update
unify build --clean --audit --strict
```

Init records the source in **unify.yaml**, for example:

```yaml
template:
  source: https://github.com/fwdslsh/unify-lab-reports-template.git
  keep:
    - unify.yaml
    - site/assets/theme.css
    - site/_includes/header.html
    - site/_includes/footer.html
```

There is no JSON tracking file, baseline adoption or automatic merge.

## What changes

Update compares the current template's shipped files with your site and lists
what it would add, keep or overwrite. Differing unprotected files require confirmation.
Declining (or closed stdin) writes nothing. Use --yes only after reviewing the
dry-run. Identical files are a no-op; files no longer shipped are not deleted.
Symlinks and escaping paths are skipped, not followed.

The template ships settings/content seeds under **site/_examples/**.
Copy them to config.json and ordinary authored paths before customizing.
Updates can refresh examples without touching those copies, your reports,
.env, credentials, collected state or output. Examples are never published.

## Keep your customizations

Native init retains the template's default keep list and adds its source.
Your build flags, theme, header and footer are protected by default. Updates
report `keep` for changed protected files without overwriting them. A missing
protected file is still added, so fresh sites receive complete defaults.

Put colors and fonts in **site/assets/theme.css**. The shared styles.css uses
native CSS cascade layers: base defaults first, your theme second. Remove a
theme property to fall back to its base default. Shared layout fixes can update
without replacing your palette. This introduces no generator or build hook.

For another customized shipped file, add its exact project-relative path to
template.keep in unify.yaml. No globs or directory ownership rules. The protected
unify.yaml retains your keep list and build flags across updates. Review upstream
changes to protected files when you want to adopt them; they are not merged.

Unlisted shared files still require confirmation and are replaced if accepted.
An authored homepage can override the generated dashboard and use native
brand/footer slot fills; that homepage is not shipped by the template.

The repeatable `unify update --keep path` option is a one-run override: it
**replaces**, rather than extends, the YAML list. Prefer the persistent YAML list
for routine updates. Do not run `unify init` over an existing site.

## Existing sites

Remove an obsolete unify.template.json only after confirming it holds no
operator data. Set template.source to the chosen directory, Git URL or npm source
and list existing shared-file customizations in template.keep in unify.yaml.
Native updates need no previous revision/hash baseline. The authoring template
ships keep without source; init supplies the source selected by its caller.
Keep actual configuration/content out of shipped example paths. Never
guess which files are safe to delete; inspect leftovers separately.

## Deployment

Verify the resulting site, then deploy dist/ with your existing static host.
For the optional Git publisher, commit/push reviewed changes, pull the site
on the server and rebuild only builder when tooling or its baked Unify changes.
Never run automatic template updates in the publisher; it builds reviewed site
revisions, not unreviewed upstream changes.

[Native contract](https://github.com/fwdslsh/unify/blob/v0.11.6/docs/templates.md).
