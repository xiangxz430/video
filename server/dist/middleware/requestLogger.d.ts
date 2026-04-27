import { Request, Response, NextFunction } from 'express';
export interface RequestLog {
    id: string;
    timestamp: string;
    method: string;
    endpoint: string;
    function: string;
    provider: string;
    model: string;
    apiKeyMasked: string;
    statusCode: number;
    duration: number;
    error: string | null;
    requestSummary: string;
}
export declare function requestLogger(req: Request, res: Response, next: NextFunction): void;
export declare function getAllLogs(): RequestLog[];
export declare function getLogById(id: string): RequestLog | null;
