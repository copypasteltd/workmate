# Integrated backend regression and attachment recovery

Extension 0.5.2 keeps browser-selected folder contents unread until explicit confirmation. Folder review now explains existing pending/failed attachment blockers inside the modal, disables only unchecked items at the 19-file limit, and displays nonempty small files in bytes. Remove the failed ordinary attachment or let its upload finish, then confirm; uncheck one file to select another. Retry retains exact private receipts and explicit Send remains separate.

Run run-integrated-recovery-full-v2.mjs NN MAX_FILES for durable per-file backend receipts and resume the same immutable source inventory; run-integrated-recovery-v1.mjs NN extension|clients for Extension units and client builds; run-integrated-recovery-client-units-v1.mjs NN for all current Web/Admin/Desktop/Delivery unit files; run-integrated-recovery-ui-v1.mjs NN for the actual Chrome journey. Each attempt uses a fresh number and exact source archives; database-backed runs own and clean up their native database. publish-workmate-v3.mjs --push checks all historical proofs in bounded shards and atomically verifies eight nonforce refs. Failed reports and executed verifiers remain immutable.

1363 backend checks in 111 files + 229 Web/Admin/Desktop/Delivery unit checks + 63 Extension checks + 7 adversarial proof-reader cases; 13 builds; 7 actual UI flows; 6 layouts; 9 PNGs and 2 GIF/MP4 pairs.

[Runbook / 方案](../technical/120-integrated-regression-and-attachment-recovery.md) · [Evidence / 证据](../quality/integrated-recovery-checkpoint.json)
