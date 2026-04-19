import React, { useState, useRef } from 'react';

interface SegmentTimelineProps {
  segments: any[];
  selectedSegment: number;
  onSelectSegment: (id: number) => void;
  onGenerate: (segmentId: number) => void;
  onRetry: (segmentId: number) => void;
  onReorder?: (fromIndex: number, toIndex: number) => void;
}

const SegmentTimeline: React.FC<SegmentTimelineProps> = ({
  segments,
  selectedSegment,
  onSelectSegment,
  onGenerate,
  onRetry,
  onReorder
}) => {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [selectedSegments, setSelectedSegments] = useState<number[]>([]);
  const dragRef = useRef<{ fromIndex: number } | null>(null);
  
  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDragIndex(index);
    dragRef.current = { fromIndex: index };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
  };
  
  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(index);
  };
  
  const handleDragLeave = () => {
    setDragOverIndex(null);
  };
  
  const handleDrop = (e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    const fromIndex = dragRef.current?.fromIndex;
    
    if (fromIndex !== undefined && fromIndex !== toIndex && onReorder) {
      onReorder(fromIndex, toIndex);
    }
    
    setDragIndex(null);
    setDragOverIndex(null);
    dragRef.current = null;
  };
  
  const handleDragEnd = () => {
    setDragIndex(null);
    setDragOverIndex(null);
    dragRef.current = null;
  };
  
  const handleMultiSelect = (segmentId: number) => {
    if (selectedSegments.includes(segmentId)) {
      setSelectedSegments(prev => prev.filter(id => id !== segmentId));
    } else {
      setSelectedSegments(prev => [...prev, segmentId]);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'generating':
        return (
          <svg className="animate-spin h-4 w-4 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
        );
      case 'generated':
        return (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-green-500" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
        );
      case 'failed':
        return (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-orange-500" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
        );
      default:
        return null;
    }
  };

  const getStatusText = (segment: any) => {
    switch (segment.status) {
      case 'generating':
        return '生成中';
      case 'generated':
        return '生成';
      case 'failed':
        return segment.error || '生成失败';
      default:
        return '待生成';
    }
  };

  return (
    <div className="bg-white border-t border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-4">
          <button className="p-2 text-gray-600 hover:bg-gray-100 rounded transition">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
            </svg>
          </button>
          <span className="text-sm text-gray-600">00:00 / 00:00</span>
        </div>
        <div className="flex items-center space-x-2">
          {isMultiSelectMode && selectedSegments.length > 0 && (
            <span className="text-sm text-blue-600">已选择 {selectedSegments.length} 个</span>
          )}
          <button 
            onClick={() => setIsMultiSelectMode(!isMultiSelectMode)}
            className={`text-sm px-3 py-1 rounded transition ${
              isMultiSelectMode 
                ? 'bg-blue-100 text-blue-700' 
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
            }`}
          >
            {isMultiSelectMode ? '取消多选' : '多选'}
          </button>
        </div>
      </div>

      <div className="flex items-stretch space-x-4">
        {segments.map((segment, index) => (
          <div
            key={segment.id}
            draggable={!isMultiSelectMode}
            onDragStart={(e) => handleDragStart(e, index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, index)}
            onDragEnd={handleDragEnd}
            onClick={() => isMultiSelectMode ? handleMultiSelect(segment.id) : onSelectSegment(segment.id)}
            className={`flex-1 min-w-0 border-2 rounded-lg p-4 cursor-pointer transition ${
              selectedSegment === segment.id
                ? 'border-gray-900 bg-gray-50'
                : 'border-gray-200 hover:border-gray-300'
            } ${
              dragIndex === index ? 'opacity-50' : ''
            } ${
              dragOverIndex === index ? 'border-blue-400 bg-blue-50' : ''
            } ${
              isMultiSelectMode && selectedSegments.includes(segment.id) 
                ? 'ring-2 ring-blue-500 bg-blue-50' 
                : ''
            }`}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center space-x-2">
                {isMultiSelectMode && (
                  <div className={`w-5 h-5 rounded border flex items-center justify-center ${
                    selectedSegments.includes(segment.id)
                      ? 'bg-blue-500 border-blue-500'
                      : 'border-gray-300'
                  }`}>
                    {selectedSegments.includes(segment.id) && (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-white" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </div>
                )}
                <span className="w-6 h-6 flex items-center justify-center bg-gray-200 text-gray-600 rounded-full text-xs font-medium">
                  {index + 1}
                </span>
              </div>
              {!isMultiSelectMode && (
                <div className="cursor-grab active:cursor-grabbing" title="拖拽排序">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M7 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 2zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 14zm6-8a2 2 0 1 0-.001-4.001A2 2 0 0 0 13 6zm0 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 14z" />
                  </svg>
                </div>
              )}
              {!isMultiSelectMode && getStatusIcon(segment.status)}
            </div>

            <div className="text-center">
              {segment.status === 'failed' ? (
                <>
                  <div className="flex items-center justify-center space-x-2 text-orange-600 mb-2">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    <span className="text-sm">{segment.error || '生成失败'}</span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRetry(segment.id);
                    }}
                    className="px-3 py-1.5 bg-gray-200 text-gray-600 rounded text-xs hover:bg-gray-300 transition flex items-center space-x-1 mx-auto"
                  >
                    <span>重试</span>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                    </svg>
                  </button>
                </>
              ) : segment.status === 'pending' ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onGenerate(segment.id);
                  }}
                  className="px-3 py-1.5 bg-black text-white rounded text-xs hover:bg-gray-800 transition flex items-center space-x-1 mx-auto"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                  </svg>
                  <span>生成</span>
                </button>
              ) : (
                <div className="flex items-center justify-center space-x-2">
                  {segment.status === 'generated' ? (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-green-500" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                    </svg>
                  )}
                  <span className="text-sm text-gray-700">{getStatusText(segment)}</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default SegmentTimeline;
