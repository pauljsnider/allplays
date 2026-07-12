import { functions, httpsCallable } from './adapters/legacyOpportunityDb';
import type {
  ManagedOpportunityTeam,
  OpportunityFilters,
  OpportunityInput,
  OpportunityInquiry,
  PublicOpportunity
} from './opportunityLogic';

async function call<T>(name: string, data: Record<string, unknown> = {}): Promise<T> {
  const result = await httpsCallable(functions, name)(data);
  return result.data as T;
}

export async function listPublicOpportunities(filters: OpportunityFilters = {}, cursor: string | null = null) {
  return call<{ items: PublicOpportunity[]; nextCursor: string | null }>('listPublicOpportunities', { filters, cursor, pageSize: 24 });
}

export async function getPublicOpportunity(listingId: string) {
  const result = await call<{ item: PublicOpportunity }>('getPublicOpportunity', { listingId });
  return result.item;
}

export async function createPublicOpportunity(input: OpportunityInput) {
  const result = await call<{ item: PublicOpportunity }>('createPublicOpportunity', input);
  return result.item;
}

export async function updatePublicOpportunity(listingId: string, input: OpportunityInput) {
  const result = await call<{ item: PublicOpportunity }>('updatePublicOpportunity', { listingId, input });
  return result.item;
}

export async function closePublicOpportunity(listingId: string) {
  const result = await call<{ item: PublicOpportunity }>('closePublicOpportunity', { listingId });
  return result.item;
}

export async function renewPublicOpportunity(listingId: string) {
  const result = await call<{ item: PublicOpportunity }>('renewPublicOpportunity', { listingId });
  return result.item;
}

export async function listMyPublicOpportunities() {
  const result = await call<{ items: PublicOpportunity[] }>('listMyPublicOpportunities');
  return result.items;
}

export async function listManagedPublicOpportunityTeams() {
  const result = await call<{ items: ManagedOpportunityTeam[] }>('listManagedPublicOpportunityTeams');
  return result.items;
}

export async function reportPublicOpportunity(listingId: string, reason: string) {
  return call<{ success: boolean }>('reportPublicOpportunity', { listingId, reason });
}

export async function createOpportunityInquiry(listingId: string, message: string) {
  const result = await call<{ inquiry: OpportunityInquiry }>('createOpportunityInquiry', { listingId, message });
  return result.inquiry;
}

export async function listOpportunityInquiries(cursor = '') {
  return call<{ items: OpportunityInquiry[]; nextCursor: string | null }>('listOpportunityInquiries', cursor ? { cursor } : {});
}

export async function getOpportunityInquiry(inquiryId: string) {
  const result = await call<{ inquiry: OpportunityInquiry }>('getOpportunityInquiry', { inquiryId });
  return result.inquiry;
}

export async function replyToOpportunityInquiry(inquiryId: string, message: string) {
  return call<{ success: boolean }>('replyToOpportunityInquiry', { inquiryId, message });
}

export type OpportunityReport = { id: string; listingId: string; listingTitle: string; reason: string; createdAt: string | null };

export async function listPublicOpportunityReports() {
  const result = await call<{ items: OpportunityReport[] }>('listPublicOpportunityReports');
  return result.items;
}

export async function moderatePublicOpportunity(listingId: string, action: 'remove' | 'restore') {
  return call<{ success: boolean }>('moderatePublicOpportunity', { listingId, action });
}
