// src/app/shared/services/stripe.service.ts
import { Injectable } from '@angular/core';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../../firebase-config';

@Injectable({
  providedIn: 'root'
})
export class StripeService {

  constructor() { }

  async initiateTeamFeeCheckout(teamId: string, batchId: string, recipientId: string): Promise<string> {
    const functions = getFunctions(app);
    const createCheckoutSession = httpsCallable(functions, 'createStripeTeamFeeCheckout');

    try {
      const result = await createCheckoutSession({ teamId, batchId, recipientId });
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
