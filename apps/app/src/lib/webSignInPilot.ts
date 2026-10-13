import { functions, httpsCallable } from './adapters/legacyAccountDb';
import { auth, signInWithEmailLink, signOut } from './firebaseAuthRuntime';
import { isNativeRuntime } from './nativeRuntime';

const emailKey = 'allplays-web-sign-in-email';
export const pilotConfirmation = 'If this email is eligible for the pilot, a sign-in link has been sent. Wait one minute before resending.';
export const safePilotNext = (value: string | null) =>
  ['/home', '/teams', '/schedule', '/profile'].includes(value || '') ? value! : '/home';
export const normalizePilotEmail = (value: string) => value.trim().toLowerCase();
export function readPilotEmail() {
  try {
    return localStorage.getItem(emailKey) || '';
  } catch {
    return '';
  }
}
function rememberEmail(email: string) {
  try {
    localStorage.setItem(emailKey, email);
  } catch {
    /* Cross-device/manual entry still works. */
  }
}
function requireBrowser() {
  if (isNativeRuntime()) throw new Error('Open this sign-in link in a web browser.');
}
export async function requestPilotEmail(email: string, next: string) {
  requireBrowser();
  const normalized = normalizePilotEmail(email);
  await httpsCallable(functions, 'requestWebSignInEmail')({ email: normalized, next: safePilotNext(next) });
  rememberEmail(normalized);
}
export async function completePilotEmail(email: string, params: URLSearchParams) {
  requireBrowser();
  const normalized = normalizePilotEmail(email);
  if (auth.currentUser && normalizePilotEmail(auth.currentUser.email || '') !== normalized) {
    throw new Error('A different account is signed in. Sign out first, then reopen this link.');
  }
  const code = params.get('oobCode');
  if (!code || params.get('mode') !== 'signIn') throw new Error('Open the full link from your email or request a new one.');
  const { data } = await httpsCallable(functions, 'preflightWebSignIn')({ email: normalized, code });
  if (auth.currentUser?.uid === data.uid) return safePilotNext(data.next);
  // Construct only SDK action parameters; never use an email URL parameter as identity.
  const link = new URL(window.location.origin + '/app/');
  link.search = new URLSearchParams({ mode: 'signIn', oobCode: code, apiKey: params.get('apiKey') || '' }).toString();
  const result = await signInWithEmailLink(auth, normalized, link.toString());
  // Defense in depth only; this cannot undo Firebase account creation. The
  // production issuance gate stays closed until Auth-level enforcement exists.
  if (result.user.uid !== data.uid) {
    await signOut(auth);
    throw new Error('Account identity changed. Use password sign-in and contact support.');
  }
  rememberEmail('');
  return safePilotNext(data.next);
}
export async function signOutPilotAccount() {
  requireBrowser();
  await signOut(auth);
}
