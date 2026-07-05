/// <reference types="vite/client" />

declare module '*.js';
declare module '*.cjs';

interface ImportMetaEnv {
  readonly VITE_ALLPLAYS_FCM_VAPID_KEY?: string;
}
