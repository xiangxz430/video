#!/bin/bash
# 一键安装 MongoDB + 部署服务端（ECS 上执行）
# 用法: bash setup-all-ecs.sh
set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

log() { echo -e "${GREEN}[$(date +%H:%M:%S)]${NC} $1"; }
err() { echo -e "${RED}[$(date +%H:%M:%S)] ❌${NC} $1"; }

# ========================================
#  配置（按需修改）
# ========================================
MONGO_ROOT_PWD="VgMongo2026!Aa"
MONGO_CACHE_GB=0.3                    # 2GB 机器限制 300MB
REPO_DIR="/opt/video"                 # 仓库根目录（含客户端）
SERVER_DIR="/opt/video/server"        # 服务端子目录
GIT_REPO="https://github.com/xiangxz430/video.git"
MONGODB_URI="mongodb://root:${MONGO_ROOT_PWD}@127.0.0.1:27017/video_generator?authSource=admin"

log "配置: 缓存=${MONGO_CACHE_GB}GB | 服务端=${SERVER_DIR}"

# ========================================
#  Step 1: 安装 MongoDB 4.4
# ========================================
log "===== Step 1: 安装 MongoDB 4.4 ====="
if command -v mongod &>/dev/null; then
  log "MongoDB 已安装: $(mongod --version | head -1)"
else
  cat > /etc/yum.repos.d/mongodb-org-4.4.repo << 'REPO'
[mongodb-org-4.4]
name=MongoDB Repository
baseurl=https://repo.mongodb.org/yum/redhat/7/mongodb-org/4.4/x86_64/
gpgcheck=1
enabled=1
gpgkey=https://www.mongodb.org/static/pgp/server-4.4.asc
REPO
  yum install -y mongodb-org
  log "MongoDB 4.4 安装完成（含 mongo shell）"
fi

# ========================================
#  Step 2: 配置 MongoDB（限制内存 + 开启认证）
# ========================================
log "===== Step 2: 配置 MongoDB ====="
mkdir -p /var/lib/mongo /var/log/mongodb

# 干掉残留进程
pkill mongod 2>/dev/null || true
sleep 1

# 无认证模式启动，创建管理员
log "启动无认证模式创建管理员..."
mongod --dbpath /var/lib/mongo --fork --logpath /var/log/mongodb/mongod.log --bind_ip 127.0.0.1 2>/dev/null
sleep 2

mongo --quiet --eval "
  try {
    var adminDB = db.getSiblingDB('admin');
    adminDB.createUser({ user: 'root', pwd: '${MONGO_ROOT_PWD}', roles: ['root'] });
    print('管理员已创建');
  } catch(e) {
    if (e.code === 51003) { print('管理员已存在，跳过'); }
    else { throw e; }
  }
"

# 停止无认证进程
pkill mongod 2>/dev/null || true
sleep 1

# 写入配置（限制 WiredTiger 缓存 + 开启认证）
cat > /etc/mongod.conf << CONF
systemLog:
  destination: file
  path: /var/log/mongodb/mongod.log
storage:
  dbPath: /var/lib/mongo
  wiredTiger:
    engineConfig:
      cacheSizeGB: ${MONGO_CACHE_GB}
net:
  bindIp: 127.0.0.1
  port: 27017
security:
  authorization: enabled
CONF

mongod --config /etc/mongod.conf --fork
log "MongoDB 已启动（认证模式，缓存 ${MONGO_CACHE_GB}GB）"

# 测试连接
if mongo -u root -p "${MONGO_ROOT_PWD}" --authenticationDatabase admin --quiet --eval 'print(db.runCommand({ping:1}).ok)' 2>/dev/null | grep -q '1'; then
  log "✅ MongoDB 连接测试通过"
else
  err "MongoDB 连接测试失败"
  exit 1
fi

# ========================================
#  Step 3: 部署/更新服务端
# ========================================
log "===== Step 3: 部署服务端 ====="

# 加载 Node.js
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"

if ! command -v node &>/dev/null; then
  err "Node.js 未安装，请先执行: nvm install 20"
  exit 1
fi
log "Node.js: $(node -v)"

# 拉取仓库代码
if [ -d "${REPO_DIR}/.git" ]; then
  log "更新已有代码..."
  cd "${REPO_DIR}" && git pull origin main
else
  log "克隆代码..."
  rm -rf "${REPO_DIR}"
  git clone "${GIT_REPO}" "${REPO_DIR}"
fi

# 进入服务端子目录
cd "${SERVER_DIR}"

# 更新 .env 中的 MongoDB 连接串
touch .env
if grep -q '^MONGODB_URI=' .env 2>/dev/null; then
  sed -i "s|^MONGODB_URI=.*|MONGODB_URI=${MONGODB_URI}|" .env
else
  echo "MONGODB_URI=${MONGODB_URI}" >> .env
fi
log ".env 已更新 MONGODB_URI"

# 清理旧依赖
rm -rf node_modules package-lock.json

# 安装服务端依赖
log "安装服务端 npm 依赖（约 30-60 秒）..."
npm install

# 编译 TypeScript + 管理后台
log "编译 + 管理后台（约 20-40 秒）..."
npm run build

# PM2 管理
if ! command -v pm2 &>/dev/null; then
  log "安装 PM2..."
  npm install -g pm2
fi

log "启动/重启 PM2..."
pm2 restart video-server || pm2 start ecosystem.config.cjs
pm2 save
log "PM2 已就绪"

# ========================================
#  Step 4: 验证
# ========================================
sleep 2
log "===== Step 4: 验证 ====="

if curl -s http://localhost:3000/api/health | grep -q '"ok"'; then
  log "✅ 服务端健康检查通过"
else
  err "服务端健康检查失败，请检查日志: pm2 logs video-server"
  exit 1
fi

log ""
log "============================================"
log "  ✅ 全部完成！"
log "============================================"
log "  MongoDB: 127.0.0.1:27017 (认证: root)"
log "  服务端:  http://localhost:3000"
log "  管理后台: http://localhost:3000/admin"
log "============================================"
