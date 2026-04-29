#!/bin/bash
# ============================================================
# 阿里云 MongoDB 副本集实例创建脚本
# 用途：为视频软件服务端创建日志存储用的 MongoDB 实例
# 规格：2核4GB 通用型云盘版（最低成本，日志场景足够）
# ============================================================
# 前置条件：
#   1. 安装阿里云 CLI：brew install aliyun-cli  或参考 https://help.aliyun.com/document_detail/139508.html
#   2. 配置凭证：aliyun configure
# ============================================================

set -e

# ========== 配置参数 ==========
REGION="cn-beijing"
ENGINE_VERSION="4.4"
# 通用型云盘版 2核4GB（最经济，3000连接数，足够日志场景）
DB_INSTANCE_CLASS="mdb.shard.2x.large.c"
DB_INSTANCE_STORAGE=20          # 20GB 存储
STORAGE_TYPE="cloud_essd1"      # ESSD PL1 云盘
CHARGE_TYPE="PostPaid"          # 按量付费
NETWORK_TYPE="VPC"
REPLICATION_FACTOR="3"          # 3节点副本集（1主2从，高可用）
DB_INSTANCE_DESCRIPTION="video-generator-mongodb-logs"
ROOT_PASSWORD="VgMongo2026!Aa"  # root 密码，需包含大小写字母+数字+特殊字符

# ========== Step 1: 查询 ECS 所在 VPC ==========
echo "===== Step 1: 查询 ECS 所在 VPC ====="

# 查找 ECS 实例的 VPC 信息
echo "正在查询 ${REGION} 的 VPC 列表..."
VPC_INFO=$(aliyun vpc DescribeVpcs --RegionId ${REGION} --output cols=VpcId,VpcName,CidrBlock rows=Vpcs.Vpc[] 2>/dev/null)

if [ -z "$VPC_INFO" ] || echo "$VPC_INFO" | grep -q "[]"; then
    echo "未找到 VPC，将使用默认 VPC"
    # 创建默认 VPC
    VPC_ID=$(aliyun vpc CreateVpc --RegionId ${REGION} --VpcName "video-generator-vpc" \
        --output cols=VpcId rows=Vpc 2>/dev/null | tail -1 | awk '{print $NF}')
    echo "已创建 VPC: ${VPC_ID}"
    sleep 5
else
    echo "$VPC_INFO"
    echo ""
    echo "请输入要使用的 VpcId（直接回车使用第一个）："
    read -r INPUT_VPC_ID
    if [ -n "$INPUT_VPC_ID" ]; then
        VPC_ID="$INPUT_VPC_ID"
    else
        VPC_ID=$(echo "$VPC_INFO" | tail -n +3 | head -1 | awk '{print $1}')
    fi
fi

echo "使用 VPC: ${VPC_ID}"

# ========== Step 2: 查询 VSwitch ==========
echo ""
echo "===== Step 2: 查询 VSwitch ====="

VSWITCH_INFO=$(aliyun vpc DescribeVSwitches --RegionId ${REGION} --VpcId ${VPC_ID} \
    --output cols=VSwitchId,ZoneId,CidrBlock rows=VSwitches.VSwitch[] 2>/dev/null)

if [ -z "$VSWITCH_INFO" ] || echo "$VSWITCH_INFO" | grep -q "[]"; then
    echo "未找到 VSwitch，将在 cn-beijing-g 创建"
    VSWITCH_ID=$(aliyun vpc CreateVSwitch --RegionId ${REGION} --VpcId ${VPC_ID} \
        --ZoneId "cn-beijing-g" --CidrBlock "192.168.1.0/24" --VSwitchName "video-generator-vswitch" \
        --output cols=VSwitchId rows=VSwitch 2>/dev/null | tail -1 | awk '{print $NF}')
    ZONE_ID="cn-beijing-g"
    echo "已创建 VSwitch: ${VSWITCH_ID}"
    sleep 5
else
    echo "$VSWITCH_INFO"
    echo ""
    echo "请输入要使用的 VSwitchId（直接回车使用第一个）："
    read -r INPUT_VSWITCH_ID
    if [ -n "$INPUT_VSWITCH_ID" ]; then
        VSWITCH_ID="$INPUT_VSWITCH_ID"
    else
        VSWITCH_ID=$(echo "$VSWITCH_INFO" | tail -n +3 | head -1 | awk '{print $1}')
    fi
    ZONE_ID=$(echo "$VSWITCH_INFO" | tail -n +3 | head -1 | awk '{print $2}')
fi

echo "使用 VSwitch: ${VSWITCH_ID}, Zone: ${ZONE_ID}"

# ========== Step 3: 检查可用资源 ==========
echo ""
echo "===== Step 3: 检查 MongoDB 可用资源 ====="

