// Keep this value aligned with /.well-known/allplays-runtime-config.json.
// Native packages cannot fetch that hosted endpoint from Capacitor's
// https://localhost origin during cold start.
export const nativeFirebaseConfig = {
  apiKey: 'AIzaSyDoixIoKJuUVWdmImwjYRTthjKOv2mU0Jc',
  authDomain: 'game-flow-c6311.firebaseapp.com',
  projectId: 'game-flow-c6311',
  storageBucket: 'game-flow-c6311.firebasestorage.app',
  messagingSenderId: '982493478258',
  appId: '1:982493478258:web:1f942c420cef6c40e8b1eb',
  measurementId: 'G-VTLSFV4PHW'
} as const;
