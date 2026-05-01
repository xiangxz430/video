#!/bin/bash
# 快速打包脚本 - 利用 Rust 编译缓存

echo "🚀 开始快速打包..."

# 1. 构建前端（webpack）
echo "📦 构建前端..."
npm run build

# 2. 使用 npx tauri 打包（利用缓存）
echo "📱 打包应用（使用缓存）..."
npx tauri build --target universal-apple-darwin --bundles app

# 3. 复制到 release 目录
VERSION=$(node -p "require('./src-tauri/tauri.conf.json').version")
rm -rf "release/Video Generator_${VERSION}_universal.app"
cp -R "src-tauri/target/universal-apple-darwin/release/bundle/macos/Video Generator.app" "release/Video Generator_${VERSION}_universal.app"

echo "✅ 打包完成！"
echo "📍 位置: release/Video Generator_${VERSION}_universal.app"
