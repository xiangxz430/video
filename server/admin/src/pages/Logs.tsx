import { useEffect, useState } from 'react';
import { api, RequestLog, QueryLogsResult, AIApiCall } from '../services/api';

const FUNCTIONS = ['script', 'storyboard', 'image', 'video'];
const PROVIDERS = ['deepseek', 'volcengine', 'grsai', 'openrouter', 'idealab', 'qwen'];

export function Logs() {
  const [logs, setLogs] = useState<RequestLog[]>([]);
  const [pagination, setPagination] = useState<Pick<QueryLogsResult, 'total' | 'page' | 'pageSize'>>({
    total: 0,
    page: 1,
    pageSize: 20,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedLog, setExpandedLog] = useState<string | null>(null);

  // 筛选条件
  const [functionFilter, setFunctionFilter] = useState('');
  const [providerFilter, setProviderFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'failed'>('all');

  const fetchLogs = async (page: number = 1) => {
    try {
      setLoading(true);
      setError('');

      const params: Parameters<typeof api.getLogs>[0] = {
        page,
        pageSize: 20,
      };

      if (functionFilter) params.function = functionFilter;
      if (providerFilter) params.provider = providerFilter;
      if (statusFilter === 'success') params.statusCode = 200;
      if (statusFilter === 'failed') params.statusCode = 500;

      const result = await api.getLogs(params);
      setLogs(result.logs);
      setPagination({
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取日志失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs(1);
  }, [functionFilter, providerFilter, statusFilter]);

  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > Math.ceil(pagination.total / pagination.pageSize)) return;
    fetchLogs(newPage);
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN');
  };

  const getStatusBadge = (statusCode: number) => {
    if (statusCode >= 200 && statusCode < 300) {
      return <span className="px-2 py-0.5 text-xs bg-green-100 text-green-800 rounded-full">{statusCode}</span>;
    } else if (statusCode >= 400) {
      return <span className="px-2 py-0.5 text-xs bg-red-100 text-red-800 rounded-full">{statusCode}</span>;
    } else {
      return <span className="px-2 py-0.5 text-xs bg-yellow-100 text-yellow-800 rounded-full">{statusCode}</span>;
    }
  };

  const totalPages = Math.ceil(pagination.total / pagination.pageSize);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">请求日志</h1>

      {/* 筛选栏 */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center space-x-2">
            <span className="text-sm text-gray-600">功能:</span>
            <select
              value={functionFilter}
              onChange={(e) => setFunctionFilter(e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">全部</option>
              {FUNCTIONS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center space-x-2">
            <span className="text-sm text-gray-600">Provider:</span>
            <select
              value={providerFilter}
              onChange={(e) => setProviderFilter(e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">全部</option>
              {PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center space-x-2">
            <span className="text-sm text-gray-600">状态:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | 'success' | 'failed')}
              className="border border-gray-300 rounded-md px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">全部</option>
              <option value="success">成功</option>
              <option value="failed">失败</option>
            </select>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded-lg">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-600">加载中...</div>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="min-w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">时间</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">端点</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">功能</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Provider</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">状态</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">耗时</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">API Key</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {logs.map((log) => (
                  <>
                    <tr
                      key={log.id}
                      className="hover:bg-gray-50 cursor-pointer"
                      onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}
                    >
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                        {formatDate(log.timestamp)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 max-w-xs truncate">
                        {log.endpoint}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">{log.function}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">{log.provider}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{getStatusBadge(log.statusCode)}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">{log.duration}ms</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 font-mono">
                        {log.apiKeyMasked}
                      </td>
                    </tr>
                    {expandedLog === log.id && (
                      <tr className="bg-gray-50">
                        <td colSpan={7} className="px-4 py-4">
                          <div className="space-y-2 text-sm">
                            <div>
                              <span className="font-medium text-gray-700">请求摘要:</span>
                              <span className="ml-2 text-gray-600">{log.requestSummary || '无'}</span>
                            </div>
                            <div>
                              <span className="font-medium text-gray-700">完整端点:</span>
                              <span className="ml-2 text-gray-600 font-mono">{log.endpoint}</span>
                            </div>
                            {log.errorMessage && (
                              <div>
                                <span className="font-medium text-gray-700">错误信息:</span>
                                <span className="ml-2 text-red-600">{log.errorMessage}</span>
                              </div>
                            )}
                          </div>

                          {/* 请求体面板 */}
                          {log.requestBody && (
                            <details className="mt-3">
                              <summary className="cursor-pointer font-medium text-blue-700 bg-blue-50 rounded px-3 py-1.5 hover:bg-blue-100">
                                请求体
                              </summary>
                              <pre className="mt-2 bg-white border border-blue-200 rounded p-3 text-xs text-gray-800 max-h-64 overflow-auto">
                                {JSON.stringify(log.requestBody, null, 2)}
                              </pre>
                            </details>
                          )}

                          {/* 响应体面板 */}
                          {log.responseBody && (
                            <details className="mt-3">
                              <summary className="cursor-pointer font-medium text-green-700 bg-green-50 rounded px-3 py-1.5 hover:bg-green-100">
                                响应体
                              </summary>
                              <pre className="mt-2 bg-white border border-green-200 rounded p-3 text-xs text-gray-800 max-h-64 overflow-auto">
                                {JSON.stringify(log.responseBody, null, 2)}
                              </pre>
                            </details>
                          )}

                          {/* AI API 调用列表面板 */}
                          {log.aiApiCalls && log.aiApiCalls.length > 0 && (
                            <details className="mt-3">
                              <summary className="cursor-pointer font-medium text-purple-700 bg-purple-50 rounded px-3 py-1.5 hover:bg-purple-100">
                                AI API 调用 ({log.aiApiCalls.length}次)
                              </summary>
                              <div className="mt-2 space-y-2">
                                {log.aiApiCalls.map((call: AIApiCall, idx: number) => (
                                  <div key={idx} className="bg-white border border-purple-200 rounded p-3 text-xs">
                                    <div className="flex items-center gap-3 mb-1">
                                      <span className="font-medium text-gray-800">{call.provider} / {call.model}</span>
                                      <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                                        call.status === 'success' ? 'bg-green-100 text-green-700' :
                                        call.status === 'failed' ? 'bg-red-100 text-red-700' :
                                        'bg-yellow-100 text-yellow-700'
                                      }`}>
                                        {call.status}
                                      </span>
                                    </div>
                                    <div className="text-gray-600">
                                      <span className="font-medium">端点:</span> {call.endpoint}
                                    </div>
                                    <div className="text-gray-600">
                                      <span className="font-medium">耗时:</span> {call.requestTime}ms
                                    </div>
                                    {call.tokenUsage && (
                                      <div className="text-gray-600">
                                        <span className="font-medium">Token:</span> {call.tokenUsage.total} (输入: {call.tokenUsage.prompt}, 输出: {call.tokenUsage.completion})
                                      </div>
                                    )}
                                    {call.errorMessage && (
                                      <div className="text-red-600 mt-1">
                                        <span className="font-medium">错误:</span> {call.errorMessage}
                                      </div>
                                    )}
                                    {call.pollAttempts != null && (
                                      <div className="text-gray-600">
                                        <span className="font-medium">轮询次数:</span> {call.pollAttempts}
                                      </div>
                                    )}
                                    {call.taskId && (
                                      <div className="text-gray-600">
                                        <span className="font-medium">任务ID:</span> {call.taskId}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </details>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                ))}
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-6 py-8 text-center text-gray-500">
                      暂无日志
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* 分页 */}
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-600">
              共 {pagination.total} 条，第 {pagination.page} / {totalPages} 页
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => handlePageChange(pagination.page - 1)}
                disabled={pagination.page <= 1}
                className="px-3 py-1 border border-gray-300 rounded-md text-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                上一页
              </button>
              <span className="text-sm text-gray-600">
                {pagination.page}
              </span>
              <button
                onClick={() => handlePageChange(pagination.page + 1)}
                disabled={pagination.page >= totalPages}
                className="px-3 py-1 border border-gray-300 rounded-md text-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                下一页
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
