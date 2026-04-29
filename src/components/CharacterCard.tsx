import React, { useState, useEffect } from 'react';
import { getImageDimensions, checkImageMeetsMinPixels, isLocalFilePath, exportImageFile } from '../services/fileService';

interface CharacterCardProps {
  character: {
    id: number;
    name: string;
    image: string | null;
    imagePath?: string | null;
    isGenerated: boolean;
    isMain?: boolean;
  };
  onClick: () => void;
}

const CharacterCard: React.FC<CharacterCardProps> = ({ character, onClick }) => {
  const [dimensions, setDimensions] = useState<{ width: number; height: number; pixels: number } | null>(null);

  useEffect(() => {
    if (character.imagePath && isLocalFilePath(character.imagePath)) {
      getImageDimensions(character.imagePath).then(dim => {
        setDimensions(dim);
      });
    } else {
      setDimensions(null);
    }
  }, [character.imagePath]);

  return (
    <div
      className="bg-white rounded-lg overflow-hidden card-hover cursor-pointer"
      onClick={onClick}
    >
      <div className="relative aspect-[3/4] bg-gray-100">
        {character.isGenerated && character.image ? (
          <>
            <img
              src={character.image}
              alt={character.name}
              className="w-full h-full object-cover"
            />
            {/* 图片尺寸标签 */}
            {dimensions && (
              <div className={`absolute bottom-1 right-1 px-1.5 py-0.5 rounded text-xs font-medium ${
                checkImageMeetsMinPixels(dimensions.pixels).valid 
                  ? 'bg-green-500/80 text-white' 
                  : 'bg-red-500/80 text-white'
              }`}>
                {dimensions.width}×{dimensions.height}
                {!checkImageMeetsMinPixels(dimensions.pixels).valid && (
                  <span className="ml-0.5">⚠️</span>
                )}
              </div>
            )}
            {/* 下载按钮 */}
            {character.imagePath && isLocalFilePath(character.imagePath) && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (character.imagePath) {
                    exportImageFile(character.imagePath);
                  }
                }}
                className="absolute top-1 right-1 p-1.5 bg-white/90 hover:bg-white rounded-full shadow-sm transition z-10"
                title="下载到本地"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-700" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-9.293a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" transform="rotate(180 10 10)" />
                </svg>
              </button>
            )}
          </>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-gray-400">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 mb-2" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
            </svg>
            <span className="text-xs">未生成</span>
          </div>
        )}
        {character.isMain && (
          <span className="absolute top-2 left-2 px-2 py-1 bg-primary text-white text-xs rounded">
            主角
          </span>
        )}
        {!character.isGenerated && (
          <div className="absolute inset-0 bg-black bg-opacity-0 hover:bg-opacity-10 transition flex items-center justify-center">
            <button className="opacity-0 hover:opacity-100 px-3 py-1.5 bg-white text-gray-900 rounded text-xs font-medium transition flex items-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 mr-1" viewBox="0 0 20 20" fill="currentColor">
                <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
              </svg>
              编辑提示词
            </button>
          </div>
        )}
      </div>
      <div className="p-3">
        <h3 className="font-medium text-gray-900 mb-1">{character.name}</h3>
        {!character.isGenerated ? (
          <p className="text-xs text-orange-600 flex items-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 mr-1" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            待生成
          </p>
        ) : (
          <p className="text-xs text-green-600 flex items-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 mr-1" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            已生成
          </p>
        )}
      </div>
    </div>
  );
};

export default CharacterCard;
