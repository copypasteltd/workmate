# Publish the historical verification logs referenced by the manifest

Independent committed-content inspection found that `*.log` excluded 190 historical logs referenced by publication plans. Earlier working-file digests did not establish Git reachability. The correction checks every original digest and adds only those explicitly referenced logs to the Delivery commit, preserving their exact bytes and all existing source, results and history.

The repair checks existing proof entries against actual committed Git blobs and SHA256 values. Product and qualification source files remain unchanged. It makes no additional model-quality or complete-product acceptance claim. See the [repair receipt](../quality/client-content-reachability-repair.json) and [product increment](../technical/102-client-content-releases.md).
