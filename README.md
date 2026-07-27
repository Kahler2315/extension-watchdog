# Extension Watchdog

Extension Watchdog is a local-first Firefox add-on that explains extension
permissions and records meaningful changes over time.

It does not inspect browsing history, inject scripts into websites, send
telemetry, or claim that an extension is malicious based on permissions alone.
It answers a narrower set of useful questions:

- What can each installed extension access?
- Which combinations of capabilities deserve closer review?
- Did an extension gain API permissions or website access?
- Was an extension installed, removed, enabled, disabled, or updated?

## Current MVP

- Local inventory using Firefox's `management` API
- Plain-language explanations of powerful permissions
- Transparent `limited`, `moderate`, `high`, and `critical` capability tiers
- Detection of high-impact permission combinations
- Local baseline and change history
- Browser notifications for important changes
- Search and focused review filters
- Local JSON report export
- Direct access to Firefox's add-on manager for follow-up actions
- No host permissions and no remote connections

Permission tiers describe **potential access**, not intent or reputation. A
powerful extension can be legitimate, and a low-permission extension is not
automatically trustworthy.

## Try it locally

Firefox can load the source directly:

1. Open `about:debugging`.
2. Select **This Firefox**.
3. Choose **Load Temporary Add-on**.
4. Select `extension/manifest.json`.
5. Click the Extension Watchdog toolbar button and open the dashboard.

For automatic reload and Mozilla's linter, install the current Node.js LTS
release and run:

```sh
npm install
npm start
```

Run all checks and create an unsigned package:

```sh
npm test
npm run lint
npm run build
```

## Privacy

Extension metadata, findings, snapshots, and review state are stored in
`browser.storage.local`. The add-on declares Firefox's `none` data-collection
permission and contains no remote endpoints.

See [PRIVACY.md](PRIVACY.md) for the exact data boundary.

## Repository layout

```text
extension/
  background/       Inventory and change monitoring
  dashboard/        Full review interface
  popup/            Toolbar summary
  rules/            Human-readable permission and combination rules
tests/               Repository and safety checks
docs/                Threat model, risk model, and release notes
.github/workflows/   Validation and opt-in AMO publishing
```

## Publishing

GitHub Actions validates and packages every change. Publishing to Firefox
Add-ons is a separate, manual workflow protected by the `firefox-addons`
environment and two repository secrets:

- `AMO_JWT_ISSUER`
- `AMO_JWT_SECRET`

The credentials are never committed. See
[docs/firefox-release.md](docs/firefox-release.md) before using the workflow.

## Known boundaries

- Watchdog analyzes metadata exposed by Firefox; it does not inspect another
  extension's source code.
- It does not use ratings or online reputation in the MVP.
- Firefox does not let one extension disable another ordinary extension.
  Watchdog opens `about:addons` for user-controlled follow-up actions.
- Change monitoring begins after the first local baseline.
- Rules necessarily involve judgment. Every rule is visible under
  `extension/rules/` and changes should include evidence and tests.

## License

[Mozilla Public License 2.0](LICENSE)
