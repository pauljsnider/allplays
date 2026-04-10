Code plan
1. Inspect RSVP controller construction and its use of allScheduleEvents.
2. Update controller to read schedule events through a getter, preserving existing behavior after allScheduleEvents is reassigned.
3. Move window.submitGameRsvpFromButton assignment to after controller initialization.
4. Run a targeted syntax check / diff review and commit.
