import { Request, Response, NextFunction } from 'express';
declare global {
    namespace Express {
        interface Request {
            apiKeyId?: string;
        }
    }
}
export declare function authMiddleware(req: Request, res: Response, next: NextFunction): void | Response<any, Record<string, any>>;
export declare function adminAuthMiddleware(req: Request, res: Response, next: NextFunction): Response<any, Record<string, any>> | undefined;
