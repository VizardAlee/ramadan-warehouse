const firebaseEnvironment = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export function getFirebaseConfig() {
  const missing = Object.entries(firebaseEnvironment).filter(([, value]) => !value).map(([key]) => key);
  if (missing.length > 0) throw new Error(`Missing Firebase browser configuration: ${missing.join(", ")}`);
  return firebaseEnvironment as Record<keyof typeof firebaseEnvironment, string>;
}

export const useFirebaseEmulators = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true";
export const appCheckSiteKey = process.env.NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY;
