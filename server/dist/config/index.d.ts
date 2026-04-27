export declare const config: {
    port: number;
    apiKey: string;
    adminKey: string;
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
    };
};
export declare function getProviderConfig(provider: string): any;
