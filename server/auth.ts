import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { HttpError } from './http.js';

const GOOGLE_KEYS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'),
);

export interface Player {
  uid: string;
  anonymous: boolean;
}

/**
 * Checks a Firebase Auth ID token the way Firebase documents it: signed by Google, issued for this project, for a
 * real user. Doing it with jose means the server needs only the (public) project ID, not a service account key.
 */
export async function verifyIdToken(token: string, projectId: string, keys: JWTVerifyGetKey = GOOGLE_KEYS): Promise<Player> {
  const { payload } = await jwtVerify(token, keys, {
    algorithms: ['RS256'],
    audience: projectId,
    issuer: `https://securetoken.google.com/${projectId}`,
  });
  const uid = payload.sub;
  const authTime = payload.auth_time;
  if (!uid || uid.length > 128 || typeof authTime !== 'number' || authTime * 1000 > Date.now()) {
    throw new errors.JWTClaimValidationFailed('invalid sub or auth_time', payload);
  }
  const provider = (payload.firebase as { sign_in_provider?: string } | undefined)?.sign_in_provider;
  return { uid, anonymous: provider === 'anonymous' };
}

export async function requirePlayer(request: Request): Promise<Player> {
  const projectId = process.env.VITE_FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error('VITE_FIREBASE_PROJECT_ID is not set');
  const token = /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!token) throw new HttpError(401, 'Sign in required');
  try {
    return await verifyIdToken(token, projectId);
  } catch (err) {
    // Not being able to fetch Google's keys is our problem, not a bad token.
    if (err instanceof errors.JOSEError && !(err instanceof errors.JWKSTimeout)) throw new HttpError(401, 'Invalid or expired sign-in');
    throw err;
  }
}
