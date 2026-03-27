Architecture role
Decision: keep the existing share/copy fallback structure, but reorder work so the share API is called within the original user activation.
Smallest viable path: prepare a File when the media modal opens, cache it, and have the share handler call navigator.share() without awaiting a fetch first.
Controls: no data model or auth changes; only client-side timing behavior changes.
