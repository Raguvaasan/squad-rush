export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
}

/**
 * The Firebase web config from VITE_FIREBASE_*, or null if any of it is missing, in which case the game runs offline.
 * Kept apart from online.ts so checking it doesn't pull Firebase into the main bundle.
 */
export function firebaseConfig(): FirebaseConfig | null {
  const env = import.meta.env;
  const config = {
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  };
  return Object.values(config).every(Boolean) ? (config as FirebaseConfig) : null;
}
