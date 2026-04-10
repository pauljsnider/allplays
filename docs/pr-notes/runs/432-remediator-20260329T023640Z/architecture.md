Architecture note

Risk surface: coach RSVP panel and save status messaging on game-day page.
Blast radius: one shared controller module and one page-local loader function.
Control change: preserve existing error rendering in loadRsvps, but prevent stale state from overwriting it after failed refresh.
Tradeoff: boolean return is a small contract change, but it is simpler and lower risk than introducing exceptions through existing callers.
