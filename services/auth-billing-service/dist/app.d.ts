declare global {
    namespace Express {
        interface Request {
            rawBody?: Buffer;
        }
    }
}
export declare function createApp(): import("express-serve-static-core").Express;
