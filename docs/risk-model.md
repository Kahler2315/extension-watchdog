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
