export declare function hashPassword(plain: string): Promise<string>;
export declare function verifyPassword(plain: string, hash: string): Promise<boolean>;
