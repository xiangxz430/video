#!/bin/bash
#
# Video Generator 构建脚本
# 统一构建流程，生成标准化交付物
#
# 构建产物结构:
#   build/               ← webpack 前端产物
#   release/             ← 最终交付 .app（带版本号）
#
# 使用方法:
#   ./scripts/build.sh          # 生产构建 (universal)
#   ./scripts/build.sh --debug  # 调试构建

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$PROJECT_DIR/build"
RELEASE_DIR="$PROJECT_DIR/release"
SRC_TAURI_DIR="$PROJECT_DIR/src-tauri"

# 默认参数
DEBUG_MODE=""
BUNDLE_TARGET="--target universal-apple-darwin"

# 解析参数
for arg in "$@"; do
  case $arg in
    --debug)
      DEBUG_MODE="--debug"
      echo "[构建] 调试模式"
      ;;
    --help|-h)
      echo "用法: $0 [--debug]"
      echo "  --debug     调试构建"
      exit 0
      ;;
  esac
done

# ========== 步骤 1: 读取版本号 ==========
VERSION=$(node -p "require('$PROJECT_DIR/package.json').version")
echo "=========================================="
echo "🎬 Video Generator 构建"
echo "=========================================="
echo "版本: $VERSION"
echo "=========================================="

# ========== 步骤 2: 创建 release 目录 ==========
mkdir -p "$RELEASE_DIR"

# ========== 步骤 3: Webpack 前端构建 ==========
echo ""
echo "[步骤 1/3] Webpack 前端构建 → build/"
echo "-------------------------------------------"
cd "$PROJECT_DIR"
npm run build

if [ ! -f "$BUILD_DIR/bundle.js" ]; then
  echo "❌ Webpack 构建失败，未找到 bundle.js"
  exit 1
fi
echo "✅ 前端构建完成: $BUILD_DIR/bundle.js"

# ========== 步骤 4: Tauri 构建 ==========
echo ""
echo "[步骤 2/3] Tauri 打包 → src-tauri/target/"
echo "-------------------------------------------"

TARGET_ARG=""
if [ "$BUNDLE_TARGET" = "--target universal-apple-darwin" ]; then
  TARGET_ARG="--target universal-apple-darwin"
fi

cd "$SRC_TAURI_DIR"
npx tauri build $DEBUG_MODE $TARGET_ARG --bundles app

# ========== 步骤 5: 收集 .app 到 release/ ==========
echo ""
echo "[步骤 3/3] 收集构建产物 → release/"
echo "-------------------------------------------"

# 查找构建产物
PROFILE="release"
if [ -n "$DEBUG_MODE" ]; then
  PROFILE="debug"
fi

# 根据目标架构选择正确的目录
if [ "$BUNDLE_TARGET" = "--target universal-apple-darwin" ]; then
  BUNDLE_DIR="$SRC_TAURI_DIR/target/universal-apple-darwin/$PROFILE/bundle/macos"
else
  BUNDLE_DIR="$SRC_TAURI_DIR/target/$PROFILE/bundle/macos"
fi

if [ ! -d "$BUNDLE_DIR" ]; then
  echo "❌ 未找到 bundle 目录: $BUNDLE_DIR"
  echo "   尝试查找其他位置..."
  find "$SRC_TAURI_DIR/target" -name "*.app" -type d 2>/dev/null | head -5
  exit 1
fi

# 找到 app bundle
APP_BUNDLE=$(find "$BUNDLE_DIR" -maxdepth 1 -name "*.app" -type d | head -1)

if [ -z "$APP_BUNDLE" ]; then
  echo "❌ 未在 $BUNDLE_DIR 中找到 .app 文件"
  exit 1
fi

APP_NAME=$(basename "$APP_BUNDLE")

# 生成输出文件名: Video Generator_2.3.8_universal.app
OUTPUT_NAME="Video Generator_${VERSION}_universal.app"
OUTPUT_PATH="$RELEASE_DIR/$OUTPUT_NAME"

# 清理旧的同名文件
if [ -d "$OUTPUT_PATH" ]; then
  echo "   清理旧版本: $OUTPUT_NAME"
  rm -rf "$OUTPUT_PATH"
fi

# 复制到 release 目录
echo "   源文件: $APP_BUNDLE"
echo "   目标: $OUTPUT_PATH"
cp -R "$APP_BUNDLE" "$OUTPUT_PATH"

# ========== 完成 ==========
echo ""
echo "=========================================="
echo "✅ 构建完成!"
echo "=========================================="
echo "版本: $VERSION"
echo "交付物: $OUTPUT_PATH"
echo "大小: $(du -sh "$OUTPUT_PATH" | cut -f1)"
echo "=========================================="
echo "=========================================="
echo "版本: $VERSION"
echo "交付物: $OUTPUT_PATH"
echo "大小: $(du -sh "$OUTPUT_PATH" | cut -f1)"
echo "=========================================="
echo "=========================================="
echo "版本: $VERSION"
echo "交付物: $OUTPUT_PATH"
echo "大小: $(du -sh "$OUTPUT_PATH" | cut -f1)"
echo "=========================================="
