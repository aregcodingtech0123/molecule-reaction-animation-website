export class AppError extends Error {
    statusCode;
    code;
    details;
    constructor(statusCode, message, code, 
    /** Extra machine-readable fields merged into the JSON error body. */
    details) {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
        this.name = "AppError";
    }
}
//# sourceMappingURL=index.js.map