export function VersionInfo() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">版本信息</h1>

      {/* 版本号卡片 */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">当前版本</h2>
        <div className="flex items-center gap-6">
          <div>
            <span className="text-xs text-gray-500">版本号</span>
            <div className="text-3xl font-bold text-blue-600">{__BUILD_VERSION__}</div>
          </div>
          <div>
            <span className="text-xs text-gray-500">构建时间</span>
            <div className="text-lg text-gray-700">{__BUILD_TIME__}</div>
          </div>
        </div>
      </div>

      {/* 更新内容卡片 */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4">本次更新内容</h2>

        <Section title="🐛 Bug修复">
          <Item n={1}>修复火山模型参考图传递失败 — Home.tsx 中 base64 前缀被错误砍掉，导致退化为文生图模式</Item>
          <Item n={2}>补全 CharactersAndScenes.tsx 批量生成角色/场景图的 referenceImageMeta</Item>
          <Item n={3}>补全 aiService.ts 透传 referenceImageMeta 到服务端</Item>
          <Item n={4}>补全 EpisodeEdit.tsx 首帧/尾帧生图的 referenceImageMeta</Item>
          <Item n={5}>补全服务端路由和类型定义的 referenceImageMeta 转发</Item>
        </Section>

        <Section title="📐 宽高比显示修复">
          <Item n={6}>修复前端所有图片/视频容器写死 16:9 的问题，改为根据实际宽高比动态显示（支持 9:16、1:1、4:3 等）</Item>
        </Section>

        <Section title="📋 日志系统优化">
          <Item n={7}>日志列表 API 裁剪大字段（requestBody/responseBody/aiApiCalls），大幅提升页面加载速度</Item>
          <Item n={8}>日志详情改为点击展开时按需加载，减少初始数据量</Item>
          <Item n={9}>排除 referenceImage、firstFrameImage、lastFrameImage、referenceImages 的 base64 数据，避免日志过大</Item>
          <Item n={10}>修复视频生成接口响应体日志为空的问题（SSE 流式响应捕获）</Item>
          <Item n={11}>新增日志删除按钮，支持手动清理大日志</Item>
        </Section>

        <Section title="🔧 管理后台增强">
          <Item n={12}>添加构建版本号显示（侧边栏底部）</Item>
          <Item n={13}>新增版本信息页面（本页面）</Item>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5 last:mb-0">
      <h3 className="text-base font-semibold text-gray-800 mb-2 pb-1 border-b border-gray-100">{title}</h3>
      <ol className="space-y-1.5 pl-1">{children}</ol>
    </div>
  );
}

function Item({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-2 text-sm text-gray-600">
      <span className="text-gray-400 font-mono min-w-[24px]">{n}.</span>
      <span>{children}</span>
    </li>
  );
}
