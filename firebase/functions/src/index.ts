import * as admin from 'firebase-admin';

// Initialize Firebase Admin SDK
admin.initializeApp();

// Export all functions from callable/schedule.ts
export * from './callable/schedule';
