
// src/app/shared/services/stripe.service.ts
import { Injectable } from '@angular/core';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../../app/firebase-config'; // Adjusted path

@Injectable({
  providedIn: 'root'
})
export class StripeService {

  constructor() { }

  async initiateTeamFeeCheckout(teamId: string, teamFeeId: string): Promise<string> {
    const functions = getFunctions(app);
    const createCheckoutSession = httpsCallable(functions, 'createStripeTeamFeeCheckout');

    try {
      const result = await createCheckoutSession({ teamId, teamFeeId });
      const data = result.data as { checkoutUrl?: string };
      if (data.checkoutUrl) {
        return data.checkoutUrl;
      } else {
        throw new Error('Stripe checkout URL not returned from function.');
      }
    } catch (error) {
      console.error('Error initiating Stripe checkout:', error);
      throw error;
    }
  }
}
