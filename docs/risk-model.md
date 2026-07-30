# Capability Risk Model

Extension Watchdog classifies potential access, not developer intent,
reputation, or malware likelihood.

## Tiers

### Limited

Narrow capabilities that generally require deliberate user interaction or only
affect the extension's own state.

Examples: `activeTab`, `storage`, and notifications.

### Moderate

Capabilities that reveal browser metadata or affect a meaningful but bounded
part of browser behavior.

Examples: downloads, tab metadata, request observation, and privacy settings.

### High

Capabilities that can expose sensitive browser data or affect many browsing
sessions.

Examples: cookies, browsing history, clipboard reads, and all-site host access.

### Critical

Capabilities or combinations that cross major trust boundaries or provide
control over traffic, other extensions, debugging, or desktop applications.

Examples: native messaging, proxy control, debugging, and all-site access
combined with cookies or request modification.

## Host access

Host permissions are parsed as WebExtension match patterns rather than matched
as strings, because the shape of a pattern does not reliably indicate its
reach. A wildcard host is every host even when the scheme is specific, so
`https://*/*` counts as all-site access exactly like `<all_urls>` and
`*://*/*`. A wildcard subdomain such as `*://*.example.com/*` is broad but not
all-site. A single host stays narrow even when its scheme is wildcarded, so
`*://example.com/*` is not escalated.

## Unrecognized capabilities

Absence from `extension/rules/permissions.json` means a capability has not been
reviewed, not that it is harmless. An unrecognized API permission produces an
explicit `Unknown Firefox capability: manual review required` finding at the
moderate tier, and a host pattern that cannot be parsed produces the equivalent
host finding. An extension whose capabilities are all unrecognized therefore
cannot present as limited.

## Snapshot freshness

Firefox does not raise a management event when a user grants or revokes an
optional permission, so a stored snapshot can drift out of date. Snapshots are
trusted for five minutes; after that the next popup or dashboard request
rescans before answering. There is no background polling loop, and the manual
scan button always forces a fresh scan.

## Interpretation

The displayed tier is the highest tier among recognized findings. Tiers are
intentionally categorical rather than numerical:

- They are easier to explain.
- They avoid false precision.
- A user can inspect the exact findings that produced the tier.
- A single consequential capability is not hidden by several harmless ones.

## Combination rules

Permissions can become more consequential together. Combination rules require
every listed capability before producing a finding. They live in
`extension/rules/combinations.json`.

## Non-goals

The model does not:

- Declare an extension safe or malicious
- Analyze source code
- Establish publisher identity
- Use install count, ratings, or reviews as security evidence
- Predict exploitation
