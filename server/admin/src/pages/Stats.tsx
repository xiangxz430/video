import { useEffect, useState } from 'react';
import { api, TimeStats, KeyStats, KeyDetailStats, FunctionStats, ProviderStats, ModelStats } from '../services/api';

type TabType = 'time' | 'key' | 'function' | 'provider' | 'model';

export function Stats() {
  const [activeTab, setActiveTab] = useState<TabType>('time');
  const [timeRange, setTimeRange] = useState<'day' | 'week' | 'month'>('day');
  const [timeStats, setTimeStats] = useState<TimeStats | null>(null);
  const [keyStats, setKeyStats] = useState<KeyStats[]>([]);
  const [keyDetailStats, setKeyDetailStats] = useState<KeyDetailStats[]>([]);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [expandedModel, setExpandedModel] = useState<string | null>(null);
  const [functionStats, setFunctionStats] = useState<Record<string, FunctionStats>>({});
  const [providerStats, setProviderStats] = useState<Record<string, ProviderStats>>({});
  const [modelStats, setModelStats] = useState<Record<string, ModelStats>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError('');

        switch (activeTab) {
          case 'time':
            const timeData = await api.getStatsByTime(timeRange);
            setTimeStats(timeData);
            break;
          case 'key':
            const [keyData, keyDetailData] = await Promise.all([
              api.getStatsByKey(),
              api.getStatsByKeyDetail(),
            ]);
            setKeyStats(keyData);
            setKeyDetailStats(keyDetailData);
            break;
          case 'function':
            const funcData = await api.getStatsByFunction();
            setFunctionStats(funcData);
            break;
          case 'provider':
            const provData = await api.getStatsByProvider();
            setProviderStats(provData);
            break;
          case 'model':
            const modelData = await api.getStatsByModel();
            setModelStats(modelData);
            break;
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '获取数据失败');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [activeTab, timeRange]);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '从未';
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN');
  };

  const tabs = [
    { id: 'time' as TabType, label: '按时间' },
    { id: 'key' as TabType, label: '按 Key' },
    { id: 'function' as TabType, label: '按功能' },
    { id: 'provider' as TabType, label: '按 Provider' },
    { id: 'model' as TabType, label: '按模型' },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">用量统计</h1>

      {/* Tab 切换 */}
      <div className="border-b border-gray-200">
        <nav className="flex space-x-8">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
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
          {/* 按时间 */}
          {activeTab === 'time' && (
            <div className="space-y-4">
              <div className="flex items-center space-x-2">
                <span className="text-sm text-gray-600">时间范围:</span>
                <select
                  value={timeRange}
                  onChange={(e) => setTimeRange(e.target.value as 'day' | 'week' | 'month')}
                  className="border border-gray-300 rounded-md px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="day">日</option>
                  <option value="week">周</option>
                  <option value="month">月</option>
                </select>
              </div>
              <div className="bg-white rounded-lg shadow overflow-hidden">
                <table className="min-w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">时间段</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">调用次数</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {timeStats?.labels.map((label, index) => (
                      <tr key={label} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{label}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{timeStats.data[index]}</td>
                      </tr>
                    ))}
                    {(!timeStats || timeStats.labels.length === 0) && (
                      <tr>
                        <td colSpan={2} className="px-6 py-8 text-center text-gray-500">暂无数据</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 按 Key - 详细视图 */}
          {activeTab === 'key' && (
            <div className="space-y-4">
              {/* 合计费用 */}
              {keyDetailStats.length > 0 && (
                <div className="bg-gradient-to-r from-yellow-50 to-orange-50 rounded-lg p-4 border border-yellow-200">
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-yellow-700 font-medium">所有 Key 合计估计费用</div>
                    <div className="text-2xl font-bold text-orange-700">
                      ${keyDetailStats.reduce((sum, k) => sum + k.totalCost, 0).toFixed(4)}
                    </div>
                  </div>
                </div>
              )}

              {keyDetailStats.map((keyDetail) => {
                const isExpanded = expandedKey === keyDetail.keyId;
                return (
                  <div key={keyDetail.keyId} className="bg-white rounded-lg shadow overflow-hidden">
                    {/* Key 头部 */}
                    <div
                      className="px-6 py-4 flex items-center justify-between cursor-pointer hover:bg-gray-50 transition"
                      onClick={() => setExpandedKey(isExpanded ? null : keyDetail.keyId)}
                    >
                      <div className="flex items-center space-x-4">
                        <svg
                          className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                          fill="none" viewBox="0 0 24 24" stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                        <div>
                          <div className="text-sm font-semibold text-gray-900">{keyDetail.keyName}</div>
                          <div className="text-xs text-gray-500 font-mono">{keyDetail.maskedKey}</div>
                        </div>
                      </div>
                      <div className="flex items-center space-x-6">
                        <div className="text-right">
                          <div className="text-sm text-gray-500">调用次数</div>
                          <div className="text-lg font-semibold text-gray-900">{keyDetail.totalCalls}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm text-gray-500">估计费用</div>
                          <div className="text-lg font-semibold text-orange-600">${keyDetail.totalCost.toFixed(4)}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm text-gray-500">最后使用</div>
                          <div className="text-sm text-gray-500">{formatDate(keyDetail.lastUsedAt)}</div>
                        </div>
                      </div>
                    </div>

                    {/* 展开：按模型细分 */}
                    {isExpanded && keyDetail.models.length > 0 && (
                      <div className="border-t border-gray-100">
                        <table className="min-w-full">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Provider</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Model</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">调用</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">成功</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">失败</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">成功率</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">估计费用</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200">
                            {keyDetail.models.map((model) => {
                              const modelExpandKey = `${keyDetail.keyId}-${model.provider}-${model.model}`;
                              const isModelExpanded = expandedModel === modelExpandKey;
                              const successRate = model.total > 0 ? (model.success / model.total * 100).toFixed(1) + '%' : '-';
                              return (
                                <>
                                  <tr
                                    key={modelExpandKey}
                                    className="hover:bg-blue-50 cursor-pointer transition"
                                    onClick={() => setExpandedModel(isModelExpanded ? null : modelExpandKey)}
                                  >
                                    <td className="px-6 py-3 text-sm text-gray-900">{model.displayProvider}</td>
                                    <td className="px-6 py-3 text-sm font-mono text-gray-700">
                                      <span className="flex items-center space-x-1">
                                        <svg className={`w-3 h-3 text-gray-400 transition-transform ${isModelExpanded ? 'rotate-90' : ''}`}
                                          fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                        </svg>
                                        <span>{model.displayModel}</span>
                                      </span>
                                    </td>
                                    <td className="px-6 py-3 text-sm text-gray-900">{model.total}</td>
                                    <td className="px-6 py-3 text-sm text-green-600">{model.success}</td>
                                    <td className="px-6 py-3 text-sm text-red-600">{model.failed}</td>
                                    <td className="px-6 py-3 text-sm text-gray-500">{successRate}</td>
                                    <td className="px-6 py-3 text-sm font-semibold text-orange-600">${model.estimatedCost.toFixed(4)}</td>
                                  </tr>
                                  {/* 展开：按功能细分 */}
                                  {isModelExpanded && (
                                    <tr key={`${modelExpandKey}-func`}>
                                      <td colSpan={7} className="px-6 py-3 bg-blue-50">
                                        <div className="text-xs font-medium text-gray-700 mb-2">按功能细分：</div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                                          {Object.entries(model.byFunction).map(([func, fStats]) => (
                                            <div key={func} className="bg-white rounded p-3 border border-gray-200">
                                              <div className="text-xs font-semibold text-gray-900 capitalize mb-1">{func}</div>
                                              <div className="flex items-center justify-between text-xs">
                                                <span className="text-gray-500">调用: {fStats.total}</span>
                                                <span className="text-green-600">成功: {fStats.success}</span>
                                                <span className="text-red-600">失败: {fStats.failed}</span>
                                              </div>
                                              <div className="text-xs text-orange-600 mt-1 font-semibold">
                                                费用: ${fStats.estimatedCost.toFixed(4)}
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      </td>
                                    </tr>
                                  )}
                                </>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {isExpanded && keyDetail.models.length === 0 && (
                      <div className="px-6 py-8 text-center text-gray-500 border-t border-gray-100">暂无调用记录</div>
                    )}
                  </div>
                );
              })}

              {keyStats.length === 0 && (
                <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">暂无数据</div>
              )}
            </div>
          )}

          {/* 按功能 */}
          {activeTab === 'function' && (
            <div className="bg-white rounded-lg shadow overflow-hidden">
              <table className="min-w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">功能</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">总调用</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">成功</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">失败</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">平均耗时(ms)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {Object.entries(functionStats).map(([func, stats], index) => (
                    <tr key={func} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{func}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{stats.total}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-green-600">{stats.success}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-red-600">{stats.failed}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{stats.avgDuration}</td>
                    </tr>
                  ))}
                  {Object.keys(functionStats).length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-6 py-8 text-center text-gray-500">暂无数据</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* 按 Provider */}
          {activeTab === 'provider' && (
            <div className="bg-white rounded-lg shadow overflow-hidden">
              <table className="min-w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Provider</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">总调用</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">成功</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">失败</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">平均耗时(ms)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {Object.entries(providerStats).map(([provider, stats], index) => (
                    <tr key={provider} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{provider}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{stats.total}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-green-600">{stats.success}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-red-600">{stats.failed}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{stats.avgDuration}</td>
                    </tr>
                  ))}
                  {Object.keys(providerStats).length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-6 py-8 text-center text-gray-500">暂无数据</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* 按模型 */}
          {activeTab === 'model' && (
            <div className="bg-white rounded-lg shadow overflow-hidden">
              <table className="min-w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Provider</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Model</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">调用次数</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">成功</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">失败</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">成功率</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">平均耗时(ms)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {Object.entries(modelStats).map(([key, stats], index) => (
                    <tr key={key} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{stats.provider}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{stats.model}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{stats.total}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-green-600">{stats.success}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-red-600">{stats.failed}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {stats.total > 0 ? (stats.success / stats.total * 100).toFixed(1) + '%' : '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{stats.avgDuration}</td>
                    </tr>
                  ))}
                  {Object.keys(modelStats).length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-6 py-8 text-center text-gray-500">暂无数据</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
