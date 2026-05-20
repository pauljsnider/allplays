# Code Implementation Plan for UI Paid Registration via Stripe Checkout (Issue #1079)

## Objective
Implement the client-side UI and logic within the `pauljsnider/allplays` repository to initiate the Stripe Checkout process for paid registrations, adhering to minimal, standards-compliant changes.

## Affected Files (from Issue)
*   `src/app/registration/registration.component.ts`
*   `src/app/shared/services/stripe.service.ts` (Likely new or significant update)
*   `src/app/registration/registration.component.html` (Implicitly affected for UI elements)

## Prerequisites
*   An existing Firebase Callable Function (e.g., `createStripeCheckoutSession`) is already deployed and functional within Firebase Functions. This function accepts registration details and returns a Stripe Checkout Session URL.
*   The application is using Angular and the Firebase SDK (e.g., `firebase/functions`, `angularfire/functions`).

## Implementation Steps

### Step 1: Create/Update `src/app/shared/services/stripe.service.ts`
This service will abstract the interaction with the Firebase Callable Function.

1.  **Import necessary modules:** `Injectable` from `@angular/core`, `Observable` from `rxjs`, and `AngularFireFunctions` from `@angular/fire/functions`.
2.  **Define a method `requestStripeCheckoutSession`:**
    *   **Signature:** `requestStripeCheckoutSession(params: { registrationId: string, amount: number, currency: string, successUrl: string, cancelUrl: string }): Promise<string>`
    *   **Logic:**
        *   Obtain a reference to the callable Firebase Function: `const callable = this.fns.httpsCallable('createStripeCheckoutSession');` (Ensure the function name `'createStripeCheckoutSession'` matches the deployed Firebase Function).
        *   Invoke the callable function with the provided `params`.
        *   Handle the response: the callable function is expected to return an object containing `checkoutUrl`. Extract this URL.
        *   Return the `checkoutUrl` as a `Promise<string>`.
        *   Implement basic error handling (e.g., `try-catch` or `.catch()` on the promise) to log and rethrow specific errors that can be handled by the calling component.

    **Example Snippet (conceptual):**
    ```typescript
    // src/app/shared/services/stripe.service.ts
    import { Injectable } from '@angular/core';
    import { AngularFireFunctions } from '@angular/fire/functions';
    // ... other imports

    @Injectable({ providedIn: 'root' })
    export class StripeService {
      constructor(private fns: AngularFireFunctions) { }

      async requestStripeCheckoutSession(params: { 
        registrationId: string; 
        amount: number; 
        currency: string; 
        successUrl: string; 
        cancelUrl: string; 
      }): Promise<string> {
        try {
          const callable = this.fns.httpsCallable('createStripeCheckoutSession');
          const result = await callable(params).toPromise();
          if (result && result.data && result.data.checkoutUrl) {
            return result.data.checkoutUrl;
          } else {
            throw new Error('Invalid response from Stripe checkout session creation.');
          }
        } catch (error) {
          console.error('Error creating Stripe checkout session:', error);
          throw error;
        }
      }
    }
    ```

### Step 2: Update `src/app/registration/registration.component.ts` and `registration.component.html`
This component will integrate the `StripeService` and manage the UI flow.

