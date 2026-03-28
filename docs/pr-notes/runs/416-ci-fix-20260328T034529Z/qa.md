QA focus: validate YAML syntax and confirm the jq expression is parseable by gh/jq semantics.
Manual validation: inspect workflow after patch; if available, run a local jq parse check against equivalent JSON.
Risk: low, because the change only affects comment lookup in deploy-preview.
