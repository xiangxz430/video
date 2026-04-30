export interface ApiKeyRecord {
    id: string;
    key: string;
    name: string;
    createdAt: string;
    lastUsedAt: string | null;
    enabled: boolean;
}
export declare function generateApiKey(name: string): ApiKeyRecord;
export declare function listApiKeys(): Array<Omit<ApiKeyRecord, 'key'> & {
    maskedKey: string;
}>;
export declare function maskKey(key: string): string;
export declare function deleteApiKey(id: string): boolean;
export declare function toggleApiKey(id: string, enabled: boolean): boolean;
export declare function validateApiKey(key: string): string | null;
export declare function keyExists(key: string): boolean;
export declare function initializeFromEnv(envApiKey: string): void;
