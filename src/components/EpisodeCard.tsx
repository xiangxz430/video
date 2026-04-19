import React from 'react';
import { useNavigate } from 'react-router-dom';

interface EpisodeCardProps {
  episode: {
    id: number;
    episodeNumber: number;
    title: string;
    characterCount: number;
    sceneCount: number;
    shotCount?: number;
    duration: number | null;
    status: 'complete' | 'incomplete' | 'missing';
    message?: string;
    hasScript?: boolean;
  };
  onGenerateScript?: (episodeId: number) => void;
  onRegenerateScript?: (episodeId: number) => void;
}

const EpisodeCard: React.FC<EpisodeCardProps> = ({ episode, onGenerateScript, onRegenerateScript }) => {
  const navigate = useNavigate();

  const getStatusColor = () => {
    switch (episode.status) {
      case 'complete':
        return 'bg-purple-50';
      case 'incomplete':
        return 'bg-purple-50';
      case 'missing':
        return 'bg-gray-50';
      default:
        return 'bg-white';
    }
  };

  const getThumbnail = () => {
    if (episode.status === 'missing') {
      return (
        <div className="w-32 h-32 bg-gray-200 rounded-lg flex items-center justify-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm3 2h6v4H7V5zm8 8v2h1v1H4v-1h1v-2a1 1 0 011-1h8a1 1 0 011 1z" clipRule="evenodd" />
          </svg>
        </div>
      );
    }
    return (
      <div className="w-32 h-32 bg-purple-200 rounded-lg flex items-center justify-center">
        <div className="text-center">
          <div className="text-purple-400 mb-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 mx-auto" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
            </svg>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className={`${getStatusColor()} rounded-lg p-6 border border-gray-200`}>
      <div className="flex items-start space-x-4">
        <div className="flex-shrink-0 text-2xl font-bold text-gray-400">
          {episode.episodeNumber}
        </div>

        {getThumbnail()}

        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            第 {episode.episodeNumber} 集：{episode.title}
          </h3>

          <div className="flex items-center space-x-4 text-sm text-gray-500 mb-3">
            <span className="flex items-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 mr-1" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
              </svg>
              {episode.characterCount} 角色
            </span>
            <span className="flex items-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 mr-1" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
              </svg>
              {episode.sceneCount} 场景
            </span>
            {episode.shotCount != null && episode.shotCount > 0 && (
              <span className="flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 mr-1" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm3 2h6v4H7V5zm8 8v2h1v1H4v-1h1v-2a1 1 0 011-1h8a1 1 0 011 1z" clipRule="evenodd" />
                </svg>
                {episode.shotCount} 分镜
              </span>
            )}
            {episode.duration && (
              <span className="flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 mr-1" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                </svg>
                {episode.duration} 分钟
              </span>
            )}
          </div>

          {episode.message && (
            <div className="flex items-center space-x-2 mb-3">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-orange-500" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <span className="text-sm text-orange-600">{episode.message}</span>
            </div>
          )}

          <div className="flex items-center space-x-3">
            {!episode.hasScript ? (
              <button
                onClick={() => onGenerateScript?.(episode.id)}
                className="px-4 py-2 bg-black text-white text-sm rounded-lg hover:bg-gray-800 transition flex items-center space-x-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M5 2a1 1 0 011 1v1h1a1 1 0 010 2H6v1a1 1 0 01-2 0V6H3a1 1 0 010-2h1V3a1 1 0 011-1zm0 10a1 1 0 011 1v1h1a1 1 0 110 2H6v1a1 1 0 11-2 0v-1H3a1 1 0 110-2h1v-1a1 1 0 011-1zM12 2a1 1 0 01.967.744L14.146 7.2 17.5 9.134a1 1 0 010 1.732l-3.354 1.935-1.18 4.455a1 1 0 01-1.933 0L9.854 12.8 6.5 10.866a1 1 0 010-1.732l3.354-1.935 1.18-4.455A1 1 0 0112 2z" clipRule="evenodd" />
                </svg>
                <span>生成分镜脚本</span>
              </button>
            ) : (
              <>
                <button
                  onClick={() => navigate(`/episode/${episode.id}/edit`)}
                  className="px-4 py-2 text-gray-700 border border-gray-300 text-sm rounded-lg hover:bg-white transition flex items-center space-x-2"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                  </svg>
                  <span>编辑</span>
                </button>
                <button
                  onClick={() => onRegenerateScript?.(episode.id)}
                  className="px-4 py-2 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 transition flex items-center space-x-2"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                  </svg>
                  <span>重新生成</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default EpisodeCard;
