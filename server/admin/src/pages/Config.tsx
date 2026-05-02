import { useEffect, useState } from 'react';
import { api, ProviderConfig } from '../services/api';

const PROVIDER_NAMES: Record<string, string> = {
  deepseek: 'DeepSeek',
  volcengine: '火山方舟',
  grsai: 'GRSai',
  openrouter: 'OpenRouter',
  idealab: 'IdeaLab',
  qwen: '通义千问',
  dashscope: '百炼(DashScope)',
  tokenplan: '百炼Token Plan',
};

interface EditingState {
  apiKey: string;
  baseUrl: string;
}

export function Config() {
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Record<string, EditingState>>({});
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; message: string; latency: number }>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  const fetchProviders = async () => {
    try {
      setLoading(true);
      const data = await api.getProviders();
      setProviders(data);
      // 初始化编辑状态
      const initialEditing: Record<string, EditingState> = {};
      data.forEach((p) => {
        initialEditing[p.name] = { apiKey: '', baseUrl: p.baseUrl || '' };
      });
      setEditing(initialEditing);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProviders();
  }, []);

  const handleSave = async (provider: string) => {
    try {
      setSaving((prev) => ({ ...prev, [provider]: true }));
      const data: { apiKey?: string; baseUrl?: string } = {};
      if (editing[provider]?.apiKey) {
        data.apiKey = editing[provider].apiKey;
      }
      if (editing[provider]?.baseUrl !== undefined) {
        data.baseUrl = editing[provider].baseUrl;
      }
      await api.updateProvider(provider, data);
      // 清空已保存的 API Key
      setEditing((prev) => ({
        ...prev,
        [provider]: { ...prev[provider], apiKey: '' },
      }));
      fetchProviders();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving((prev) => ({ ...prev, [provider]: false }));
    }
  };

  const handleTest = async (provider: string) => {
    try {
      setTesting((prev) => ({ ...prev, [provider]: true }));
      const result = await api.testProvider(provider);
      setTestResults((prev) => ({ ...prev, [provider]: result }));
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [provider]: { success: false, message: err instanceof Error ? err.message : '测试失败', latency: 0 },
      }));
    } finally {
      setTesting((prev) => ({ ...prev, [provider]: false }));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-600">加载中...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">AI 配置管理</h1>

      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded-lg">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {providers.map((provider) => (
          <div key={provider.name} className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-800">
                  {PROVIDER_NAMES[provider.name] || provider.name}
                </h3>
                <span
                  className={`inline-block mt-1 px-2 py-0.5 text-xs rounded-full ${
                    provider.hasKey ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {provider.hasKey ? '已配置' : '未配置'}
                </span>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">API Key</label>
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    value={provider.apiKey || '未配置'}
                    readOnly
                    className="flex-1 px-3 py-2 bg-gray-100 border border-gray-200 rounded-md text-sm text-gray-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Base URL</label>
                <input
                  type="text"
                  value={provider.baseUrl || ''}
                  readOnly
                  className="w-full px-3 py-2 bg-gray-100 border border-gray-200 rounded-md text-sm text-gray-500"
                />
              </div>

              {/* 编辑区域 */}
              <div className="border-t border-gray-200 pt-4 space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">修改 API Key</label>
                  <input
                    type="password"
                    value={editing[provider.name]?.apiKey || ''}
                    onChange={(e) =>
                      setEditing((prev) => ({
                        ...prev,
                        [provider.name]: { ...prev[provider.name], apiKey: e.target.value },
                      }))
                    }
                    placeholder="输入新的 API Key"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">修改 Base URL</label>
                  <input
                    type="text"
                    value={editing[provider.name]?.baseUrl || ''}
                    onChange={(e) =>
                      setEditing((prev) => ({
                        ...prev,
                        [provider.name]: { ...prev[provider.name], baseUrl: e.target.value },
                      }))
                    }
                    placeholder="输入新的 Base URL"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="flex items-center space-x-2 pt-2">
                  <button
                    onClick={() => handleSave(provider.name)}
                    disabled={saving[provider.name]}
                    className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {saving[provider.name] ? '保存中...' : '保存'}
                  </button>
                  <button
                    onClick={() => handleTest(provider.name)}
                    disabled={testing[provider.name]}
                    className="px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded-md hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {testing[provider.name] ? '测试中...' : '测试连通性'}
                  </button>
                </div>

                {/* 测试结果 */}
                {testResults[provider.name] && (
                  <div
                    className={`mt-3 p-3 rounded-md text-sm ${
                      testResults[provider.name].success
                        ? 'bg-green-50 text-green-800'
                        : 'bg-red-50 text-red-800'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span>{testResults[provider.name].message}</span>
                      <span className="text-xs text-gray-500">
                        延迟: {testResults[provider.name].latency}ms
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
