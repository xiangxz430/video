#!/bin/bash
set -e

# ============================================
# 视频生成器服务端 - Nginx 安装配置脚本
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

# 检测是否为 root 用户
check_root() {
    if [[ "$EUID" -ne 0 ]]; then
        error "此脚本需要 root 权限运行，请使用: sudo bash $0"
        exit 1
    fi
}

check_root

# ------------------------------------------
# 1. 检测并安装 Nginx
# ------------------------------------------
info "检测 Nginx..."

if command -v nginx &> /dev/null; then
    success "Nginx 已安装: $(nginx -v 2>&1)"
else
    info "安装 Nginx..."

    # 检测包管理器
    if command -v apt-get &> /dev/null; then
        apt-get update
        apt-get install -y nginx
    elif command -v yum &> /dev/null; then
        yum install -y nginx
    else
        error "不支持的包管理器，请手动安装 Nginx"
        exit 1
    fi

    success "Nginx 安装完成: $(nginx -v 2>&1)"
fi

# ------------------------------------------
# 2. 复制 Nginx 配置文件
# ------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NGINX_CONF_SRC="$SCRIPT_DIR/nginx.conf"
NGINX_CONF_DEST="/etc/nginx/conf.d/video-server.conf"

if [ ! -f "$NGINX_CONF_SRC" ]; then
    error "Nginx 配置文件不存在: $NGINX_CONF_SRC"
    error "请先创建 nginx.conf 文件到 deploy/ 目录下"
    exit 1
fi

info "复制 Nginx 配置文件到 $NGINX_CONF_DEST..."
cp "$NGINX_CONF_SRC" "$NGINX_CONF_DEST"
success "Nginx 配置文件已复制"

# ------------------------------------------
# 3. 测试 Nginx 配置
# ------------------------------------------
info "测试 Nginx 配置..."
nginx -t
success "Nginx 配置测试通过"

# ------------------------------------------
# 4. 重载 Nginx
# ------------------------------------------
info "重载 Nginx..."
systemctl reload nginx
success "Nginx 已重载"

# ------------------------------------------
# 5. 提示信息
# ------------------------------------------
echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}   Nginx 配置完成！${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo -e "  ${YELLOW}重要提示:${NC}"
echo -e "    1. 请修改 Nginx 配置中的 server_name 为你的域名:"
echo -e "       ${BLUE}vi $NGINX_CONF_DEST${NC}"
echo ""
echo -e "    2. 建议配置 HTTPS，可使用 certbot 免费获取证书:"
echo -e "       ${BLUE}apt-get install certbot python3-certbot-nginx${NC}"
echo -e "       ${BLUE}certbot --nginx -d your-domain.com${NC}"
echo ""
echo -e "    3. 修改后重载 Nginx:"
echo -e "       ${BLUE}systemctl reload nginx${NC}"
echo ""
