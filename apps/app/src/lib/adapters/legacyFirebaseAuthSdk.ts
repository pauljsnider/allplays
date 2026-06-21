import { getApp as legacyGetApp, getApps as legacyGetApps, initializeApp as legacyInitializeApp } from '@legacy/vendor/firebase-app.js';
import {
  applyActionCode as legacyApplyActionCode,
  confirmPasswordReset as legacyConfirmPasswordReset,
  createUserWithEmailAndPassword as legacyCreateUserWithEmailAndPassword,
  getAuth as legacyGetAuth,
  getRedirectResult as legacyGetRedirectResult,
  GoogleAuthProvider as LegacyGoogleAuthProvider,
  indexedDBLocalPersistence as legacyIndexedDBLocalPersistence,
  initializeAuth as legacyInitializeAuth,
  isSignInWithEmailLink as legacyIsSignInWithEmailLink,
  onAuthStateChanged as legacyOnAuthStateChanged,
  sendEmailVerification as legacySendEmailVerification,
  sendPasswordResetEmail as legacySendPasswordResetEmail,
  signInWithEmailAndPassword as legacySignInWithEmailAndPassword,
  signInWithEmailLink as legacySignInWithEmailLink,
  signInWithPopup as legacySignInWithPopup,
  signInWithRedirect as legacySignInWithRedirect,
  signOut as legacySignOut,
  updatePassword as legacyUpdatePassword,
  verifyPasswordResetCode as legacyVerifyPasswordResetCode
} from '@legacy/vendor/firebase-auth.js';
import { resolvePrimaryFirebaseConfig as legacyResolvePrimaryFirebaseConfig } from '@legacy/firebase-runtime-config.js';

/**
 * Typed adapter boundary for the vendored Firebase app/auth SDK + runtime config
 * used by firebaseAuthRuntime (#2066). Bindings re-exported as-is (no behavior
 * change to the auth boot path); SDK shapes stay loose.
 */
export const getApp = legacyGetApp as (...args: any[]) => any;
export const getApps = legacyGetApps as () => any[];
export const initializeApp = legacyInitializeApp as (...args: any[]) => any;
export const applyActionCode = legacyApplyActionCode as (...args: any[]) => Promise<any>;
export const confirmPasswordReset = legacyConfirmPasswordReset as (...args: any[]) => Promise<any>;
export const createUserWithEmailAndPassword = legacyCreateUserWithEmailAndPassword as (...args: any[]) => Promise<any>;
export const getAuth = legacyGetAuth as (...args: any[]) => any;
export const getRedirectResult = legacyGetRedirectResult as (...args: any[]) => Promise<any>;
export const GoogleAuthProvider = LegacyGoogleAuthProvider as any;
export const indexedDBLocalPersistence = legacyIndexedDBLocalPersistence as any;
export const initializeAuth = legacyInitializeAuth as (...args: any[]) => any;
export const isSignInWithEmailLink = legacyIsSignInWithEmailLink as (...args: any[]) => boolean;
export const onAuthStateChanged = legacyOnAuthStateChanged as (...args: any[]) => () => void;
export const sendEmailVerification = legacySendEmailVerification as (...args: any[]) => Promise<any>;
export const sendPasswordResetEmail = legacySendPasswordResetEmail as (...args: any[]) => Promise<any>;
export const signInWithEmailAndPassword = legacySignInWithEmailAndPassword as (...args: any[]) => Promise<any>;
export const signInWithEmailLink = legacySignInWithEmailLink as (...args: any[]) => Promise<any>;
export const signInWithPopup = legacySignInWithPopup as (...args: any[]) => Promise<any>;
export const signInWithRedirect = legacySignInWithRedirect as (...args: any[]) => Promise<any>;
export const signOut = legacySignOut as (...args: any[]) => Promise<any>;
export const updatePassword = legacyUpdatePassword as (...args: any[]) => Promise<any>;
export const verifyPasswordResetCode = legacyVerifyPasswordResetCode as (...args: any[]) => Promise<any>;
export const resolvePrimaryFirebaseConfig = legacyResolvePrimaryFirebaseConfig as (...args: any[]) => Promise<any>;
