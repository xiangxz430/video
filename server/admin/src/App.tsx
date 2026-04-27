import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { LoginGuard } from './components/LoginGuard';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { ApiKeys } from './pages/ApiKeys';
import { Stats } from './pages/Stats';
import { Config } from './pages/Config';
import { Logs } from './pages/Logs';

function App() {
  return (
    <BrowserRouter basename="/admin">
      <LoginGuard>
        <Layout>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/api-keys" element={<ApiKeys />} />
            <Route path="/stats" element={<Stats />} />
            <Route path="/config" element={<Config />} />
            <Route path="/logs" element={<Logs />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      </LoginGuard>
    </BrowserRouter>
  );
}

export default App;
