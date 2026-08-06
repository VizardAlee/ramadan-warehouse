import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore, type Firestore } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions, type Functions } from "firebase/functions";
import { connectStorageEmulator, getStorage, type FirebaseStorage } from "firebase/storage";
import { appCheckSiteKey, getFirebaseConfig, useFirebaseEmulators } from "./config";

interface FirebaseServices { app: FirebaseApp; auth: Auth; db: Firestore; functions: Functions; storage: FirebaseStorage }
let services: FirebaseServices | undefined;

export function getFirebaseServices(): FirebaseServices {
  if (services) return services;
  const app = getApps().length > 0 ? getApp() : initializeApp(getFirebaseConfig());
  if (typeof window !== "undefined" && appCheckSiteKey) {
    if (useFirebaseEmulators) {
      (globalThis as typeof globalThis & { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    }
    initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey), isTokenAutoRefreshEnabled: true });
  }
  const auth = getAuth(app);
  const db = getFirestore(app);
  const functions = getFunctions(app, "us-central1");
  const storage = getStorage(app);

  if (useFirebaseEmulators && typeof window !== "undefined") {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFirestoreEmulator(db, "127.0.0.1", 8180);
    connectFunctionsEmulator(functions, "127.0.0.1", 5001);
    connectStorageEmulator(storage, "127.0.0.1", 9199);
  }

  services = { app, auth, db, functions, storage };
  return services;
}
