import { Request, Response, NextFunction } from 'express';
import { RequestLog } from '../types/index.js';
export declare function requestLogger(req: Request, res: Response, next: NextFunction): void;
/** 获取指定用户的日志（客户端统计用，走 keyId 索引，0 跨用户开销） */
export declare function getLogsByUser(keyId: string): Promise<RequestLog[]>;
/** 获取所有用户的日志（管理后台用） */
export declare function getAllLogs(): Promise<RequestLog[]>;
/** 按 ID 查找日志（管理后台日志详情用） */
export declare function getLogById(id: string): Promise<RequestLog | null>;
