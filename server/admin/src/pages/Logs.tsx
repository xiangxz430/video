import { Fragment, useEffect, useState, useCallback } from 'react';
import { api, RequestLog, QueryLogsResult, AIApiCall } from '../services/api';

const FUNCTIONS = ['script', 'storyboard', 'image', 'video'];
const PROVIDERS = ['deepseek', 'volcengine', 'grsai', 'openrouter', 'idealab', 'qwen'];

// 详情缓存：id -> 完整日志数据
const detailCache = new Map<string, RequestLog>();

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

  // 详情加载状态：id -> 'loading' | 'loaded' | 'error'
  const [detailState, setDetailState] = useState<Record<string, 'loading' | 'loaded' | 'error'>>({});
  // 已加载的详情数据：id -> RequestLog
  const [detailData, setDetailData] = useState<Record<string, RequestLog>>({});
  // 删除状态：id -> 'deleting' | 'error'
  const [deleteState, setDeleteState] = useState<Record<string, 'deleting' | 'error'>>({});

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

  // 懒加载日志详情
  const loadLogDetail = useCallback(async (logId: string) => {
    // 已缓存则跳过
    if (detailCache.has(logId)) {
      setDetailData(prev => ({ ...prev, [logId]: detailCache.get(logId)! }));
      setDetailState(prev => ({ ...prev, [logId]: 'loaded' }));
      return;
    }
    // 已在加载中则跳过
    if (detailState[logId] === 'loading') return;

    setDetailState(prev => ({ ...prev, [logId]: 'loading' }));
    try {
      const detail = await api.getLogDetail(logId);
      detailCache.set(logId, detail);
      setDetailData(prev => ({ ...prev, [logId]: detail }));
      setDetailState(prev => ({ ...prev, [logId]: 'loaded' }));
    } catch {
      setDetailState(prev => ({ ...prev, [logId]: 'error' }));
    }
  }, [detailState]);

  const handleToggleExpand = (logId: string) => {
    if (expandedLog === logId) {
      setExpandedLog(null);
    } else {
      setExpandedLog(logId);
      // 展开时触发懒加载
      loadLogDetail(logId);
    }
  };

  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > Math.ceil(pagination.total / pagination.pageSize)) return;
    fetchLogs(newPage);
  };

  const handleDeleteLog = async (logId: string) => {
    if (!window.confirm('确定要删除这条日志吗？此操作不可撤销。')) return;

    setDeleteState(prev => ({ ...prev, [logId]: 'deleting' }));
    try {
      await api.deleteLog(logId);
      // 清除缓存
      detailCache.delete(logId);
      setDetailData(prev => {
        const next = { ...prev };
        delete next[logId];
        return next;
      });
      setDetailState(prev => {
        const next = { ...prev };
        delete next[logId];
        return next;
      });
      // 从列表移除并更新 total
      setLogs(prev => prev.filter(l => l.id !== logId));
      setPagination(prev => ({ ...prev, total: prev.total - 1 }));
      setDeleteState(prev => {
        const next = { ...prev };
        delete next[logId];
        return next;
      });
    } catch {
      setDeleteState(prev => ({ ...prev, [logId]: 'error' }));
    }
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
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {logs.map((log) => (
                  <Fragment key={log.id}>
                    <tr
                      className="hover:bg-gray-50 cursor-pointer"
                      onClick={() => handleToggleExpand(log.id)}
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
                      <td className="px-4 py-3 whitespace-nowrap text-sm" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => handleDeleteLog(log.id)}
                          disabled={deleteState[log.id] === 'deleting'}
                          className="inline-flex items-center gap-1 text-red-600 hover:text-red-800 hover:bg-red-50 px-2 py-1 rounded text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          title="删除此日志"
                        >
                          {deleteState[log.id] === 'deleting' ? (
                            <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                          ) : (
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          )}
                          删除
                        </button>
                        {deleteState[log.id] === 'error' && (
                          <span className="ml-1 text-xs text-red-500">失败</span>
                        )}
                      </td>
                    </tr>
                    {expandedLog === log.id && (
                      <tr className="bg-gray-50">
                        <td colSpan={8} className="px-4 py-4">
                          {detailState[log.id] === 'loading' && (
                            <div className="flex items-center gap-2 text-sm text-gray-500">
                              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                              </svg>
                              加载详情中...
                            </div>
                          )}
                          {detailState[log.id] === 'error' && (
                            <div className="text-sm text-red-600">
                              加载详情失败，请重试
                              <button
                                className="ml-2 text-blue-600 underline"
                                onClick={(e) => { e.stopPropagation(); loadLogDetail(log.id); }}
                              >
                                重试
                              </button>
                            </div>
                          )}
                          {detailState[log.id] === 'loaded' && (() => {
                            const detail = detailData[log.id];
                            if (!detail) return null;
                            return (
                              <div className="space-y-2 text-sm">
                                <div>
                                  <span className="font-medium text-gray-700">请求摘要:</span>
                                  <span className="ml-2 text-gray-600">{detail.requestSummary || '无'}</span>
                                </div>
                                <div>
                                  <span className="font-medium text-gray-700">完整端点:</span>
                                  <span className="ml-2 text-gray-600 font-mono">{detail.endpoint}</span>
                                </div>
                                {detail.errorMessage && (
                                  <div>
                                    <span className="font-medium text-gray-700">错误信息:</span>
                                    <span className="ml-2 text-red-600">{detail.errorMessage}</span>
                                  </div>
                                )}

                                {/* 请求体面板 */}
                                {detail.requestBody && (
                                  <details className="mt-3">
                                    <summary className="cursor-pointer font-medium text-blue-700 bg-blue-50 rounded px-3 py-1.5 hover:bg-blue-100">
                                      请求体
                                    </summary>
                                    <pre className="mt-2 bg-white border border-blue-200 rounded p-3 text-xs text-gray-800 max-h-64 overflow-auto">
                                      {JSON.stringify(detail.requestBody, null, 2)}
                                    </pre>
                                  </details>
                                )}

                                {/* 响应体面板 */}
                                {detail.responseBody && (
                                  <details className="mt-3">
                                    <summary className="cursor-pointer font-medium text-green-700 bg-green-50 rounded px-3 py-1.5 hover:bg-green-100">
                                      响应体
                                    </summary>
                                    <pre className="mt-2 bg-white border border-green-200 rounded p-3 text-xs text-gray-800 max-h-64 overflow-auto">
                                      {JSON.stringify(detail.responseBody, null, 2)}
                                    </pre>
                                  </details>
                                )}

                                {/* AI API 调用列表面板 */}
                                {detail.aiApiCalls && detail.aiApiCalls.length > 0 && (
                                  <details className="mt-3">
                                    <summary className="cursor-pointer font-medium text-purple-700 bg-purple-50 rounded px-3 py-1.5 hover:bg-purple-100">
                                      AI API 调用 ({detail.aiApiCalls.length}次)
                                    </summary>
                                    <div className="mt-2 space-y-2">
                                      {detail.aiApiCalls.map((call: AIApiCall, idx: number) => (
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
                              </div>
                            );
                          })()}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-6 py-8 text-center text-gray-500">
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
