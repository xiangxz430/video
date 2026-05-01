import React, { useState, useEffect } from 'react';
import { checkHealth, saveServerConfig, getCurrentServerConfig, getApiUsageStats } from '../services/serverApiClient';

type TestStatus = 'idle' | 'testing' | 'success' | 'error';

interface TestResult {
  status: TestStatus;
  message?: string;
}

const Settings: React.FC = () => {
  // ===== 服务端配置状态 =====
  const [serverUrl, setServerUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [testResult, setTestResult] = useState<TestResult>({ status: 'idle' });
  const [isLoading, setIsLoading] = useState(true);
  const [usageStats, setUsageStats] = useState<{
    totalCalls: number;
    successCalls: number;
    failedCalls: number;
    successRate: string;
    totalCost: number;
    lastUsedAt: string | null;
    byFunction: Record<string, { total: number; success: number; failed: number }>;
    byProvider: Record<string, { total: number; success: number; failed: number }>;
    byModel: Record<string, {
      provider: string;
      model: string;
      displayProvider: string;
      displayModel: string;
      total: number;
      success: number;
      failed: number;
      estimatedCost: number;
    }>;
  } | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(false);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);

  // ===== 调试日志 =====
  const addDebugLog = (msg: string) => {
    const timestamp = new Date().toLocaleTimeString('zh-CN');
    setDebugLogs(prev => [...prev.slice(-49), `[${timestamp}] ${msg}`]);
  };

  // ===== 加载服务端配置 =====
  useEffect(() => {
    loadSavedConfig();
  }, []);

  const loadSavedConfig = async () => {
    try {
      const config = await getCurrentServerConfig();
      addDebugLog(`加载服务端配置: url=${config.serverUrl}, hasKey=${!!config.apiKey}`);
      setServerUrl(config.serverUrl);
      setApiKey(config.apiKey);
    } catch (error: any) {
      addDebugLog(`加载服务端配置失败: ${error?.message || '未知错误'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const loadUsageStats = async () => {
    if (!serverUrl.trim() || !apiKey.trim()) {
      return;
    }

    setIsLoadingStats(true);
    try {
      const stats = await getApiUsageStats();
      setUsageStats({
        totalCalls: stats.totalCalls,
        successCalls: stats.successCalls,
        failedCalls: stats.failedCalls,
        successRate: stats.successRate,
        totalCost: stats.totalCost,
        lastUsedAt: stats.lastUsedAt,
        byFunction: stats.byFunction,
        byProvider: stats.byProvider,
        byModel: stats.byModel,
      });
    } catch (error: any) {
      addDebugLog(`加载调用统计失败: ${error?.message || '未知错误'}`);
    } finally {
      setIsLoadingStats(false);
    }
  };

  const handleSave = async () => {
    if (!serverUrl.trim()) {
      alert('请输入服务端地址');
      return;
    }

    setSaveStatus('saving');
    try {
      await saveServerConfig(serverUrl.trim(), apiKey.trim());
      setSaveStatus('saved');
      setTimeout(() => {
        setSaveStatus('idle');
        loadUsageStats();
      }, 1000);
    } catch (error: any) {
      addDebugLog(`保存服务端配置失败: ${error?.message || '未知错误'}`);
      alert(`保存失败: ${error.message || '未知错误'}`);
      setSaveStatus('idle');
    }
  };

  const handleTestConnection = async () => {
    if (!serverUrl.trim()) {
      setTestResult({ status: 'error', message: '请先输入服务端地址' });
      return;
    }

    setTestResult({ status: 'testing' });
    try {
      // 先保存配置到数据库，确保测试和后续使用的是同一份配置
      await saveServerConfig(serverUrl.trim().replace(/\/+$/, ''), apiKey.trim());
      
      const result = await checkHealth(serverUrl.trim(), apiKey.trim());
      if (result.ok) {
        setTestResult({ status: 'success', message: '连接成功（已自动保存）' });
      } else {
        setTestResult({ status: 'error', message: result.error || '服务端未响应' });
      }
    } catch (error: any) {
      setTestResult({
        status: 'error',
        message: error.message || '连接失败'
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500">加载配置中...</div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      {/* 标题和返回按钮 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            服务端配置
          </h1>
          <p className="text-gray-600">
            配置 AI 服务端的连接信息
          </p>
        </div>
        <button
          onClick={() => window.history.back()}
          className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition flex items-center space-x-2"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
          </svg>
          <span>返回</span>
        </button>
      </div>

      {/* 服务端配置卡片 */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <div className="flex items-center space-x-3 mb-6">
          <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">服务端连接</h2>
            <p className="text-sm text-gray-500">所有 AI 调用将通过此服务端进行</p>
          </div>
        </div>

        <div className="space-y-4">
          {/* 服务端地址 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              服务端地址
              <span className="text-red-500 ml-1">*</span>
            </label>
            <input
              type="text"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="http://your-server.com:3000"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <p className="mt-1 text-xs text-gray-500">
              服务端运行的地址和端口，例如：http://8.147.65.80:3000
            </p>
          </div>

          {/* API Key */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              服务端密钥
            </label>
            <input
              type="text"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-xxxxxxxxxxxxxxxx"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <p className="mt-1 text-xs text-gray-500">
              服务端分配的 API Key，用于身份验证（如果服务端配置了密钥）
            </p>
          </div>

          {/* 测试连接 */}
          <div className="flex items-center space-x-4 pt-2">
            <button
              onClick={handleTestConnection}
              disabled={testResult.status === 'testing'}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition flex items-center space-x-2 disabled:opacity-50"
            >
              {testResult.status === 'testing' ? (
                <>
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span>测试中...</span>
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  <span>测试连接</span>
                </>
              )}
            </button>

            {testResult.status === 'success' && (
              <span className="flex items-center text-sm text-green-600">
                <svg className="h-4 w-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                {testResult.message}
              </span>
            )}

            {testResult.status === 'error' && (
              <span className="flex items-center text-sm text-red-600" title={testResult.message}>
                <svg className="h-4 w-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
                {testResult.message}
              </span>
            )}
          </div>
        </div>

        {/* 保存按钮 */}
        <div className="mt-6 pt-4 border-t border-gray-200 flex justify-end">
          <button
            onClick={handleSave}
            disabled={saveStatus === 'saving'}
            className={`px-6 py-2 rounded-md font-medium transition-colors ${
              saveStatus === 'saved'
                ? 'bg-green-600 text-white'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            } disabled:opacity-50`}
          >
            {saveStatus === 'saving'
              ? '保存中...'
              : saveStatus === 'saved'
              ? '已保存'
              : '保存配置'}
          </button>
        </div>
      </div>

      {/* 使用说明 */}
      <div className="bg-blue-50 rounded-lg p-4">
        <h3 className="text-sm font-medium text-blue-900 mb-2">使用说明</h3>
        <ul className="text-sm text-blue-700 space-y-1 list-disc list-inside">
          <li>服务端地址是运行 AI 服务的 Node.js 服务器地址</li>
          <li>默认服务端地址为 http://8.147.65.80:3000，如需本地运行可改为 http://localhost:3000</li>
          <li>服务端密钥用于身份验证，如果服务端未配置可留空</li>
          <li>配置将安全地存储在本地数据库中</li>
          <li>所有 AI 调用（剧本生成、图片生成、视频生成等）都将通过此服务端进行</li>
        </ul>
      </div>

      {/* 调用量统计 */}
      {usageStats && (
        <div className="bg-white rounded-lg shadow p-6 mt-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">API 调用量统计</h2>
                <p className="text-sm text-gray-500">当前密钥的使用情况</p>
              </div>
            </div>
            <button
              onClick={loadUsageStats}
              disabled={isLoadingStats}
              className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition disabled:opacity-50"
            >
              {isLoadingStats ? '刷新中...' : '刷新'}
            </button>
          </div>

          {/* 总览 */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
            <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-4">
              <div className="text-sm text-blue-600 mb-1">总调用次数</div>
              <div className="text-2xl font-bold text-blue-900">{usageStats.totalCalls}</div>
            </div>
            <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-4">
              <div className="text-sm text-green-600 mb-1">成功次数</div>
              <div className="text-2xl font-bold text-green-900">{usageStats.successCalls}</div>
            </div>
            <div className="bg-gradient-to-br from-red-50 to-red-100 rounded-lg p-4">
              <div className="text-sm text-red-600 mb-1">失败次数</div>
              <div className="text-2xl font-bold text-red-900">{usageStats.failedCalls}</div>
            </div>
            <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg p-4">
              <div className="text-sm text-purple-600 mb-1">成功率</div>
              <div className="text-2xl font-bold text-purple-900">{usageStats.successRate}</div>
            </div>
            <div className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-lg p-4">
              <div className="text-sm text-orange-600 mb-1">估计费用</div>
              <div className="text-xl font-bold text-orange-900">${usageStats.totalCost.toFixed(4)}</div>
            </div>
          </div>

          {/* 按功能分类 */}
          {Object.keys(usageStats.byFunction).length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">按功能分类</h3>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">功能</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">总调用</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">成功</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">失败</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {Object.entries(usageStats.byFunction).map(([func, stats]) => (
                      <tr key={func}>
                        <td className="px-4 py-2 text-sm font-medium text-gray-900 capitalize">{func}</td>
                        <td className="px-4 py-2 text-sm text-gray-600">{stats.total}</td>
                        <td className="px-4 py-2 text-sm text-green-600">{stats.success}</td>
                        <td className="px-4 py-2 text-sm text-red-600">{stats.failed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 按 Provider 分类 */}
          {Object.keys(usageStats.byProvider).length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">按 Provider 分类</h3>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Provider</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">总调用</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">成功</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">失败</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {Object.entries(usageStats.byProvider).map(([provider, stats]) => (
                      <tr key={provider}>
                        <td className="px-4 py-2 text-sm font-medium text-gray-900 capitalize">{provider}</td>
                        <td className="px-4 py-2 text-sm text-gray-600">{stats.total}</td>
                        <td className="px-4 py-2 text-sm text-green-600">{stats.success}</td>
                        <td className="px-4 py-2 text-sm text-red-600">{stats.failed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 按模型分类（含费用） */}
          {Object.keys(usageStats.byModel).length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">按模型分类（含费用）</h3>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Provider</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Model</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">调用</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">成功</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">失败</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">成功率</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">估计费用</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {Object.entries(usageStats.byModel).map(([key, model]) => {
                      const successRate = model.total > 0 ? (model.success / model.total * 100).toFixed(1) + '%' : '-';
                      return (
                        <tr key={key}>
                          <td className="px-4 py-2 text-sm text-gray-900">{model.displayProvider}</td>
                          <td className="px-4 py-2 text-sm font-mono text-gray-700">{model.displayModel}</td>
                          <td className="px-4 py-2 text-sm text-gray-600">{model.total}</td>
                          <td className="px-4 py-2 text-sm text-green-600">{model.success}</td>
                          <td className="px-4 py-2 text-sm text-red-600">{model.failed}</td>
                          <td className="px-4 py-2 text-sm text-gray-500">{successRate}</td>
                          <td className="px-4 py-2 text-sm font-semibold text-orange-600">${model.estimatedCost.toFixed(4)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 最后使用时间 */}
          {usageStats.lastUsedAt && (
            <div className="mt-4 pt-4 border-t border-gray-200">
              <p className="text-sm text-gray-500">
                最后使用：{new Date(usageStats.lastUsedAt).toLocaleString('zh-CN')}
              </p>
            </div>
          )}
        </div>
      )}

      {/* 调试日志框 */}
      <div className="bg-gray-900 rounded-lg p-4 mt-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-gray-300">调试日志</h3>
          <button
            onClick={() => setDebugLogs([])}
            className="text-xs text-gray-500 hover:text-gray-300"
          >
            清空
          </button>
        </div>
        <div className="bg-gray-800 rounded p-3 h-32 overflow-y-auto font-mono text-xs space-y-1">
          {debugLogs.length === 0 ? (
            <span className="text-gray-500">暂无日志...</span>
          ) : (
            debugLogs.map((log, i) => (
              <div key={i} className="text-gray-300">
                {log}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default Settings;
