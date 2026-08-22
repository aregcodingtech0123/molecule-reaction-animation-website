export interface UserProfileInput {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
}
export interface PublicUserProfile {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    isAdmin: boolean;
    isVerified: boolean;
    createdAt: string;
}
export declare function validateFirstName(value: unknown): string;
export declare function validateLastName(value: unknown): string;
export declare function validateDateOfBirth(value: unknown): string;
export declare function validateProfileInput(input: {
    firstName: unknown;
    lastName: unknown;
    dateOfBirth: unknown;
}): UserProfileInput;
export declare function validateProfileUpdateInput(input: {
    firstName?: unknown;
    lastName?: unknown;
    dateOfBirth?: unknown;
}): Partial<UserProfileInput>;
/** Assign realistic placeholder profile data for legacy or OAuth-created accounts. */
export declare function generateRandomProfile(): UserProfileInput;
export interface UserRow {
    id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
    date_of_birth: Date | string | null;
    is_admin: boolean;
    is_verified: boolean;
    created_at: Date;
}
export declare function toPublicUserProfile(row: UserRow): PublicUserProfile;
