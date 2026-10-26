# Cloud schedule publication record correction

Committed-content verification rejected three new documentation tools whose CRLF working copies were normalized to LF by the declared `text:auto`, `eol:lf` attributes. The manifest now records each actual committed digest, its qualified working digest and the exact declared transformation. Product sources, existing verifiers, qualification records and captured media retain their original bytes.

The supplemental verifier checks every publication proof against actual HEAD objects in all seven clean repositories. It separately reads every current qualification source and declared normalization. Historical checkout copies are covered by clean indexes and their content-addressed HEAD objects, avoiding repeated reads of thousands of retained copies. The receipt states this scope explicitly.

Run `python -X utf8 docs/tools/repair_cloud_schedule_publication.py verify --report dev/copypaste-delivery/.data/publication/<fresh-directory>/committed-proof-verification.json` from the project root. After verification, import the six component commits, check remote ancestry, atomically push the eight explicit mapped branches without force or deletion, and re-read remote SHAs. Actual push receipts remain under Delivery `.data/publication/`.

[Correction evidence](../quality/cloud-schedule-publication-repair-01.json) · [Feature design and qualification scope](../technical/104-private-cloud-schedules.md)
