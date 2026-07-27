# Firefox Add-ons Release

Publishing is intentionally separate from normal validation.

## One-time Mozilla setup

1. Sign in or register at the
   [Firefox Add-ons Developer Hub](https://addons.mozilla.org/developers/).
2. Open the
   [AMO API credentials page](https://addons.mozilla.org/developers/addon/api/key/).
3. Generate a JWT issuer and JWT secret.
4. In the GitHub repository, create an environment named `firefox-addons`.
5. Require maintainer approval for that environment.
6. Add these environment secrets:
   - `AMO_JWT_ISSUER`
   - `AMO_JWT_SECRET`

Never place either value in a file, shell history, issue, workflow log, or pull
request.

## First submission

The `amo-metadata.json` file supplies the required summary, category, and
license. The manual **Publish to Firefox Add-ons** workflow can create the AMO
listing and submit the first listed version.

Before running it:

1. Confirm the add-on ID in `extension/manifest.json` is final and unique.
2. Replace placeholder support or homepage links if the GitHub repository URL
   changed.
3. Run the validation workflow successfully.
4. Test the unsigned artifact using `about:debugging`.
5. Review `PRIVACY.md`, the requested permissions, and the AMO metadata.
6. Run the publishing workflow and approve the `firefox-addons` environment.

Mozilla may select the submission for manual review.

## Updates

1. Increase `version` in both `package.json` and `extension/manifest.json`.
2. Update documentation and tests for behavioral changes.
3. Merge only after validation passes.
4. Manually run **Publish to Firefox Add-ons**.
5. Confirm the new version and release notes in the Developer Hub.

Firefox will deliver approved listed updates through AMO.

## Local signing

The same operation can be run locally after setting credentials in the current
shell:

```sh
npx web-ext sign \
  --source-dir extension \
  --artifacts-dir artifacts \
  --channel listed \
  --amo-metadata amo-metadata.json \
  --api-key "$AMO_JWT_ISSUER" \
  --api-secret "$AMO_JWT_SECRET"
```

GitHub's protected environment is preferred because it reduces local secret
handling.
