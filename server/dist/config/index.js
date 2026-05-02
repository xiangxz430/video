import dotenv from 'dotenv';
dotenv.config();
export const config = {
    port: parseInt(process.env.PORT || '3000'),
    apiKey: process.env.API_KEY || '',
    adminKey: process.env.ADMIN_KEY || '',
    mongodb: {
        uri: process.env.MONGODB_URI || 'mongodb://localhost:27017',
        dbName: process.env.MONGODB_DB_NAME || 'video_generator',
    },
    providers: {
        deepseek: {
            apiKey: process.env.DEEPSEEK_API_KEY || '',
            baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
        },
        volcengine: {
            apiKey: process.env.VOLCENGINE_API_KEY || '',
            baseUrl: process.env.VOLCENGINE_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3',
        },
        grsai: {
            apiKey: process.env.GRSAI_API_KEY || '',
            baseUrl: process.env.GRSAI_BASE_URL || 'https://grsai.dakka.com.cn',
        },
        openrouter: {
            apiKey: process.env.OPENROUTER_API_KEY || '',
            baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
        },
        idealab: {
            apiKey: process.env.IDEALAB_API_KEY || '',
            baseUrl: process.env.IDEALAB_BASE_URL || '',
        },
        qwen: {
            apiKey: process.env.QWEN_API_KEY || '',
            baseUrl: process.env.QWEN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        },
        tokenplan: {
            apiKey: process.env.TOKENPLAN_API_KEY || '',
            baseUrl: process.env.TOKENPLAN_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
        },
        dashscope: {
            apiKey: process.env.DASHSCOPE_API_KEY || '',
            baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/api/v1',
        },
    }
};
// 根据 provider 名称获取配置的辅助函数
export function getProviderConfig(provider) {
    return config.providers[provider] || { apiKey: '', baseUrl: '' };
}
