# Changelog

## 0.1.2

- Use an explicit local tarball path in the npm release workflow; test the real publish command with a dry run.

## 0.1.1

- Native npm installation as the primary setup path, with Git and directory sources still supported.
- Remove the redundant Lab badge beside the /home link.

- Authored chrome and native slotted section templates in site/_includes/; previews no longer need generated includes.
- Presentation lives in HTML, separate from collection/monitoring config.json. Existing authored dashboards remain supported.
- Separate template-maintainer tests from reusable site tests.
- Public GitHub mirror and GitHub-only, tag-gated npm trusted-publishing workflow.
- Native Unify-first setup; Git-backed Docker publishing is optional.
- Root compose.yaml and minimal config/deployment examples.
- Agent installation runbook and one management/configuration reference.
- Unify 0.11.6 native template.source/template.keep protects configuration, palette and branding; no custom updater or JSON tracking manifest.
- Starter settings/content under site/_examples/; fresh installs build with empty defaults.
- Generated guides index when no authored index exists; examples remain unpublished.
- Shared base CSS and protected theme use native cascade layers without changing the default appearance.
- Pinned image-baked Unify 0.11.6 and directory/Git/npm update/confirmation/keep tests.

- MIT-only template, including the theme, authorized by the project owner.
- One config.json for lab/report policy; optional deployment-only .env.
- A generated dashboard unless the site supplies an authored homepage.
- Bun/JavaScript tools and tests; native remote probes need no Python, Node or jq.
- Publisher reads configuration from the fetched Git revision for collection and builds.

## 0.1.0-alpha.1

- Initial configurable lab reports template and allowlisted npm preparation.
- Dashboard, reports, guides, search, mobile navigation, observations and backups.
- Non-root atomic container publishing with rollback and default-off collection.
- Tested Unify 0.10.1. npm publication awaits native custom-init verification.
