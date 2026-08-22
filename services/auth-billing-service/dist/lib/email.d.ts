export interface SendEmailParams {
    to: string;
    subject: string;
    html: string;
    text: string;
}
/**
 * Transactional email via Resend HTTP API.
 * When RESEND_API_KEY is unset in development, logs the payload instead of failing hard
 * so local signup flows remain testable.
 */
export declare function sendEmail(params: SendEmailParams): Promise<void>;
export declare function buildVerificationEmail(params: {
    email: string;
    firstName: string;
    verifyUrl: string;
}): SendEmailParams;
export declare function buildPasswordResetEmail(params: {
    email: string;
    resetUrl: string;
}): SendEmailParams;
