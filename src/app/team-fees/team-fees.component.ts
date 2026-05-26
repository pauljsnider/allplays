// src/app/team-fees/team-fees.component.ts
import { Component, OnInit } from '@angular/core';
import { getAuth } from 'firebase/auth';
import type { User } from 'firebase/auth';
import { collectionGroup, doc, getDoc, getDocs, getFirestore, query, where } from 'firebase/firestore';
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

type ParentPlayerLink = {
  teamId?: string;
  playerId?: string;
};

type UserProfileData = {
  parentOf?: ParentPlayerLink[];
  parentPlayerKeys?: string[];
};

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
  parentUserId?: string;
  accountUserId?: string;
  userId?: string;
  playerId?: string;
  childId?: string;
  playerKey?: string;
};


function getParentPlayerKey(teamId: string, playerId: string): string {
  return teamId && playerId ? `${teamId}::${playerId}` : '';
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function getAllowedParentPlayerKeys(profile: UserProfileData): string[] {
  const profileKeys = Array.isArray(profile.parentPlayerKeys) ? profile.parentPlayerKeys : [];
  const linkKeys = (Array.isArray(profile.parentOf) ? profile.parentOf : [])
    .map((link) => getParentPlayerKey(String(link?.teamId || ''), String(link?.playerId || '')));
  return uniqueStrings([...profileKeys, ...linkKeys]);
}

function getChildLinks(parentPlayerKeys: string[]): ParentPlayerLink[] {
  return parentPlayerKeys
    .map((key) => {
      const [teamId, playerId] = key.split('::');
      return { teamId: teamId || '', playerId: playerId || '' };
    })
    .filter((link) => link.teamId && link.playerId);
}

function isAllowedParentFeeRecipient(data: FeeRecipientData, userId: string, parentPlayerKeys: Set<string>): boolean {
  if ([data.parentUserId, data.accountUserId, data.userId].includes(userId)) return true;
  const teamId = data.teamId || '';
  const playerId = data.playerId || data.childId || '';
  const playerKey = data.playerKey || getParentPlayerKey(teamId, playerId);
  return parentPlayerKeys.has(playerKey);
}

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
    const userProfile = await this.loadUserProfile(db, userId);
    const parentPlayerKeys = new Set(getAllowedParentPlayerKeys(userProfile));
    const childLinks = getChildLinks(Array.from(parentPlayerKeys));
    const teamIds = uniqueStrings(childLinks.map((child) => String(child.teamId || '')));
    const feeQueries = teamIds.length > 0
      ? [
          ...teamIds.flatMap((teamId) => [
            query(recipientsRef, where('teamId', '==', teamId), where('parentUserId', '==', userId)),
            query(recipientsRef, where('teamId', '==', teamId), where('accountUserId', '==', userId)),
            query(recipientsRef, where('teamId', '==', teamId), where('userId', '==', userId))
          ]),
          ...childLinks.map((child) => query(
            recipientsRef,
            where('teamId', '==', child.teamId),
            where('playerId', '==', child.playerId)
          ))
        ]
      : [
          query(recipientsRef, where('parentUserId', '==', userId)),
          query(recipientsRef, where('accountUserId', '==', userId)),
          query(recipientsRef, where('userId', '==', userId))
        ];
    const snapshots = await Promise.all(feeQueries.map((feeQuery) => getDocs(feeQuery)));
    const uniqueDocs = new Map<string, { id: string; ref: { path: string }; data: () => unknown }>();
    const feesByPath = new Map<string, TeamFee>();

    snapshots.forEach((snapshot) => {
      snapshot.docs.forEach((docSnap) => {
        if (!uniqueDocs.has(docSnap.ref.path)) {
          uniqueDocs.set(docSnap.ref.path, docSnap);
        }
      });
    });

    uniqueDocs.forEach((docSnap) => {
      const data = docSnap.data() as FeeRecipientData;
      const teamId = data.teamId || getPathSegment(docSnap.ref.path, 'teams');
      const batchId = data.batchId || getPathSegment(docSnap.ref.path, 'feeBatches');
      if (!teamId || !batchId) return;

      const normalizedData = { ...data, teamId };
      if (parentPlayerKeys.size > 0 && !isAllowedParentFeeRecipient(normalizedData, userId, parentPlayerKeys)) return;

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

    return Array.from(feesByPath.values());
  }

  private async loadUserProfile(db: ReturnType<typeof getFirestore>, userId: string): Promise<UserProfileData> {
    try {
      const userSnap = await getDoc(doc(db, 'users', userId));
      return userSnap.exists() ? userSnap.data() as UserProfileData : {};
    } catch (error) {
      console.warn('Failed to load team fee parent links:', error);
      return {};
    }
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
