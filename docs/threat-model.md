# Threat Model

## Assets

- The user's extension inventory and change history
- The integrity of capability explanations
- The user's ability to make an informed removal decision
- The Mozilla Add-ons signing credentials used during release

## Trust boundaries

### Firefox management API

Watchdog trusts Firefox to report installed extension metadata accurately. A
missing or changed browser API field can reduce analysis quality but must not
grant Watchdog additional access.

### Packaged rules

Permission and combination rules ship inside the signed extension. They are
reviewable source and are not downloaded at runtime.

### Local extension storage

Snapshots and findings remain in Firefox's extension storage. Other websites
cannot access that storage. Anyone with control of the user's Firefox profile or
operating-system account is outside this protection boundary.

### Release pipeline

Mozilla API credentials exist only as GitHub environment secrets. The publishing
workflow is manual and should require environment approval. A compromised
maintainer account or workflow could publish a harmful update, so repository
branch protection and secret review are important.

## Threats and mitigations

### Misleading security claims

**Threat:** A user treats a low tier as proof that an extension is safe.

**Mitigations:** Use capability language, display the limitations in the
dashboard, and avoid "safe" or "malicious" verdicts.

### Exfiltration of extension inventory

**Threat:** Watchdog sends installed extension metadata to a third party.

**Mitigations:** Request no host permissions, package every rule, test source
for remote endpoints, and declare `required: ["none"]` for data collection.

### Rule manipulation

**Threat:** A contributor weakens or biases risk rules.

**Mitigations:** Keep rules declarative, require evidence in review, test the
schema, and show every contributing finding in the user interface.

### Stored metadata injection

**Threat:** A malicious extension name or description injects markup into the
dashboard.

**Mitigations:** Construct the interface with DOM nodes and `textContent`; do
not use `innerHTML` with extension-provided metadata.

### Credential exposure

**Threat:** AMO credentials are committed or printed.

**Mitigations:** Use GitHub secrets, keep publishing manual, exclude local
configuration and upload state, and rotate credentials after suspected exposure.

## Accepted limitations

- A malicious extension may behave harmfully using permissions Watchdog rates
  as limited.
- Watchdog cannot inspect private implementation details of installed add-ons.
- Firefox does not permit Watchdog to disable or uninstall ordinary extensions
  directly, so follow-up actions remain in `about:addons`.
