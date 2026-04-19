import React, { useState, useEffect } from 'react';
import { localPathToSrc, getImageDimensions, checkImageMeetsMinPixels, isLocalFilePath } from '../services/fileService';

interface ImageWithSizeProps {
  imagePath: string | null | undefined;
  alt: string;
  className?: string;
  showSize?: boolean;
  onClick?: () => void;
}

const ImageWithSize: React.FC<ImageWithSizeProps> = ({
  imagePath,
  alt,
  className = '',
  showSize = true,
  onClick
}) => {
  const [dimensions, setDimensions] = useState<{ width: number; height: number; pixels: number } | null>(null);

  useEffect(() => {
    if (imagePath && isLocalFilePath(imagePath)) {
      getImageDimensions(imagePath).then(dim => {
        setDimensions(dim);
      });
    } else {
      setDimensions(null);
    }
  }, [imagePath]);

  const imageSrc = localPathToSrc(imagePath);
  
  if (!imageSrc) {
    return null;
  }

  const pixelCheck = dimensions ? checkImageMeetsMinPixels(dimensions.pixels) : null;

  return (
    <div className="relative inline-block">
      <img
        src={imageSrc}
        alt={alt}
        className={className}
        onClick={onClick}
      />
      {showSize && dimensions && (
        <div className={`absolute bottom-1 right-1 px-1.5 py-0.5 rounded text-xs font-medium ${
          pixelCheck?.valid 
            ? 'bg-green-500/80 text-white' 
            : 'bg-red-500/80 text-white'
        }`}>
          {dimensions.width}×{dimensions.height}
          {!pixelCheck?.valid && (
            <span className="ml-1">⚠️</span>
          )}
        </div>
      )}
    </div>
  );
};

export default ImageWithSize;
