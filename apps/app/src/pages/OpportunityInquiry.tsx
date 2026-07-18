import { Navigate, useParams } from 'react-router-dom';
import type { AuthState } from '../lib/types';

export function OpportunityInquiry({ auth: _auth }: { auth: AuthState }) {
  const { inquiryId = '' } = useParams();
  return <Navigate replace to={`/messages?inquiry=${encodeURIComponent(inquiryId)}`} />;
}
