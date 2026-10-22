# 2026-10-22 client execution direction amendment (CLIENT01)

The user requires Desktop to run Codex on the customer's computer, with user-opt-in full local access and Codex Desktop as the operation benchmark. The Extension uses a ChatGPT-style conversation and attachment layout, acquires and reads selected files, and uploads them for cloud Agent execution. Frameless Desktop, the native right Side Panel, the internal AI gateway and CopyPaste branding remain required.

Source review confirms that Desktop currently uses cloud Codex and a restricted file bridge. It does not satisfy the local-kernel/full-access requirement. The Extension has a native Side Panel and basic uploads, but its task-form-first interface needs restructuring. Requirements, product journeys, page structure, architecture, runtime, permissions, local execution, client responsibilities, delivery limitations and bilingual component READMEs have been aligned.

Eight Desktop and six Extension acceptance conditions supplement the original 102 requirements and test cases. This amendment does not change client runtime code or fabricate screenshots of an unimplemented UI. Historical packages and recordings remain evidence of their original implementation only.

See [CLIENT01](../requirements/03-client-execution-amendment.md), the [direction audit and development plan](../technical/69-desktop-local-codex-and-extension-direction.md), and the [machine-readable review](../quality/client-direction-audit.json). Full product repairs and revised client delivery remain in progress.
