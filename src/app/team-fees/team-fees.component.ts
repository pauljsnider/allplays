// src/app/team-fees/team-fees.component.ts
import { Component, OnInit } from '@angular/core';
import { StripeService } from '../shared/services/stripe.service';

interface TeamFee {
  id: string;
  teamId: string;
  batchId: string;
  recipientId: string;
  name: string;
  amount: number;
  isPaid: boolean; // Assuming this property
  // ... other fee properties
}

@Component({
  selector: 'app-team-fees',
  templateUrl: './team-fees.component.html',
  styleUrls: ['./team-fees.component.css']
})
export class TeamFeesComponent implements OnInit {
  teamFees: TeamFee[] = []; // Populate this from data service
  isLoadingPayment: boolean = false;
  paymentErrorMessage: string | null = null;

  constructor(private stripeService: StripeService) { }

  ngOnInit(): void {
    // In a real application, data would be fetched from Firestore or a backend API.
    // For this demonstration, we populate with mock data.
    this.teamFees = [
      { id: 'fee1', teamId: 'teamA', batchId: 'batch1', recipientId: 'recipient1', name: 'Registration Fee', amount: 100, isPaid: false },
      { id: 'fee2', teamId: 'teamA', batchId: 'batch2', recipientId: 'recipient2', name: 'Uniform Fee', amount: 50, isPaid: true },
      { id: 'fee3', teamId: 'teamB', batchId: 'batch3', recipientId: 'recipient3', name: 'Tournament Fee', amount: 75, isPaid: false },
    ];
  }

  async handlePayFee(teamId: string, batchId: string, recipientId: string): Promise<void> {
    this.isLoadingPayment = true;
    this.paymentErrorMessage = null; // Clear previous errors

    try {
      const checkoutUrl = await this.stripeService.initiateTeamFeeCheckout(teamId, batchId, recipientId);
      window.location.href = checkoutUrl; // Redirect to Stripe
    } catch (error) {
      console.error('Failed to initiate payment:', error);
      this.paymentErrorMessage = 'Failed to initiate payment. Please try again.';
    } finally {
      this.isLoadingPayment = false;
    }
  }
}
