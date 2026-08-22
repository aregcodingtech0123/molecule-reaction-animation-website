import { type PublicUserProfile, type UserProfileInput } from "../utils/profile.js";
export declare function getProfileByUserId(userId: string): Promise<PublicUserProfile>;
export declare function updateProfileByUserId(userId: string, updates: Partial<UserProfileInput>): Promise<PublicUserProfile>;
