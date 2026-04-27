const API_BASE = '';

function getAdminKey(): string {
  return localStorage.getItem('admin_key') || '';
}

async function request(endpoint: string, options?: RequestInit): Promise<any> {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Key': getAdminKey(),
      ...options?.headers,
    },
  });
  if (res.status === 401) {
    localStorage.removeItem('admin_key');
    window.location.reload();
    throw new Error('认证失败');
  }
  const data = await res.json();
  if (!data.success) throw new Error(data.error || '请求失败');
  return data.data;
}

// API Key 类型
export interface ApiKey {
  id: string;
  name: string;
  key: string;
  maskedKey: string;
  createdAt: string;
  lastUsedAt: string | null;
  enabled: boolean;
}

// 统计数据类型
export interface OverviewStats {
  today: { total: number; success: number; failed: number };
  thisWeek: { total: number; success: number; failed: number };
  thisMonth: { total: number; success: number; failed: number };
  byFunction: Record<string, number>;
  byProvider: Record<string, number>;
}

export interface TimeStats {
  labels: string[];
  data: number[];
}

export interface KeyStats {
  keyId: string;
  keyName: string;
  maskedKey: string;
  totalCalls: number;
  lastUsedAt: string | null;
}

// Key 详细统计（含模型细分+费用）
export interface KeyDetailStats {
  keyId: string;
  keyName: string;
  maskedKey: string;
  totalCalls: number;
  totalCost: number;
  lastUsedAt: string | null;
  models: KeyModelBreakdown[];
}

export interface KeyModelBreakdown {
  provider: string;
  model: string;
  displayProvider: string;
  displayModel: string;
  total: number;
  success: number;
  failed: number;
  estimatedCost: number;
  byFunction: Record<string, {
    total: number;
    success: number;
    failed: number;
    estimatedCost: number;
  }>;
}

export interface FunctionStats {
  total: number;
  success: number;
  failed: number;
  avgDuration: number;
}

export interface ProviderStats {
  total: number;
  success: number;
  failed: number;
  avgDuration: number;
}

export interface ModelStats {
  provider: string;
  model: string;
  total: number;
  success: number;
  failed: number;
  avgDuration: number;
}

// 日志类型
export interface RequestLog {
  id: string;
  timestamp: string;
  endpoint: string;
  function: string;
  provider: string;
  statusCode: number;
  duration: number;
  apiKeyMasked: string;
  requestSummary?: string;
  errorMessage?: string;
}

export interface QueryLogsResult {
  logs: RequestLog[];
  total: number;
  page: number;
  pageSize: number;
}

// Provider 配置类型
export interface ProviderConfig {
  name: string;
  apiKey: string;
  baseUrl: string;
  hasKey: boolean;
}

// 系统信息类型
export interface SystemInfo {
  uptime: number;
  memoryUsage: { rss: number; heapUsed: number; heapTotal: number };
  nodeVersion: string;
  platform: string;
  cpuUsage: number;
}

export const api = {
  // 验证 admin key
  async verifyKey(key: string): Promise<boolean> {
    try {
      const res = await fetch(`${API_BASE}/api/admin/system`, {
        headers: {
          'X-Admin-Key': key,
        },
      });
      if (res.status === 401) return false;
      const data = await res.json();
      return data.success;
    } catch {
      return false;
    }
  },

  // Key 管理
  async listKeys(): Promise<ApiKey[]> {
    return request('/api/admin/keys');
  },
  async createKey(name: string): Promise<ApiKey> {
    return request('/api/admin/keys', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  },
  async deleteKey(id: string): Promise<void> {
    return request(`/api/admin/keys/${id}`, {
      method: 'DELETE',
    });
  },
  async toggleKey(id: string, enabled: boolean): Promise<void> {
    return request(`/api/admin/keys/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    });
  },

  // 统计
  async getOverview(): Promise<OverviewStats> {
    return request('/api/admin/stats/overview');
  },
  async getStatsByTime(range: 'day' | 'week' | 'month'): Promise<TimeStats> {
    return request(`/api/admin/stats/by-time?range=${range}`);
  },
  async getStatsByKey(): Promise<KeyStats[]> {
    return request('/api/admin/stats/by-key');
  },
  async getStatsByKeyDetail(): Promise<KeyDetailStats[]> {
    return request('/api/admin/stats/by-key-detail');
  },
  async getStatsByFunction(): Promise<Record<string, FunctionStats>> {
    return request('/api/admin/stats/by-function');
  },
  async getStatsByProvider(): Promise<Record<string, ProviderStats>> {
    return request('/api/admin/stats/by-provider');
  },
  async getStatsByModel(): Promise<Record<string, ModelStats>> {
    return request('/api/admin/stats/by-model');
  },

  // 日志
  async getLogs(params?: {
    page?: number;
    pageSize?: number;
    function?: string;
    provider?: string;
    statusCode?: number;
  }): Promise<QueryLogsResult> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));
    if (params?.function) searchParams.set('function', params.function);
    if (params?.provider) searchParams.set('provider', params.provider);
    if (params?.statusCode) searchParams.set('statusCode', String(params.statusCode));
    return request(`/api/admin/logs?${searchParams.toString()}`);
  },
  async getLogDetail(id: string): Promise<RequestLog> {
    return request(`/api/admin/logs/${id}`);
  },

  // 配置
  async getProviders(): Promise<ProviderConfig[]> {
    return request('/api/admin/config/providers');
  },
  async updateProvider(provider: string, data: { apiKey?: string; baseUrl?: string }): Promise<void> {
    return request('/api/admin/config/providers', {
      method: 'PUT',
      body: JSON.stringify({ provider, ...data }),
    });
  },
  async testProvider(provider: string): Promise<{ success: boolean; message: string; latency: number }> {
    const res = await fetch(`${API_BASE}/api/admin/config/test/${provider}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Key': getAdminKey(),
      },
    });
    if (res.status === 401) {
      localStorage.removeItem('admin_key');
      window.location.reload();
      throw new Error('认证失败');
    }
    return res.json();
  },

  // 系统
  async getSystemInfo(): Promise<SystemInfo> {
    return request('/api/admin/system');
  },
};
