import React from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import Layout from './components/Layout';
import Home from './pages/Home';
import Scripts from './pages/Scripts';
import Outline from './pages/Outline';
import CharactersAndScenes from './pages/CharactersAndScenes';
import SceneCollection from './pages/SceneCollection';
import Episodes from './pages/Episodes';
import EpisodeEdit from './pages/EpisodeEdit';
import Settings from './pages/Settings';

const App: React.FC = () => {
  return (
    <AppProvider>
      <HashRouter>
        <Routes>
          <Route path="/" element={<Layout><Home /></Layout>} />
          <Route path="/scripts" element={<Layout><Scripts /></Layout>} />
          <Route path="/outline" element={<Layout><Outline /></Layout>} />
          <Route path="/characters-scenes" element={<Layout><CharactersAndScenes /></Layout>} />
          <Route path="/scene-collection/:sceneName" element={<SceneCollection />} />
          <Route path="/episodes" element={<Layout><Episodes /></Layout>} />
          <Route path="/episode/:episodeId/edit" element={<EpisodeEdit />} />
          <Route path="/settings" element={<Layout><Settings /></Layout>} />
        </Routes>
      </HashRouter>
    </AppProvider>
  );
};

export default App;
