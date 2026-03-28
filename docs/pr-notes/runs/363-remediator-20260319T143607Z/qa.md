QA role
Validate manually on a browser with Web Share support and one without file-share support.
Checks: image/video share opens native sheet, unsupported browsers still fall back to URL copy, non-media messages unchanged.
Residual risk: cached file generation can fail for remote media fetches, so fallback path must remain intact.