1.  **Modify `registration.component.ts`:**
    *   **Import `StripeService`:** `import { StripeService } from '../shared/services/stripe.service';`
    *   **Inject `StripeService`:** Add `private stripeService: StripeService` to the constructor.
    *   **Add State Variables:**
        *   `isProcessingPayment: boolean = false;` (to control loading spinner and button state)
        *   `paymentErrorMessage: string | null = null;` (to display errors)
        *   `selectedRegistrationOption: any;` (to hold details of the selected paid option).
    *   **Implement `initiateStripePayment()` method:**
        *   Set `this.isProcessingPayment = true;` and clear `this.paymentErrorMessage = null;`.
        *   Construct the `params` object for `requestStripeCheckoutSession` using `selectedRegistrationOption` data (e.g., `this.selectedRegistrationOption.id`, `this.selectedRegistrationOption.price`, `this.selectedRegistrationOption.currency`).
        *   Define `successUrl` and `cancelUrl` (these should typically be configured as application routes, e.g., `/registration/success` and `/registration/cancel`). These URLs should ideally be derived from environment configuration or router state to be dynamic.
        *   Call `this.stripeService.requestStripeCheckoutSession(params)`.
        *   **On success:** Redirect `window.location.href = checkoutUrl;`.
        *   **On error:** Catch the error, set `this.paymentErrorMessage = 'Payment initiation failed. Please try again.';` (or a more specific message).
        *   **Finally block:** Set `this.isProcessingPayment = false;` to reset the loading state.

    **Example Snippet (conceptual):**
    ```typescript
    // src/app/registration/registration.component.ts
    import { Component, OnInit } from '@angular/core';
    import { StripeService } from '../shared/services/stripe.service';
    // ... other imports

    @Component({
      // ...
    })
    export class RegistrationComponent implements OnInit {
      isProcessingPayment: boolean = false;
      paymentErrorMessage: string | null = null;
      selectedRegistrationOption: any; // Assume this gets populated with paid option details

      constructor(private stripeService: StripeService, /* ... other services */) { }

      ngOnInit(): void {
        // ... logic to determine and set selectedRegistrationOption if paid
      }

      async initiateStripePayment(): Promise<void> {
        if (!this.selectedRegistrationOption || !this.selectedRegistrationOption.requiresPayment) {
          this.paymentErrorMessage = 'Please select a paid registration option.';
          return;
        }

        this.isProcessingPayment = true;
        this.paymentErrorMessage = null;

        const successUrl = `${window.location.origin}/registration/payment-success`;
        const cancelUrl = `${window.location.origin}/registration/payment-cancel`;

        try {
          const checkoutUrl = await this.stripeService.requestStripeCheckoutSession({
            registrationId: this.selectedRegistrationOption.id,
            amount: this.selectedRegistrationOption.price,
            currency: 'usd', // Or dynamically set
            successUrl,
            cancelUrl
          });
          window.location.href = checkoutUrl;
        } catch (error) {
          this.paymentErrorMessage = 'Failed to initiate payment. Please try again later.';
          console.error('Payment initiation error:', error);
        } finally {
          this.isProcessingPayment = false;
        }
      }
    }
    ```

2.  **Modify `src/app/registration/registration.component.html`:**
    *   Add a conditional display for the "Pay Registration" button.
    *   Bind the `click` event to `initiateStripePayment()`.
    *   Disable the button while `isProcessingPayment` is true.
    *   Add a loading spinner/message when `isProcessingPayment` is true.
    *   Display `paymentErrorMessage` if present.

    **Example Snippet (conceptual):**
    ```html
    <!-- src/app/registration/registration.component.html -->
    <div *ngIf="selectedRegistrationOption?.requiresPayment">
      <!-- Display registration summary and amount due -->
      <p>Amount Due: {{ selectedRegistrationOption.price | currency }}</p>

      <button (click)="initiateStripePayment()" [disabled]="isProcessingPayment">
        <span *ngIf="!isProcessingPayment">Pay Registration with Stripe</span>
        <span *ngIf="isProcessingPayment">Redirecting to Stripe...</span>
      </button>

      <div *ngIf="paymentErrorMessage" class="error-message">
        {{ paymentErrorMessage }}
      </div>
    </div>
    <!-- ... rest of registration flow -->
    ```

## Testing Strategy (Code Perspective)
*   **Unit Tests:** Implement `StripeService` unit tests to mock `AngularFireFunctions` and verify its interaction. Implement `RegistrationComponent` unit tests to verify `initiateStripePayment` logic, state changes, and calls to `StripeService` (mocking `StripeService`).
*   **Local Development:** Manually test the full flow by running the application locally, connecting to a test Firebase project, and using Stripe's test mode.

## Evidence
*   New file: `src/app/shared/services/stripe.service.ts`
*   Modified file: `src/app/registration/registration.component.ts`
*   Modified file: `src/app/registration/registration.component.html`
*   Passing unit tests for the new service and component logic.
*   Verification of successful redirection to Stripe Checkout in a local test environment.
