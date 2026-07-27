# Security Policy

## Reporting a vulnerability

Please do not open a public issue for a vulnerability that could put users at
risk. Use GitHub's private vulnerability reporting feature for this repository.

Include:

- The affected version
- Reproduction steps or a proof of concept
- The security impact
- Any suggested mitigation

Reports will be acknowledged as soon as practical. A fix and coordinated
disclosure timeline will be developed after the issue is reproduced.

## Security principles

- No remote code or dynamic code evaluation
- No content scripts or website access
- No telemetry
- Minimal required Firefox permissions
- User-controlled extension actions through Firefox's add-on manager
- Human-readable risk rules
- Signed releases through Mozilla Add-ons
