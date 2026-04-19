/**
 * 分镜解析工具
 * 统一处理 segment content 的 JSON 解析
 */

/**
 * 清理 JSON 字符串中的特殊控制字符
 * 保留 \n, \t, \r，移除 \u0000-\u001F 范围内的其他控制字符
 */
function sanitizeControlChars(str: string): string {
  return str.replace(/[\u0000-\u001F]/g, (char) => {
    // 保留换行、制表符和回车
    if (char === '\n' || char === '\t' || char === '\r') {
      return char;
    }
    // 移除其他控制字符
    return '';
  });
}

/**
 * 解析 segment content JSON，兼容旧格式和新扁平结构
 */
export function parseSegmentContent(content: string): {
  scene?: string;
  description?: string;
  shots?: any[];
  status?: string;
  // Shot 的所有字段（扁平结构）
  [key: string]: any;
} {
  // null/undefined/空字符串防守检查
  if (!content || typeof content !== 'string') {
    return { scene: '', description: '', shots: [] };
  }

  try {
    // 在 JSON.parse 前清理特殊控制字符
    const sanitizedContent = sanitizeControlChars(content);
    const data = JSON.parse(sanitizedContent);

    // 新扁平结构：content 直接是 shot 对象
    if (data.description && !data.shots) {
      return {
        ...data,
        shots: [data]  // 包装成数组兼容旧代码
      };
    }

    // 旧结构：包含 shots 数组
    // 如果解析成功但返回的 data 中没有 shots 数组（扁平结构），则将 data 包装为 shots: [data]
    const shots = data.shots || [];
    if (shots.length === 0 && data.description) {
      return {
        scene: data.scene || '',
        description: data.description || '',
        shots: [data],
        status: data.status,
        ...data
      };
    }

    return {
      scene: data.scene || '',
      description: data.description || '',
      shots: shots,
      status: data.status,
      ...data
    };
  } catch (parseError) {
    // 解析失败：返回包含原始文本的有效 shots 数组，限制长度避免卡顿
    const truncatedContent = content?.substring(0, 500) || '[空内容]';
    return {
      scene: '',
      description: truncatedContent,
      shots: [{ description: truncatedContent, status: 'error' }]
    };
  }
}
