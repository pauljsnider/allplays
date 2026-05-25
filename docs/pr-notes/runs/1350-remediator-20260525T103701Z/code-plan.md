# Code Plan

Implementation plan:
- Compute a checkoutSelectedOptionId that only sends an option ID when required or selected.
- Read serverCheckoutFeeSnapshot from submitOfflineRegistration result registration/fee fields.
- Use server amount/currency in initiateRegistrationCheckout.
- Catch checkout/open URL errors separately and show guidance that registration was created but checkout did not open.
- Update unit tests for all review threads.
