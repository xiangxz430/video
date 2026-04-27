import { useState, useEffect } from 'react';
import { api } from '../services/api';

interface LoginGuardProps {
  children: React.ReactNode;
}

export function LoginGuard({ children }: LoginGuardProps) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [key, setKey] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const storedKey = localStorage.getItem('admin_key');
    if (storedKey) {
      api.verifyKey(storedKey).then(valid => {
        if (valid) {
          setIsAuthenticated(true);
        } else {
          localStorage.removeItem('admin_key');
        }
        setIsLoading(false);
      });
    } else {
      setIsLoading(false);
    }
  }, []);

  const handleLogin = async () => {
    if (!key.trim()) {
      setError('请输入 Admin Key');
      return;
    }
    setError('');
    const valid = await api.verifyKey(key.trim());
    if (valid) {
      localStorage.setItem('admin_key', key.trim());
      setIsAuthenticated(true);
    } else {
      setError('Admin Key 无效');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleLogin();
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-600">加载中...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="bg-white rounded-lg shadow-lg p-8 w-full max-w-md">
          <h1 className="text-2xl font-bold text-gray-800 mb-2 text-center">Video Server</h1>
          <p className="text-gray-500 text-center mb-6">管理后台登录</p>
          
          {error && (
            <div className="bg-red-50 text-red-600 px-4 py-2 rounded mb-4 text-sm">
              {error}
            </div>
          )}
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Admin Key
              </label>
              <input
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                onKeyDown={handleKeyDown}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="请输入 Admin Key"
              />
            </div>
            <button
              onClick={handleLogin}
              className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 transition-colors font-medium"
            >
              登录
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
