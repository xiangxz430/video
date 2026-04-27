import { useEffect, useState } from 'react';
import { api, OverviewStats, SystemInfo } from '../services/api';
import { StatCard } from '../components/StatCard';

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}天`);
  if (hours > 0) parts.push(`${hours}小时`);
  if (minutes > 0) parts.push(`${minutes}分钟`);
  return parts.length > 0 ? parts.join('') : '0分钟';
}

export function Dashboard() {
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [overviewData, systemData] = await Promise.all([
          api.getOverview(),
          api.getSystemInfo(),
        ]);
        setStats(overviewData);
        setSystemInfo(systemData);
      } catch (err) {
        setError(err instanceof Error ? err.message : '获取数据失败');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-600">加载中...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 text-red-600 p-4 rounded-lg">
        {error}
      </div>
    );
  }

  if (!stats || !systemInfo) {
    return (
      <div className="text-gray-600">暂无数据</div>
    );
  }

  const functionEntries = Object.entries(stats.byFunction).sort((a, b) => b[1] - a[1]);
  const providerEntries = Object.entries(stats.byProvider).sort((a, b) => b[1] - a[1]);
  const totalFunctionCalls = functionEntries.reduce((sum, [, count]) => sum + count, 0);
  const totalProviderCalls = providerEntries.reduce((sum, [, count]) => sum + count, 0);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">仪表盘</h1>

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard
          title="今日调用"
          total={stats.today.total}
          success={stats.today.success}
          failed={stats.today.failed}
          icon="📅"
        />
        <StatCard
          title="本周调用"
          total={stats.thisWeek.total}
          success={stats.thisWeek.success}
          failed={stats.thisWeek.failed}
          icon="📆"
        />
        <StatCard
          title="本月调用"
          total={stats.thisMonth.total}
          success={stats.thisMonth.success}
          failed={stats.thisMonth.failed}
          icon="🗓️"
        />
      </div>

      {/* 功能占比和 Provider 占比 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">按功能调用占比</h2>
          {functionEntries.length === 0 ? (
            <p className="text-gray-500 text-center py-8">暂无数据</p>
          ) : (
            <div className="space-y-3">
              {functionEntries.map(([func, count]) => {
                const percentage = totalFunctionCalls > 0 ? (count / totalFunctionCalls) * 100 : 0;
                return (
                  <div key={func}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-700">{func}</span>
                      <span className="text-gray-500">{count} ({percentage.toFixed(1)}%)</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-blue-500 h-2 rounded-full transition-all"
                        style={{ width: `${percentage}%` }}
                      ></div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">按 Provider 调用占比</h2>
          {providerEntries.length === 0 ? (
            <p className="text-gray-500 text-center py-8">暂无数据</p>
          ) : (
            <div className="space-y-3">
              {providerEntries.map(([provider, count]) => {
                const percentage = totalProviderCalls > 0 ? (count / totalProviderCalls) * 100 : 0;
                return (
                  <div key={provider}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-700">{provider}</span>
                      <span className="text-gray-500">{count} ({percentage.toFixed(1)}%)</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-purple-500 h-2 rounded-full transition-all"
                        style={{ width: `${percentage}%` }}
                      ></div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 系统信息 */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">系统信息</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="p-4 bg-gray-50 rounded-lg">
            <p className="text-sm text-gray-500 mb-1">运行时长</p>
            <p className="text-lg font-semibold text-gray-800">{formatUptime(systemInfo.uptime)}</p>
          </div>
          <div className="p-4 bg-gray-50 rounded-lg">
            <p className="text-sm text-gray-500 mb-1">内存使用</p>
            <p className="text-lg font-semibold text-gray-800">{systemInfo.memoryUsage.rss} MB</p>
          </div>
          <div className="p-4 bg-gray-50 rounded-lg">
            <p className="text-sm text-gray-500 mb-1">Node 版本</p>
            <p className="text-lg font-semibold text-gray-800">{systemInfo.nodeVersion}</p>
          </div>
          <div className="p-4 bg-gray-50 rounded-lg">
            <p className="text-sm text-gray-500 mb-1">平台</p>
            <p className="text-lg font-semibold text-gray-800">{systemInfo.platform}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
