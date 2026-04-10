Requirements role
Objective: Preserve native Web Share behavior for chat media on strict transient-activation browsers.
Current state: share button awaits media fetch before calling navigator.share().
Proposed state: invoke navigator.share() synchronously from the click path using a precomputed file/share payload or fall back cleanly when file sharing is unsupported.
Risk surface: team chat media share flow only; blast radius limited to browsers with Web Share support.
Assumptions: only one unresolved thread, minimal code change preferred, no automated tests available.
