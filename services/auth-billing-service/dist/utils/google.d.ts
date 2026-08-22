export interface VerifiedGoogleIdentity {
    email: string;
    googleSub: string;
    emailVerified: boolean;
}
/** Verify a Google ID token from the frontend Sign-In flow. */
export declare function verifyGoogleIdToken(idToken: string): Promise<VerifiedGoogleIdentity>;
