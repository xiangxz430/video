#!/bin/bash
# 一键创建 MongoDB 实例（ECS 上执行）
set -e

LOG=/root/mongodb-setup.log
echo "" > $LOG

log() { echo "$1" | tee -a $LOG; }

# ===== Step 1: 安装 aliyun CLI =====
log "===== Step 1: 安装 aliyun CLI ====="
if ! command -v aliyun &>/dev/null; then
  curl -sL https://aliyuncli.alicdn.com/aliyun-cli-linux-latest-amd64.tgz -o /tmp/aliyun.tgz
  cd /tmp && tar xzf aliyun.tgz && mv aliyun /usr/local/bin/
  log "aliyun CLI 已安装"
else
  log "aliyun CLI 已存在"
fi

# ===== Step 2: 配置凭证 =====
log "===== Step 2: 配置凭证 ====="
if [ -z "$ALIYUN_AK_ID" ] || [ -z "$ALIYUN_AK_SECRET" ]; then
  log "❌ 请先设置环境变量:"
  log "  export ALIYUN_AK_ID=你的AccessKeyId"
  log "  export ALIYUN_AK_SECRET=你的AccessKeySecret"
  exit 1
fi
aliyun configure set --profile default --mode AK \
  --access-key-id "$ALIYUN_AK_ID" \
  --access-key-secret "$ALIYUN_AK_SECRET" \
  --region cn-beijing
log "凭证已配置"

# ===== Step 3: 查询或创建 VPC =====
log "===== Step 3: 查询或创建 VPC ====="
VPC_ID=$(aliyun vpc DescribeVpcs --RegionId cn-beijing 2>/dev/null | grep -oP '"VpcId"\s*:\s*"\K[vpc-[a-zA-Z0-9]+"' | head -1 | tr -d '"')

if [ -z "$VPC_ID" ]; then
  log "未找到 VPC，正在创建..."
  VPC_RESULT=$(aliyun vpc CreateVpc --RegionId cn-beijing --VpcName vg-vpc --CidrBlock 10.0.0.0/8 2>&1)
  VPC_ID=$(echo "$VPC_RESULT" | grep -oP '"VpcId"\s*:\s*"\K[vpc-[a-zA-Z0-9]+' | head -1)
  if [ -z "$VPC_ID" ]; then
    log "❌ VPC 创建失败: ${VPC_RESULT}"
    exit 1
  fi
  log "VPC 已创建: ${VPC_ID}"
  # 等待 VPC 就绪
  sleep 5
else
  log "VPC: ${VPC_ID}"
fi

# ===== Step 4: 查询或创建 VSwitch =====
log "===== Step 4: 查询或创建 VSwitch ====="
VSW_INFO=$(aliyun vpc DescribeVSwitches --RegionId cn-beijing --VpcId ${VPC_ID} 2>/dev/null)
VSW_ID=$(echo "$VSW_INFO" | grep -oP '"VSwitchId"\s*:\s*"\K[vsw-[a-zA-Z0-9]+' | head -1)
ZONE_ID=$(echo "$VSW_INFO" | grep -oP '"ZoneId"\s*:\s*"\K[cn-beijing-a-z]+' | head -1)

if [ -z "$VSW_ID" ]; then
  # 优先使用 cn-beijing-h（MongoDB 4.4 支持），否则用 cn-beijing-g
  ZONE_ID="cn-beijing-h"
  log "未找到 VSwitch，正在创建（Zone: ${ZONE_ID}）..."
  VSW_RESULT=$(aliyun vpc CreateVSwitch --RegionId cn-beijing --ZoneId ${ZONE_ID} \
    --VpcId ${VPC_ID} --CidrBlock 10.0.1.0/24 --VSwitchName vg-vswitch 2>&1)
  VSW_ID=$(echo "$VSW_RESULT" | grep -oP '"VSwitchId"\s*:\s*"\K[vsw-[a-zA-Z0-9]+' | head -1)
  if [ -z "$VSW_ID" ]; then
    log "❌ VSwitch 创建失败: ${VSW_RESULT}"
    exit 1
  fi
  log "VSwitch 已创建: ${VSW_ID}, Zone: ${ZONE_ID}"
  # 等待 VSwitch 就绪
  sleep 5
else
  log "VSwitch: ${VSW_ID}, Zone: ${ZONE_ID}"
fi

# ===== Step 5: 创建 MongoDB 实例 =====
log "===== Step 5: 创建 MongoDB 副本集实例 ====="
log "规格: mdb.shard.2x.large.c (2核4GB), 20GB ESSD, MongoDB 4.4, 按量付费"

RESULT=$(aliyun dds CreateDBInstance \
  --RegionId cn-beijing \
  --ZoneId ${ZONE_ID} \
  --EngineVersion 4.4 \
  --DBInstanceClass mdb.shard.2x.large.c \
  --DBInstanceStorage 20 \
  --StorageType cloud_essd1 \
  --ChargeType PostPaid \
  --NetworkType VPC \
  --VpcId ${VPC_ID} \
  --VSwitchId ${VSW_ID} \
  --ReplicationFactor 3 \
  --DBInstanceDescription video-generator-mongodb-logs \
  --AccountPassword 'VgMongo2026!Aa' \
  --SecurityIPList '0.0.0.0/0' \
  --Engine MongoDB 2>&1)

log "创建结果: ${RESULT}"

INSTANCE_ID=$(echo "$RESULT" | grep -oP 'dds-[a-zA-Z0-9]+')
log "实例 ID: ${INSTANCE_ID}"

if [ -z "$INSTANCE_ID" ]; then
  log "❌ 创建失败！请检查日志: ${LOG}"
  exit 1
fi

# ===== Step 6: 等待实例就绪 =====
log "===== Step 6: 等待实例就绪（约5-10分钟）====="
for i in $(seq 1 30); do
  sleep 20
  STATUS=$(aliyun dds DescribeDBInstanceAttribute --DBInstanceId ${INSTANCE_ID} --output cols=DBInstanceStatus rows=DBInstances.DBInstance[] 2>/dev/null | tail -1 | awk '{print $NF}')
  log "[$(($i*20))s] 状态: ${STATUS}"
  if [ "$STATUS" = "Running" ]; then
    log "✅ 实例已就绪！"
    break
  fi
done

# ===== Step 7: 获取连接信息 =====
log "===== Step 7: 获取连接信息 ====="
DETAIL=$(aliyun dds DescribeDBInstanceAttribute --DBInstanceId ${INSTANCE_ID} 2>/dev/null)
log "实例详情:\n${DETAIL}"

log ""
log "============================================"
log "  MongoDB 实例创建完成！"
log "============================================"
log "  实例 ID:    ${INSTANCE_ID}"
log "  root 密码:  VgMongo2026!Aa"
log "  数据库名:   video_generator"
log ""
log "  连接串格式（更新到 .env 的 MONGODB_URI）："
log "  mongodb://root:VgMongo2026!Aa@<连接地址>:3717/video_generator?authSource=admin"
log ""
log "  请在阿里云控制台查看完整连接地址："
log "  https://mongodb.console.aliyun.com/"
log "============================================"
