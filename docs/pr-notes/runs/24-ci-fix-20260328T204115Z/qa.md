QA focus: parser/import failure affecting 13 suites and likely preview bundle loading.
Validation plan: run targeted Vitest suites that import the calendar/ICS utility surface, then run the direct failing file plus one downstream consumer.
Residual risk: if preview-smoke depends on environment-specific data, it may need a separate rerun after syntax fix.
