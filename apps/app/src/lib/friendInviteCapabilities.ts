// Enable only after every supported web and native sign-in path supplies a
// verified recipient phone claim that invite redemption can enforce.
export const VERIFIED_PHONE_IDENTITY_AVAILABLE = false;

export const PHONE_ONLY_FRIEND_INVITE_ERROR =
  "Phone-only invites aren't available because sign-in can't verify phone ownership. Enter the recipient's email instead.";

export function getFriendInviteTargetError(email: string, phone: string) {
  const normalizedEmail = String(email || '').trim();
  const normalizedPhone = String(phone || '').trim();

  if (!normalizedEmail && normalizedPhone && !VERIFIED_PHONE_IDENTITY_AVAILABLE) {
    return PHONE_ONLY_FRIEND_INVITE_ERROR;
  }
  if (!normalizedEmail && !normalizedPhone) {
    return 'Enter an email or phone number for the invite.';
  }
  return null;
}
