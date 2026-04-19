#!/bin/bash
#
# 安全构建脚本 - 包含代码混淆和优化
#

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=========================================="
echo "🔒 安全构建 Video Generator"
echo "=========================================="

# 步骤 1: 生产构建前端 (自动启用混淆)
echo "📦 构建前端 (生产模式 + 代码混淆)..."
cd "$PROJECT_DIR"
npm run build

# 步骤 2: 构建 Tauri 应用 (Rust 优化已配置)
echo "🛡️  构建 Tauri 应用 (Rust 代码优化)..."
cd "$PROJECT_DIR/src-tauri"
cargo tauri build --target universal-apple-darwin --bundles app

# 步骤 3: 复制到 release 目录
cd "$PROJECT_DIR"
VERSION=$(node -p "require('./src-tauri/tauri.conf.json').version")
RELEASE_NAME="Video Generator_${VERSION}_universal.app"
OUTPUT_PATH="release/$RELEASE_NAME"

echo "📱 打包应用..."
rm -rf "$OUTPUT_PATH"
cp -R "src-tauri/target/universal-apple-darwin/release/bundle/macos/Video Generator.app" "$OUTPUT_PATH"

echo ""
echo "=========================================="
echo "✅ 安全构建完成!"
echo "=========================================="
echo "版本: $VERSION"
echo "交付物: $OUTPUT_PATH"
echo "大小: $(du -sh "$OUTPUT_PATH" | cut -f1)"
echo ""
echo "🔒 已应用的安全措施:"
echo "  ✓ JavaScript 代码混淆和压缩"
echo "  ✓ 移除 console.log 和调试信息"
echo "  ✓ 移除 Source Map"
echo "  ✓ Rust 代码优化和符号剥离"
echo "  ✓ Link Time Optimization (LTO)"
echo "=========================================="
