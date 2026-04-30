import { Collection } from 'mongodb';
import { RequestLog } from '../types/index.js';
/**
 * 连接 MongoDB 并初始化索引
 */
export declare function connectMongo(): Promise<void>;
/**
 * 获取日志集合（确保已连接）
 */
export declare function getLogsCollection(): Collection<RequestLog>;
/**
 * 关闭 MongoDB 连接
 */
export declare function closeMongo(): Promise<void>;
