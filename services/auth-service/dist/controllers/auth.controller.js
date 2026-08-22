import * as authService from "../services/auth.service.js";
export async function register(req, res, next) {
    try {
        const result = await authService.registerUser(req.body, req);
        res.status(201).json({ success: true, data: result });
    }
    catch (err) {
        next(err);
    }
}
export async function login(req, res, next) {
    try {
        const result = await authService.loginUser(req.body, req);
        res.json({ success: true, data: result });
    }
    catch (err) {
        next(err);
    }
}
export async function me(req, res, next) {
    try {
        if (!req.auth?.sub) {
            res.status(401).json({ success: false, error: "Unauthorized.", code: "UNAUTHORIZED" });
            return;
        }
        const user = await authService.getCurrentUser(req.auth.sub);
        res.json({ success: true, data: { user } });
    }
    catch (err) {
        next(err);
    }
}
export async function health(_req, res) {
    res.json({ success: true, service: "auth-service", status: "ok" });
}
//# sourceMappingURL=auth.controller.js.map