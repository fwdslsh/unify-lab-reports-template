# Maintainer checks

These are development/release checks, not Docker-server prerequisites.

```sh
bun install --frozen-lockfile --ignore-scripts
bun run test
bun run check
bun run build
bash -n scripts/deploy.sh deploy/poll.sh scripts/probes/*.sh
REPO_URL=https://git.example.net/team/site.git docker compose config --quiet
npm pack --ignore-scripts
```

Unify development dependency and the image's baked version must agree. Review
source changes before rebuilding; the publisher never installs source hooks or
dependencies during startup/publication. Keep builds offline and collection
explicit. Docker verifies output atomically, preserving the last good release.

Before npm publication, inspect the real tarball and exercise native Unify init
from directory, Git and npm sources. Directory sources must be clean; ignored
runtime data is not an init exclusion. Test an initialized site with Docker
despite its skipped root package manifest. A failed re-init must preserve custom
config/content/credentials, not claim update success. Publication needs explicit
authorization; there is no forge-to-forge publishing integration.

The package name is @fwdslsh/unify-lab-reports-template. Its own files/theme are
MIT; dependencies retain their own licenses. See template-updates.md for site
native Unify 0.11.6 updates. Ship configurable starters only under
site/_examples/, not at real config/content paths. Ship template.keep without
source; native init fills template.source and retains keep in an installed site's
unify.yaml. Do not ship a JSON manifest or add ownership logic. Protect the
operator's build flags, theme and branding; shared base CSS remains updateable.
Test dry-run, confirmation/decline, no-op, keep and directory/Git/npm sources. Verify
actual config, content and private state remain byte-identical when shared tools
change, kept files survive, missing kept files are added and unlisted shared-file
edits are overwritten only with confirmation.
Do not add a wrapper or automatic runtime update.
Template packaging/init/update tests live under .github/tests/; tests/ contains
only shared site tests. A private site's test command must not require the
template's npm identity or starter content. Maintainer-only tests are not part
of the npm template payload.

## GitHub mirror and npm release

Gitea remains the development remote. Push reviewed main updates to the GitHub
remote explicitly; no automatic cross-forge service or Gitea token in GitHub is
needed. The public mirror is fwdslsh/unify-lab-reports-template.

The GitHub release.yml workflow verifies main, pull requests and manual runs
without publishing. It tests native directory/Git/npm installation, audits the
build, validates shell/Compose and uploads the actual npm tarball. A pushed v*
tag additionally publishes that exact tested tarball; it must match package.json.
Prereleases use npm's next dist-tag; stable versions use latest. Manual runs only
verify, so testing the workflow does not release a package.

Configure npm trusted publishing for @fwdslsh/unify-lab-reports-template:

- GitHub organization: fwdslsh
- Repository: unify-lab-reports-template
- Workflow filename: release.yml (not the full path)
- Environment: leave blank; allow direct npm publish

See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).
The workflow uses GitHub-hosted runners, npm 12.2.0, job-scoped id-token: write
and provenance. It does not require NPM_TOKEN or any Gitea credential. Configure
the trusted publisher before expecting a tag run to publish successfully. If npm
requires an initial package publication before its settings are available, an
authorized maintainer must bootstrap it once with native npm authentication;
do not add a permanent token fallback or claim OIDC setup has been completed.

For a release, update package.json's version and CHANGELOG.md, run checks, commit
and push main to both remotes. Then tag that reviewed commit and push the tag to
GitHub (and Gitea for history):

```sh
git remote add github https://github.com/fwdslsh/unify-lab-reports-template.git
git push github HEAD:main
git tag v0.1.1
git push github v0.1.1
git push origin v0.1.1
```

Use the actual version and skip remote creation if already configured. Watch
GitHub Actions; a successful verification is not proof of registry publication.
Check npm's version/dist-tag and exercise native init from the published package
after release. Never republish an immutable version or silently overwrite a tag.
