# Requirements analysis

- A legacy document selection that passes the existing batch limit check and contains multiple supported documents must reserve one order range before the first upload helper runs.
- The returned range must be mapped by selection index so the helper calls receive unique sequential orders in selection order, including the supported 20-file boundary.
- Per-file validation and failure reporting remain independent. A failed upload consumes its assigned position; later files keep their reserved values and the resulting gap is harmless.
- Existing single-document, photo, React, storage, notification, and sorting behavior is outside this slice.

The four requested role sessions could not start because `sessions_spawn` returned `published reply runtime missing for main`; this artifact records the requirements-role analysis completed by the main run.
