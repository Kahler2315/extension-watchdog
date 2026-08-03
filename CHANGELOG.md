# Changelog

## 0.1.3 - 2026-08-03

- Replace the generic toolbar icon with the Watchdog shield artwork at the
  Firefox toolbar sizes, and use that same mark in the popup, dashboard, and
  change notifications.
- Refresh the local-first interface around the logo's navy, blue, steel, and
  amber palette.
- Add a plain-language "Why this access matters" explanation to every
  permission and website-access finding, so a capability is accompanied by
  the practical reason a user may not want to grant it.
- Make extension access changes directly reviewable in Recent activity:
  newly added permissions and website access show `+`, removed access shows
  `−`, and version changes retain the before-and-after version.

Requested permissions remain `management`, `storage`, and `notifications`.
There are still no host permissions or content scripts, and all analysis,
snapshots, and diffs remain local.

## 0.1.2 - 2026-07-30

- Parse host permissions as WebExtension match patterns instead of matching
  string shapes. A wildcard host is every host even when the scheme is
  specific, so `https://*/*` is now rated as access to every website rather
  than receiving the default limited level.
- Stop overstating a single host. `*://example.com/*` is one site and is no
  longer escalated to broad access.
- Read the dashboard's full-website-access tile from the finding the
  background classifier recorded. It previously held its own copy of the host
  test and carried the same defect.
- Produce an explicit review-required finding for API permissions and host
  patterns that are not recognized. An unrecognized capability previously
  produced no finding at all and left an extension looking limited.
- Expand `extension/rules/permissions.json` to cover all 53 permission names
  Firefox documents for `manifest.json`, so the unknown-capability fallback
  only applies to genuinely unreviewed permissions. A test asserts that list by
  name, so an omission fails the build instead of quietly degrading to the
  generic description.
- Include unknown capabilities in the dashboard review queue. The finding said
  manual review was required but carried a moderate level, and the queue only
  counted high and critical ratings, so an extension whose capabilities were
  all unrecognized reported zero items needing review. The queue now consumes
  an explicit review flag from the classifier instead of inferring one from the
  level.
- Refresh a stored snapshot older than five minutes when the popup or
  dashboard requests state. Firefox raises no management event when a user
  grants or revokes an optional permission, so a snapshot could otherwise stay
  stale until a manual scan or a restart. No background polling was added and
  scan operations remain serialized.
- Install release dependencies from a committed lockfile with `npm ci`, and
  pin every workflow action to a full commit SHA.
- Move the analysis layer to `extension/background/classifier.js` and add 14
  Node regressions covering wildcard schemes, wildcard hosts, wildcard
  subdomains, exact domains, paths, negative controls, known and unknown
  permissions, and the freshness window.
- Forbid every management mutation API in the source safety tests rather than
  only `uninstall`, and check network call sites against an allowlist of
  argument shapes instead of a literal URL pattern.

Requested permissions are unchanged at `management`, `storage`, and
`notifications`. There are still no host permissions and no content scripts,
and all analysis remains local.

## 0.1.1 - 2026-07-30

- Harden repository ignore rules for local credential and data artifacts.
- Resolve Firefox compatibility warnings and correct the source artifact
  uploaded with a listed release.

## 0.1.0 - 2026-07-27

- Initial release. Inventories installed extensions, explains their
  permissions against a local rules set, records a snapshot, and reports
  meaningful changes without sending browser data anywhere.
