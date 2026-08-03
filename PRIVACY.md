# Privacy

Permission Hound is designed to work without collecting or transmitting user
data.

## Data read from Firefox

The add-on reads metadata Firefox exposes about installed extensions:

- Extension ID, name, description, version, and enabled state
- Installation type and whether the user may remove the extension
- Declared API permissions and host permissions
- Firefox's reason when an extension is disabled after a permission increase
- Manifest-provided homepage, update URL, and icon metadata

It does not request access to browsing history, cookies, downloads, tabs,
clipboard contents, page content, or network requests.

## Local storage

The following information is stored in `browser.storage.local`:

- The latest extension metadata snapshot
- Detected differences between snapshots
- The timestamp of the latest scan
- Whether a recorded change has been reviewed

This information remains inside the user's Firefox profile. Removing Extension
Permission Hound removes its extension storage according to Firefox's normal add-on
behavior.

## Network behavior

Permission Hound does not contact remote servers. Its permission and
combination rules are packaged with the add-on. Exported reports are created
locally and are only shared if the user chooses to share them.

## Telemetry

There is no analytics, telemetry, crash reporting, advertising, or user account.

## Future changes

Any future feature that transmits data must be optional, clearly disclosed, and
reviewed against Mozilla's data-collection policies before release. It must not
silently change the privacy guarantees described here.
