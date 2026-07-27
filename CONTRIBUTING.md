# Contributing

Thank you for helping make extension permissions easier to understand.

## Before submitting a change

1. Keep the add-on dependency-free at runtime.
2. Do not add remote code, analytics, or network calls.
3. Add evidence and tests when changing a risk classification.
4. Use neutral language: permissions describe capability, not malicious intent.
5. Run:

```sh
npm test
npm run lint
npm run build
```

## Risk-rule changes

A rule change should explain:

- Which Firefox permission or permission combination it covers
- The capability granted by Firefox
- Why the selected tier is proportionate
- Likely legitimate uses
- What the add-on must avoid claiming

Avoid opaque numerical scores. Reviewers and users should be able to trace every
label back to a declared capability.
