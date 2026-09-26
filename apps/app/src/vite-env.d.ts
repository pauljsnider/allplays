/// <reference types="vite/client" />

declare module '*.js';
declare module '*.cjs';

interface ImportMetaEnv {
  readonly VITE_ALLPLAYS_FCM_VAPID_KEY?: string;
  readonly VITE_DIAMOND_SCOREBOOK_UI_ENABLED?: string;
}
