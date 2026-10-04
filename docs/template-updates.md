# Template updates without reconfiguration

Settings and content are site-owned. A template update must never reset them.
The template is a normal Unify project; there is no template-specific installer
or updater hidden here.

## Ownership

| Keep local | Update from template after review |
| --- | --- |
| config.json, .env and SSH credentials | scripts/ and tests/ |
| authored reports, guides and assets | deploy/ and default compose.yaml |
| observation state and published output | shared includes/layout/navigation |
| site-specific package identity/build flags | setup/reference documentation |
| intentional CSS/layout/Compose customizations | unmodified base theme/tooling |

The homepage and sample article are starter content, not mandatory replacements.
Sites may supply their own dashboard and observed-inventory pages. Preserve
them. Docker Compose overrides and site/assets/custom.css are ordinary options
for local deployment/theme additions; no additional override file is required.

## Current Unify boundary

Unify 0.11 supports installing directory/Git/npm templates into an empty site.
It refuses existing files and has no update command. Running init again does
not update this template, and deleting settings to make it succeed is wrong.

Native updates are requested in [Unify issue #109](https://github.com/fwdslsh/unify/issues/109).

Until native updates exist, use normal Git review to apply selected template
changes. Compare the template revision already adopted with the new revision,
preserve site-owned files, run tests/build, commit and push the site's changes,
then rebuild the builder image when tooling changes. No reconfiguration is needed.

Do not use a blanket copy, rsync --delete, forced checkout or undocumented init
flag. Modified shared files require an explicit merge, not silent replacement.

## Required native update behavior

The desired upstream operation is one command remembering the template source
and adopted revision. It should preserve site-owned seed files, update unchanged
template files, preview conflicts for locally customized shared files, refuse
unsafe paths and leave a recoverable change set. Repeating the same update
should be a no-op. It must never touch ignored .env/SSH/state/output.

No speculative manifest/schema is shipped here. Adopt Unify's actual update
contract when released and test config/content/secret preservation before
advertising a native update command.
