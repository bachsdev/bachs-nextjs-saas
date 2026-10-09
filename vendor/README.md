# Official SDK package

This archive is the official @bachs/sdk 1.0.0 implementation, built with
npm run check and packed from:
https://github.com/bachsdev/bachs-node/tree/17ebcfd9764cf1bc157f60491da33bbd848e2372

The package contains compiled code, types, README and MIT license.
It has no runtime dependencies. It does not contain local development logs,
credentials or sandbox data.

SHA-256: f01d1c4aaafb2537e047b56baf65e703d3ab3ad3ab0dbb7c820537820b1f0da9

The starter uses file:vendor/bachs-sdk-1.0.0.tgz, so a fresh clone can run
npm ci without a sibling checkout or an unreleased npm version. Its imports
remain @bachs/sdk.

## Switch to npm after release

First confirm that the published version contains the matching implementation
and supported resource methods. The current npm 0.0.1 version is a placeholder.

After the matching 1.0.0 release is available:

```bash
npm install @bachs/sdk@1.0.0 --save-exact
npm run verify
```

Commit package.json and package-lock.json together. Once the registry
dependency passes verification, remove the unused archive and this note.
Do not publish the SDK under another name or replace it with a custom client.
