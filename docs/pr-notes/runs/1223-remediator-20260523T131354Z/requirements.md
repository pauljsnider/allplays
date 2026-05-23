# Requirements

- Block volunteer/staff permission grants when a matching registration indicates volunteer screening is required and not cleared.
- Recognize screening requirements from shapes this codebase writes during public registration, including `programName` and `selectedOption.title` on records built by `buildRegistrationRecord`.
- Preserve existing explicit screening fields for future/legacy records.
- Surface data-access failures while loading registrations with logged, rethrown errors so grant flows do not fail silently or proceed unsafely.
