import { Request, Response, NextFunction } from 'express';
import { RequestLog } from '../types/index.js';
export declare function requestLogger(req: Request, res: Response, next: NextFunction): void;
export declare function getAllLogs(): RequestLog[];
export declare function getLogById(id: string): RequestLog | null;
