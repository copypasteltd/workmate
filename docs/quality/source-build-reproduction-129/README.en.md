# Six clean-source installation and build checks

All six independent repositories at the published Stage128 commits completed fresh locked dependency installation and their actual build commands on 30 October 2026, Hong Kong time. This supplement qualifies installation and compilation reproducibility. Full functional, live-service and installer acceptance remains in the [102-record open-work ledger](../remaining-work-stage128.md).

| No. | Branch | Exact source commit | Installation | Build | Successful attempt |
| --- | --- | --- | --- | --- | --- |
| 1 | backend | `0dfc253b8a1c3cec200cba2973189c10306a33e8` | Passed | Passed | 02 |
| 2 | web | `b7c948e07c2bb73730212cacd0419e9ff5a839cb` | Passed on retry | Passed | 03 |
| 3 | admin | `ab746ab5c9e0eafff2de627d186bd512bcfbe8cc` | Passed | Passed | 02 |
| 4 | desktop | `83ac69d0009de328ef73ccb066dba9f27994dd0b` | Passed | Passed | 02 |
| 5 | extension | `a33e732392e7aec66d4f858ad869e11bd9e84957` | Passed | Passed | 02 |
| 6 | delivery | `1f8bac7165fffddb57610caf90f6e96664394d49` | Passed | Passed | 02 |

Native Windows and Node v22.14.0 ran `npm ci --no-audit --no-fund` and `npm run build` using each committed package-lock.json. Independent shallow local Git transport clones supplied the source, without copying node_modules, build output or .env from the working repositories. The build environment used mock mode, made no AI calls and started no browsers, application services or virtualization. This does not qualify installation from GitHub on another computer.

After building, all six commits, Git trees, package inputs and clean working trees were rechecked, along with all 1841 Stage128 source/media bindings. The sole permitted normalization is the already declared Git CRLF-to-LF conversion of the Desktop root .gitattributes; primary workspace bytes were preserved. See the [archive index](index.json) and [Chinese README](README.md).

Attempt01 completed the first five clean clones, then deliberately cancelled the owned full Delivery checkout, which contains 385432 tracked files, predominantly historical evidence. Its original failed result and cancellation request remain. Attempt02 created an independent sparse Delivery clone excluding only evidence/. Five installations and builds passed; Web encountered registry.npmjs.org EIDLETIMEOUT during installation, so the original attempt02 result remains failed. Attempt03 retried only the unchanged Web installation and build, both successfully. It retains the five matching-source successes from attempt02 and rechecks their source identities. All three reports, raw logs, executed verifier versions and the npm error log are preserved byte for byte.

For Delivery source development and compilation, the following optional PowerShell procedure avoids checking out historical evidence. Choose a new source directory. Normal full-stack operation still follows each component's bilingual README and uses six sibling independent repositories. Run `git sparse-checkout disable` when historical evidence is required.

```powershell
$deliverySource = 'D:\dev\copypasted\自有agent\dev\workmate-delivery-source'
git clone --depth 1 --single-branch --sparse --branch delivery git@github.com:copypasteltd/workmate.git $deliverySource
"/*`n!/evidence/`n" | git -C $deliverySource sparse-checkout set --no-cone --stdin
Set-Location -LiteralPath $deliverySource
npm ci --no-audit --no-fund
npm run build
```

The actual qualification used the same sparse rules over local Git transport. The remote clone command above is documentation, not evidence of a newly executed network clone. Only historical evidence/ is excluded; the source commit, tree, scripts, tests, QA files and dependency lock remain. Delivery's actual build passed.

Stage128 [customer-local startup recovery](../../technical/128-desktop-startup-recovery.md) passed 91 related controller checks, 43 actual local Codex checks, 30 native database/API checks, three current compilation checks and six actual unsigned packaged-UI checks. Exact bindings and limits remain in its [checkpoint](../startup-recovery-checkpoint-128.json). This supplement adds fresh installation/build evidence only, adds no runtime-test count and closes no full-acceptance item. The 89 required records, 12 unconfirmed suggestions and one optional record remain open.

This publication adds documentation and immutable originals only. Stage128 component source, screenshots, GIFs, bilingual repository READMEs, publication manifest and checkpoints retain their versions. The index also preserves the actual successful Stage128 eight-branch publication receipt. A later documentation-only push must retain a separate remote-readback receipt; compilation success cannot establish publication success.
