# 2026-10-22 Desktop native Codex supervisor increment

CLIENT01 now has an independent LocalCodexSession implementation that starts a pinned Windows native Codex app-server, executes local terminal/file tools and loads Skills. It manages streaming events, thread continuation, permission revisions, interruption and shutdown. Full access uses danger-full-access / never. Inference credentials are excluded from shell environments; account/project/version-bound checkpoints reject blind replay and obsolete grants.

Integration checks exercise the real native Codex binary against an authorized synthetic company gateway. The [checkpoint](../quality/local-codex-supervisor-checkpoint.json) records current results and retained failures, including fixes for Skill discovery, resuming empty threads and writing Skills before ownership validation.

This is a supervisor library increment. Electron user flows, local consent UI, company billing/scoped credentials, bundled Codex distribution and the Extension conversation/attachment redesign remain open. Existing captures show the cloud/file-bridge baseline. See the [implementation and remaining integration](../technical/70-desktop-native-codex-supervisor.md) for precise scope.
