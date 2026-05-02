export declare const config: {
    port: number;
    apiKey: string;
    adminKey: string;
    mongodb: {
        uri: string;
        dbName: string;
    };
    providers: {
        deepseek: {
            apiKey: string;
            baseUrl: string;
        };
        volcengine: {
            apiKey: string;
            baseUrl: string;
        };
        grsai: {
            apiKey: string;
            baseUrl: string;
        };
        openrouter: {
            apiKey: string;
            baseUrl: string;
        };
        idealab: {
            apiKey: string;
            baseUrl: string;
        };
        qwen: {
            apiKey: string;
            baseUrl: string;
        };
        tokenplan: {
            apiKey: string;
            baseUrl: string;
        };
        dashscope: {
            apiKey: string;
            baseUrl: string;
        };
    };
};
export declare function getProviderConfig(provider: string): any;
