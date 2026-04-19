import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const steps = [
  { id: 0, name: '剧本列表', path: '/scripts' },
  { id: 1, name: '剧本大纲', path: '/outline' },
  { id: 2, name: '角色和场景', path: '/characters-scenes' },
  { id: 3, name: '分集视频', path: '/episodes' }
];

const StepNavigation: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const getCurrentStep = () => {
    if (location.pathname.includes('/episodes')) return 3;
    if (location.pathname.includes('/characters-scenes') || location.pathname.includes('/scene-collection')) return 2;
    if (location.pathname.includes('/outline')) return 1;
    if (location.pathname.includes('/scripts')) return 0;
    return 0;
  };

  const currentStep = getCurrentStep();

  return (
    <div className="flex items-center space-x-2">
      {steps.map((step, index) => (
        <React.Fragment key={step.id}>
          <button
            onClick={() => navigate(step.path)}
            className="flex items-center space-x-2 group"
          >
            <span
              className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium transition ${
                step.id === currentStep
                  ? 'bg-primary text-white'
                  : step.id < currentStep
                  ? 'bg-gray-200 text-gray-600 group-hover:bg-gray-300'
                  : 'bg-gray-100 text-gray-400 group-hover:bg-gray-200'
              }`}
            >
              {step.id}
            </span>
            <span className={`text-sm font-medium transition ${
              step.id === currentStep ? 'text-gray-900' : 'text-gray-400 group-hover:text-gray-600'
            }`}>
              {step.name}
            </span>
          </button>
          {index < steps.length - 1 && (
            <div className="w-12 h-px bg-gray-300 mx-2"></div>
          )}
        </React.Fragment>
      ))}
    </div>
  );
};

export default StepNavigation;
