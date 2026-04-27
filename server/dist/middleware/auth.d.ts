import { Request, Response, NextFunction } from 'express';
export declare function authMiddleware(req: Request, res: Response, next: NextFunction): void | Response<any, Record<string, any>>;
export declare function adminAuthMiddleware(req: Request, res: Response, next: NextFunction): Response<any, Record<string, any>> | undefined;
