interface GrsaiImageParams {
    prompt: string;
    model?: string;
    size?: string;
    aspectRatio?: string;
    referenceImages?: string[];
    useStream?: boolean;
    onProgress?: (progress: number) => void;
}
export declare function generateImageWithGrsai(params: GrsaiImageParams, apiKey: string, baseUrl?: string): Promise<string>;
export declare function getGrsaiResult(taskId: string, apiKey: string, baseUrl?: string): Promise<{
    status: string;
    url?: string;
    content?: string;
    progress?: number;
    failureReason?: string;
    error?: string;
}>;
export {};
