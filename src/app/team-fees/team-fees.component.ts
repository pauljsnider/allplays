// src/app/team-fees/team-fees.component.ts
import { Component, OnInit } from '@angular/core';
import { getAuth } from 'firebase/auth';
import type { User } from 'firebase/auth';
import { collectionGroup, getDocs, getFirestore, query, where } from 'firebase/firestore';
import { app } from '../firebase-config';
import { StripeService } from '../shared/services/stripe.service';

interface TeamFee {
  id: string;
  teamId: string;
  batchId: string;
  recipientId: string;
  name: string;
  amount: number;
  isPaid: boolean;
}

type FeeRecipientData = {
  title?: string;
  feeTitle?: string;
  name?: string;
  amount?: number;
  amountCents?: number;
  balanceDueCents?: number;
  status?: string;
  paid?: boolean;
  isPaid?: boolean;
  teamId?: string;
  batchId?: string;
};

function getPathSegment(path: string, segment: string): string {
  const parts = path.split('/');
  const index = parts.indexOf(segment);
  return index >= 0 ? parts[index + 1] || '' : '';
}

function normalizeAmount(data: FeeRecipientData): number {
  if (typeof data.balanceDueCents === 'number') return data.balanceDueCents / 100;
  if (typeof data.amountCents === 'number') return data.amountCents / 100;
  if (typeof data.amount === 'number') return data.amount;
  return 0;
}

function isFeePaid(data: FeeRecipientData): boolean {
  const status = String(data.status || '').toLowerCase();
  if (status === 'paid') return true;
  if (data.paid === true || data.isPaid === true) return true;
  return typeof data.balanceDueCents === 'number' && data.balanceDueCents <= 0;
}

@Component({
  selector: 'app-team-fees',
  templateUrl: './team-fees.component.html',
  styleUrls: ['./team-fees.component.css']
})
export class TeamFeesComponent implements OnInit {
  teamFees: TeamFee[] = [];
  pendingPaymentFeeId: string | null = null;
  paymentErrorMessage: string | null = null;
  isLoadingFees = false;

  constructor(private stripeService: StripeService) { }

  async ngOnInit(): Promise<void> {
    await this.loadTeamFees();
  }

  async loadTeamFees(): Promise<void> {
    this.isLoadingFees = true;
    this.paymentErrorMessage = null;

    try {
      const user = await this.getCurrentUser();
      if (!user) {
        this.teamFees = [];
        return;
      }

      this.teamFees = await this.loadFeeRecipientsForUser(user.uid);
    } catch (error) {
      console.error('Failed to load team fees:', error);
      this.teamFees = [];
      this.paymentErrorMessage = 'Unable to load team fees. Please try again.';
    } finally {
      this.isLoadingFees = false;
    }
  }

  private async getCurrentUser(): Promise<User | null> {
    const auth = getAuth(app);
    if (auth.currentUser) return auth.currentUser;

    return new Promise((resolve) => {
      let unsubscribe = () => undefined;
      unsubscribe = auth.onAuthStateChanged((user) => {
        unsubscribe();
        resolve(user);
      }, () => {
        unsubscribe();
        resolve(null);
      });
    });
  }

  private async loadFeeRecipientsForUser(userId: string): Promise<TeamFee[]> {
    const db = getFirestore(app);
    const recipientsRef = collectionGroup(db, 'feeRecipients');
    const snapshots = await Promise.all([
      getDocs(query(recipientsRef, where('parentUserId', '==', userId))),
      getDocs(query(recipientsRef, where('accountUserId', '==', userId))),
      getDocs(query(recipientsRef, where('userId', '==', userId)))
    ]);
    const feesByPath = new Map<string, TeamFee>();

    snapshots.forEach((snapshot) => {
      snapshot.docs.forEach((docSnap) => {
        const data = docSnap.data() as FeeRecipientData;
        const teamId = data.teamId || getPathSegment(docSnap.ref.path, 'teams');
        const batchId = data.batchId || getPathSegment(docSnap.ref.path, 'feeBatches');
        if (!teamId || !batchId) return;

        feesByPath.set(docSnap.ref.path, {
          id: docSnap.id,
          teamId,
          batchId,
          recipientId: docSnap.id,
          name: data.title || data.feeTitle || data.name || 'Team Fee',
          amount: normalizeAmount(data),
          isPaid: isFeePaid(data)
        });
      });
    });

    return Array.from(feesByPath.values());
  }

  isPaymentLoading(feeId: string): boolean {
    return this.pendingPaymentFeeId === feeId;
  }

  isPaymentPending(): boolean {
    return this.pendingPaymentFeeId !== null;
  }

  async handlePayFee(fee: TeamFee): Promise<void> {
    if (this.isPaymentPending()) {
      return;
    }

    this.pendingPaymentFeeId = fee.id;
    this.paymentErrorMessage = null;

    try {
      const checkoutUrl = await this.stripeService.initiateTeamFeeCheckout(fee.teamId, fee.batchId, fee.recipientId);
      window.location.href = checkoutUrl;
    } catch (error) {
      console.error('Failed to initiate payment:', error);
      this.paymentErrorMessage = 'Failed to initiate payment. Please try again.';
    } finally {
      this.pendingPaymentFeeId = null;
    }
  }
}
