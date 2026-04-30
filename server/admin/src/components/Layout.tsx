import { NavLink, useLocation } from 'react-router-dom';

interface LayoutProps {
  children: React.ReactNode;
}

const navItems = [
  { path: '/', label: '仪表盘', icon: '📊' },
  { path: '/api-keys', label: 'API Key', icon: '🔑' },
  { path: '/stats', label: '用量统计', icon: '📈' },
  { path: '/config', label: 'AI 配置', icon: '⚙️' },
  { path: '/logs', label: '请求日志', icon: '📋' },
];

export function Layout({ children }: LayoutProps) {
  const location = useLocation();

  const handleLogout = () => {
    localStorage.removeItem('admin_key');
    window.location.reload();
  };

  return (
    <div className="min-h-screen flex">
      {/* 侧边栏 */}
      <aside className="w-60 bg-gray-900 text-white flex flex-col fixed h-full">
        <div className="p-4 border-b border-gray-800">
          <h1 className="text-lg font-bold">Video Server</h1>
          <p className="text-xs text-gray-400 mt-1">管理后台</p>
        </div>
        
        <nav className="flex-1 py-4">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `flex items-center px-4 py-3 text-sm transition-colors ${
                  isActive || (item.path === '/' && location.pathname === '/admin/')
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                }`
              }
            >
              <span className="mr-3">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        
        <div className="p-4 border-t border-gray-800">
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center px-4 py-2 text-sm text-gray-300 hover:text-white hover:bg-gray-800 rounded transition-colors"
          >
            <span className="mr-2">🚪</span>
            退出登录
          </button>
          <div className="mt-3 text-center text-xs text-gray-500">
            <div>{__BUILD_VERSION__}</div>
            <div className="mt-0.5">{__BUILD_TIME__}</div>
          </div>
        </div>
      </aside>

      {/* 主内容区 */}
      <main className="flex-1 ml-60 bg-gray-50 min-h-screen">
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
