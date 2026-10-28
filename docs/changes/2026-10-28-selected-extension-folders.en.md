# Selected browser folders

Extension 0.5.1 adds Folder next to Attach files. Choose a browser folder, review paths/checks, confirm upload, then return and Send a message. No Desktop/nativeMessaging is needed. Up to 19 files plus a JSON index in an empty composer, each nonempty file ≤5 MiB. Hidden/build paths start unchecked; empty/oversize files cannot be selected. Completed private uploads keep exact receipts through retry. Cancel clears this batch of unsent attachments; committed private uploads follow normal retention. Scope changes discard the old review/results.

Use node scripts/run-extension-folder-v1.mjs NN core|clients and node scripts/run-extension-folder-ui-v3.mjs NN with fresh attempt numbers. Publication now uses node scripts/publish-workmate-v2.mjs --push: all historical proofs are retained in ≤20 MiB hash-bound shards, and every actual Git proof is verified before the atomic eight-ref nonforce push. Failed evidence/verifiers are immutable.

59 backend + 59 Extension checks + 7 adversarial proof-reader cases; 13 builds; 6 actual UI flows; 4 layouts; 7 PNGs and 2 GIF/MP4 pairs.

[Runbook / 方案](../technical/119-extension-selected-folders.md) · [Evidence / 证据](../quality/extension-folder-checkpoint.json)