echo "正在查询 ${REGION} 可用的 MongoDB 规格..."
aliyun dds DescribeAvailableResource --RegionId ${REGION} \
    --EngineVersion ${ENGINE_VERSION} \
    --Output cols=DBInstanceClass,ZoneIds rows=AvailableDBInstances.AvailableDBInstance[] 2>/dev/null | head -20

echo ""

# ========== Step 4: 创建 MongoDB 实例 ==========
echo ""
echo "===== Step 4: 创建 MongoDB 副本集实例 ====="
echo "规格: ${DB_INSTANCE_CLASS} (2核4GB)"
echo "存储: ${DB_INSTANCE_STORAGE}GB ESSD PL1"
echo "版本: MongoDB ${ENGINE_VERSION}"
echo "区域: ${REGION} / ${ZONE_ID}"
echo "VPC:  ${VPC_ID}"
echo "付费: 按量付费"
echo ""

echo "确认创建？(y/n)"
read -r CONFIRM
if [ "$CONFIRM" != "y" ]; then
    echo "已取消"
    exit 0
fi

echo "正在创建实例（通常需要 5-10 分钟）..."

CREATE_RESULT=$(aliyun dds CreateDBInstance \
    --RegionId ${REGION} \
    --ZoneId ${ZONE_ID} \
    --EngineVersion ${ENGINE_VERSION} \
    --DBInstanceClass ${DB_INSTANCE_CLASS} \
    --DBInstanceStorage ${DB_INSTANCE_STORAGE} \
    --StorageType ${STORAGE_TYPE} \
    --ChargeType ${CHARGE_TYPE} \
    --NetworkType ${NETWORK_TYPE} \
    --VpcId ${VPC_ID} \
    --VSwitchId ${VSWITCH_ID} \
    --ReplicationFactor ${REPLICATION_FACTOR} \
    --DBInstanceDescription "${DB_INSTANCE_DESCRIPTION}" \
    --AccountPassword "${ROOT_PASSWORD}" \
    --SecurityIPList "0.0.0.0/0" \
    --output cols=DBInstanceId rows=DBInstance 2>&1)

echo "$CREATE_RESULT"

# 提取实例 ID
INSTANCE_ID=$(echo "$CREATE_RESULT" | grep -oP 'dds-[a-zA-Z0-9]+' | head -1)

if [ -z "$INSTANCE_ID" ]; then
    echo ""
    echo "❌ 创建失败！请检查上方错误信息。"
    echo "常见原因："
    echo "  1. 该可用区无库存 → 换 ZoneId 重试"
    echo "  2. 余额不足 → 充值后重试"
    echo "  3. 阿里云 CLI 未配置 → 运行 aliyun configure"
    exit 1
fi

echo ""
echo "✅ 实例创建请求已提交！"
echo "实例 ID: ${INSTANCE_ID}"

# ========== Step 5: 等待实例就绪 ==========
echo ""
echo "===== Step 5: 等待实例创建完成 ====="
echo "正在等待（约 5-10 分钟）..."

for i in $(seq 1 30); do
    sleep 20
    STATUS=$(aliyun dds DescribeDBInstanceAttribute --DBInstanceId ${INSTANCE_ID} \
        --output cols=DBInstanceStatus rows=DBInstances.DBInstance[] 2>/dev/null | tail -1 | awk '{print $NF}')
    echo "[$((i*20))s] 状态: ${STATUS}"
    if [ "$STATUS" = "Running" ]; then
        echo "✅ 实例已就绪！"
        break
    fi
    if [ "$STATUS" = "Creating" ] || [ "$STATUS" = "DBInstanceCreating" ]; then
        continue
    fi
done

# ========== Step 6: 获取连接信息 ==========
echo ""
echo "===== Step 6: 获取连接信息 ====="

CONNECTION_INFO=$(aliyun dds DescribeDBInstanceAttribute --DBInstanceId ${INSTANCE_ID} \
    --output cols=ConnectionString,ConnectionPort rows=Connections.Connection[] 2>/dev/null)

echo "$CONNECTION_INFO"

echo ""
echo "============================================"
echo "  MongoDB 实例创建完成！"
echo "============================================"
echo ""
echo "  实例 ID:    ${INSTANCE_ID}"
echo "  root 密码:  ${ROOT_PASSWORD}"
echo "  数据库名:   video_generator"
echo ""
echo "  连接串格式（更新到 .env 的 MONGODB_URI）："
echo "  mongodb://root:${ROOT_PASSWORD}@<连接地址>:3717/video_generator?authSource=admin"
echo ""
echo "  下一步："
echo "  1. 在阿里云控制台确认连接地址（或从上方输出获取）"
echo "  2. 更新 server/.env 中的 MONGODB_URI"
echo "  3. 在 ECS 上运行 npm install 安装 mongodb 驱动"
echo "  4. 重启服务端"
echo ""
