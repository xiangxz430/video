import React from 'react';

/**
 * 宽高比字符串到 CSS aspect-ratio 值的映射
 */
const RATIO_MAP: Record<string, string> = {
  '16:9': '16/9',
  '9:16': '9/16',
  '1:1': '1/1',
  '4:3': '4/3',
  '3:4': '3/4',
};

/**
 * 将宽高比字符串（如 '16:9'）转换为 CSS 样式对象
 * 替代 Tailwind 的 aspect-video（固定 16:9），支持动态宽高比
 *
 * @param aspectRatio 宽高比字符串，如 '16:9', '9:16', '1:1', '4:3', '3:4'
 * @param options.maxHeightForVertical 竖屏内容的最大高度限制，默认 '70vh'
 */
export function getAspectRatioStyle(
  aspectRatio?: string,
  options?: { maxHeightForVertical?: string }
): React.CSSProperties {
  const resolved = aspectRatio || '16:9';
  const cssRatio = RATIO_MAP[resolved] || resolved.replace(':', '/');

  const style: React.CSSProperties = { aspectRatio: cssRatio };

  // 竖屏内容设置最大高度，防止容器过高
  if (resolved === '9:16' || resolved === '3:4') {
    style.maxHeight = options?.maxHeightForVertical || '70vh';
  }

  return style;
}
