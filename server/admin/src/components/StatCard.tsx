interface StatCardProps {
  title: string;
  total: number;
  success: number;
  failed: number;
  icon?: string;
}

export function StatCard({ title, total, success, failed, icon }: StatCardProps) {
  const successRate = total > 0 ? Math.round((success / total) * 100) : 0;

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-gray-500 text-sm font-medium">{title}</h3>
        {icon && <span className="text-2xl">{icon}</span>}
      </div>
      <div className="text-3xl font-bold text-gray-800 mb-4">{total.toLocaleString()}</div>
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center">
          <span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
          <span className="text-gray-600">成功: {success.toLocaleString()}</span>
        </div>
        <div className="flex items-center">
          <span className="w-2 h-2 bg-red-500 rounded-full mr-2"></span>
          <span className="text-gray-600">失败: {failed.toLocaleString()}</span>
        </div>
      </div>
      <div className="mt-3">
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>成功率</span>
          <span>{successRate}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-green-500 h-2 rounded-full transition-all"
            style={{ width: `${successRate}%` }}
          ></div>
        </div>
      </div>
    </div>
  );
}
