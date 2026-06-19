# Notifications verification matrix

Shipped notification categories in scope for issue #2191:

- `schedule`
- `practice`
- `liveScore`
- `liveChat`
- `mentions`
- `fees`

## Platform matrix

| Category | Trigger path | iOS foreground | iOS background | iOS cold start | Android foreground | Android background | Android cold start | Web foreground | Web background | Web cold start | Automated coverage |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| schedule | `notifyGameCreated`, `notifyGameUpdated`, `dispatchDuePreEventReminders` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | `functions/test/notification-triggers.test.js`, `functions/test/send-category-notification.test.js` |
| practice | `notifyGameCreated` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | `functions/test/notification-triggers.test.js` |
| liveScore | `notifyGameUpdated` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | `functions/test/notification-triggers.test.js` |
| liveChat | `notifyTeamChatMessageCreated` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | `functions/test/notification-triggers.test.js`, `functions/test/send-category-notification.test.js` |
| mentions | `notifyTeamChatMessageCreated` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | `functions/test/notification-triggers.test.js`, `functions/test/send-category-notification.test.js` |
| fees | `notifyFeeAssigned`, `notifyFeeMarkedPaid`, `sendFeeUnpaidDueReminders` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | `functions/test/notification-triggers.test.js` |

## Automated assertions required for release

Each shipped category must have automated coverage for:

1. Happy-path send behavior.
2. Preference-off behavior that suppresses delivery.
3. Once-only guards for categories that use deduplication.
4. Notification audit writes for every delivered category.
5. CI enforcement through `.github/workflows/ci.yml` via `npm run test:functions:notifications`.

## Notes

- `liveChat` and `mentions` are intentionally excluded from the once-only dedup guard because those categories must deliver every qualifying message.
- `fees` fan out can generate separate payer and staff audit entries when the destination route differs.
