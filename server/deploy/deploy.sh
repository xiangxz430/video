#!/bin/bash
set -e

# ============================================
# 视频生成器服务端 - 一键部署脚本
# ============================================

# 颜色输出辅助函数
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

# ------------------------------------------
# 1. 检测操作系统（仅支持 Linux）
# ------------------------------------------
info "检测操作系统..."
if [[ "$(uname)" != "Linux" ]]; then
    error "此部署脚本仅支持 Linux 系统，当前系统: $(uname)"
    exit 1
fi
success "操作系统检测通过: Linux"

# ------------------------------------------
# 2. 检查并安装 NVM 和 Node.js 20.x LTS
# ------------------------------------------
info "检查 NVM 和 Node.js 环境..."

export NVM_DIR="$HOME/.nvm"

if [ ! -d "$NVM_DIR" ]; then
    info "安装 NVM..."
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
    success "NVM 安装完成"
else
    info "NVM 已安装，跳过"
fi

# 加载 NVM
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

NODE_VERSION=$(node -v 2>/dev/null || echo "none")
if [[ "$NODE_VERSION" != v20* ]]; then
    info "安装 Node.js 20.x LTS..."
    nvm install 20
    nvm use 20
    nvm alias default 20
    success "Node.js 20.x LTS 安装完成: $(node -v)"
else
    success "Node.js 版本符合要求: $NODE_VERSION"
fi

# ------------------------------------------
# 3. 安装 PM2（全局）
# ------------------------------------------
info "检查 PM2..."
if ! command -v pm2 &> /dev/null; then
    info "全局安装 PM2..."
    npm install -g pm2
    success "PM2 安装完成"
else
    success "PM2 已安装: $(pm2 -v)"
fi

# ------------------------------------------
# 4. 配置 npm 淘宝镜像
# ------------------------------------------
info "配置 npm 淘宝镜像..."
npm config set registry https://registry.npmmirror.com
success "npm 镜像源已设置为 https://registry.npmmirror.com"

# ------------------------------------------
# 5. 安装服务端 npm 依赖
# ------------------------------------------
SERVER_DIR="$(cd "$(dirname "$0")/.." && pwd)"
info "进入服务端目录: $SERVER_DIR"
cd "$SERVER_DIR"

info "安装服务端 npm 依赖..."
npm install
success "服务端依赖安装完成"

# ------------------------------------------
# 6. 构建管理后台
# ------------------------------------------
info "构建管理后台..."
cd admin
npm install
npm run build
cd ..
success "管理后台构建完成"

# ------------------------------------------
# 7. 构建 TypeScript
# ------------------------------------------
info "构建 TypeScript..."
npm run build
success "TypeScript 构建完成"

# ------------------------------------------
# 8. 配置环境变量
# ------------------------------------------
if [ ! -f ".env" ]; then
    if [ -f ".env.production" ]; then
        info "从 .env.production 复制 .env..."
        cp .env.production .env
        warn "请根据生产环境编辑 .env 文件: vi $SERVER_DIR/.env"
    else
        warn ".env 和 .env.production 均不存在，请手动创建 .env 文件"
    fi
else
    success ".env 文件已存在"
fi

# ------------------------------------------
# 9. 创建必要目录
# ------------------------------------------
info "创建 logs/ 和 data/ 目录..."
mkdir -p logs
mkdir -p data
success "目录创建完成"

# ------------------------------------------
# 10. 使用 PM2 启动或重启
# ------------------------------------------
info "使用 PM2 启动/重启服务..."
pm2 startOrRestart ecosystem.config.cjs
success "PM2 启动/重启完成"

# ------------------------------------------
# 11. 配置 PM2 开机自启
# ------------------------------------------
info "配置 PM2 开机自启..."
pm2 startup 2>/dev/null || warn "pm2 startup 需要以 root 权限运行，请手动执行: sudo env PATH=\$PATH:\$(dirname \$(which node)) pm2 startup"
pm2 save
success "PM2 开机自启配置完成"

# ------------------------------------------
# 12. 健康检查
# ------------------------------------------
info "等待服务启动，进行健康检查..."
sleep 3

HEALTH_URL="http://localhost:3000/api/health"
HEALTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTH_URL" 2>/dev/null || echo "000")

if [[ "$HEALTH_STATUS" == "200" ]]; then
    success "健康检查通过！服务运行正常"
else
    warn "健康检查返回状态码: $HEALTH_STATUS（服务可能仍在启动中，请稍后检查）"
fi

# ------------------------------------------
# 13. 输出部署成功信息
# ------------------------------------------
echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}   视频生成器服务端部署成功！${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo -e "  访问地址:"
echo -e "    服务端 API:  ${BLUE}http://localhost:3000${NC}"
echo -e "    管理后台:    ${BLUE}http://localhost:3000/admin${NC}"
echo -e "    健康检查:    ${BLUE}http://localhost:3000/api/health${NC}"
echo ""
echo -e "  常用命令:"
echo -e "    查看日志:    ${BLUE}pm2 logs video-server${NC}"
echo -e "    重启服务:    ${BLUE}pm2 restart video-server${NC}"
echo -e "    停止服务:    ${BLUE}pm2 stop video-server${NC}"
echo ""
