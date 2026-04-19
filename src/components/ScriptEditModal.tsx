import React, { useState } from 'react';

interface Shot {
  duration: number;
  description: string;
  characters: string[];
  scene: string;
  shotType?: string;
  cameraMovement?: string;
  audio?: string;
  notes?: string;
  // 首帧补充提示词
  firstFramePrompt?: string;
  // 尾帧补充提示词
  lastFramePrompt?: string;
  // 首帧参考图本地路径
  firstFrameRefImage?: string;
  // 尾帧参考图本地路径
  lastFrameRefImage?: string;
  // 首帧参考模式：'only-ref' 只看参考图，'ref-with-scene-char' 同时参考角色和场景
  firstFrameRefMode?: 'only-ref' | 'ref-with-scene-char';
  // 尾帧参考模式：'only-ref' 只看参考图，'ref-with-scene-char' 同时参考角色和场景
  lastFrameRefMode?: 'only-ref' | 'ref-with-scene-char';
  // 参考图列表（参考图模式）
  referenceImages?: string[];
  // 视频生成历史记录
  videoHistory?: Array<{
    id: string;
    videoUrl: string;
    localVideoPath?: string;
    generatedAt: string;
    duration?: number;
  }>;
}

interface Segment {
  scene: string;
  description: string;
  shots: Shot[];
}

interface ScriptEditModalProps {
  segment: Segment;
  onClose: () => void;
  onSave: (updatedSegment: Segment) => void;
}

const SHOT_TYPES = ['特写', '近景', '中景', '全景', '远景', '大远景', '过肩镜头', '主观镜头', '俯拍', '仰拍'];
const CAMERA_MOVEMENTS = ['固定', '推', '拉', '摇', '移', '跟', '升降', '手持晃动', '环绕', '缓慢推进', '快速推进'];

const ScriptEditModal: React.FC<ScriptEditModalProps> = ({ segment, onClose, onSave }) => {
  const [scene, setScene] = useState(segment.scene || '');
  const [description, setDescription] = useState(segment.description || '');
  const [shots, setShots] = useState<Shot[]>(segment.shots || []);

  const updateShot = (index: number, field: keyof Shot, value: any) => {
    const newShots = [...shots];
    newShots[index] = { ...newShots[index], [field]: value };
    setShots(newShots);
  };

  const addShot = () => {
    setShots([...shots, {
      duration: 5,
      description: '',
      characters: [],
      scene: scene,
      shotType: '中景',
      cameraMovement: '固定',
      audio: '',
      notes: ''
    }]);
  };

  const removeShot = (index: number) => {
    const newShots = shots.filter((_, i) => i !== index);
    setShots(newShots);
  };

  const moveShot = (index: number, direction: 'up' | 'down') => {
    const newShots = [...shots];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= shots.length) return;
    [newShots[index], newShots[targetIndex]] = [newShots[targetIndex], newShots[index]];
    setShots(newShots);
  };

  const handleSave = () => {
    onSave({ scene, description, shots });
  };

  const handleDrop = (e: React.DragEvent, shotIndex: number) => {
    e.preventDefault();
    const assetData = e.dataTransfer.getData('asset');
    if (assetData) {
      const asset = JSON.parse(assetData);
      const insertText = asset.type === 'character' ? asset.fullName : asset.name;
      const currentDesc = shots[shotIndex].description;
      updateShot(shotIndex, 'description', currentDesc + ' ' + insertText);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const totalDuration = shots.reduce((sum, s) => sum + (s.duration || 0), 0);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">编辑分镜脚本</h2>
            <p className="text-sm text-gray-500 mt-1">共 {shots.length} 个镜头，总时长 {totalDuration} 秒</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 transition"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {/* 分集信息 */}
          <div className="mb-6 p-4 bg-gray-50 rounded-lg">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">场景名称</label>
                <input
                  type="text"
                  value={scene}
                  onChange={(e) => setScene(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">分集描述</label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                  placeholder="该分集的整体剧情描述"
                />
              </div>
            </div>
          </div>

          {/* 镜头列表 */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium text-gray-900">镜头列表</h3>
              <button
                onClick={addShot}
                className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary transition flex items-center space-x-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                </svg>
                <span>添加镜头</span>
              </button>
            </div>

            {shots.map((shot, index) => (
              <div
                key={index}
                className="border border-gray-200 rounded-lg p-4 bg-white shadow-sm"
                onDrop={(e) => handleDrop(e, index)}
                onDragOver={handleDragOver}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center space-x-2">
                    <span className="bg-primary text-white text-sm font-medium px-2 py-1 rounded">镜头 {index + 1}</span>
                    <span className="text-gray-500 text-sm">{shot.duration}秒</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <button
                      onClick={() => moveShot(index, 'up')}
                      disabled={index === 0}
                      className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clipRule="evenodd" />
                      </svg>
                    </button>
                    <button
                      onClick={() => moveShot(index, 'down')}
                      disabled={index === shots.length - 1}
                      className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </button>
                    <button
                      onClick={() => removeShot(index)}
                      className="p-1 text-red-400 hover:text-red-600"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-3 mb-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">时长(秒)</label>
                    <input
                      type="number"
                      value={shot.duration}
                      onChange={(e) => updateShot(index, 'duration', parseInt(e.target.value) || 5)}
                      min="1"
                      max="60"
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">景别</label>
                    <select
                      value={shot.shotType || ''}
                      onChange={(e) => updateShot(index, 'shotType', e.target.value)}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                    >
                      <option value="">选择景别</option>
                      {SHOT_TYPES.map(type => (
                        <option key={type} value={type}>{type}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">镜头运动</label>
                    <select
                      value={shot.cameraMovement || ''}
                      onChange={(e) => updateShot(index, 'cameraMovement', e.target.value)}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                    >
                      <option value="">选择运动</option>
                      {CAMERA_MOVEMENTS.map(movement => (
                        <option key={movement} value={movement}>{movement}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">场景</label>
                    <input
                      type="text"
                      value={shot.scene || scene}
                      onChange={(e) => updateShot(index, 'scene', e.target.value)}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                    />
                  </div>
                </div>

                <div className="mb-3">
                  <label className="block text-xs text-gray-500 mb-1">画面描述</label>
                  <textarea
                    value={shot.description}
                    onChange={(e) => updateShot(index, 'description', e.target.value)}
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none"
                    placeholder="详细描述画面内容、构图、光影、动作等..."
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">音频/对白</label>
                    <input
                      type="text"
                      value={shot.audio || ''}
                      onChange={(e) => updateShot(index, 'audio', e.target.value)}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                      placeholder="对白、音效、配乐提示..."
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">拍摄要点</label>
                    <input
                      type="text"
                      value={shot.notes || ''}
                      onChange={(e) => updateShot(index, 'notes', e.target.value)}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                      placeholder="镜头、光圈等技术提示..."
                    />
                  </div>
                </div>
              </div>
            ))}

            {shots.length === 0 && (
              <div className="text-center py-8 text-gray-400">
                <p>暂无镜头，点击上方"添加镜头"按钮开始</p>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end space-x-4 p-6 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-6 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            className="px-6 py-2 bg-primary text-white rounded-lg hover:bg-secondary transition"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
};

export default ScriptEditModal;
