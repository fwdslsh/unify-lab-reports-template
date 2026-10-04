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
ownership and the upstream update feature still required.
