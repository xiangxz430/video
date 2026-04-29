// 阿里云 MongoDB 实例创建脚本（Node.js 版）
// 直接调用阿里云 API，无需 aliyun CLI

const crypto = require('crypto');
const https = require('https');
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, 'create-mongodb-result.log');

function log(msg) {
  const line = typeof msg === 'object' ? JSON.stringify(msg, null, 2) : String(msg);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

// ========== 配置 ==========
const ACCESS_KEY_ID = process.env.ALIYUN_AK_ID || '';
const ACCESS_KEY_SECRET = process.env.ALIYUN_AK_SECRET || '';
if (!ACCESS_KEY_ID || !ACCESS_KEY_SECRET) {
  console.error('请先设置环境变量: export ALIYUN_AK_ID=xxx ALIYUN_AK_SECRET=xxx');
  process.exit(1);
}
const REGION = 'cn-beijing';

// ========== 阿里云 API 签名工具 ==========

function percentEncode(str) {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');
}

function hmacSha1(key, data) {
  return crypto.createHmac('sha1', key + '&').update(data).digest('base64');
}

function callApi(endpoint, action, extraParams, version) {
  const params = {
    Action: action,
    Format: 'JSON',
    Version: version || '2015-12-01',
    AccessKeyId: ACCESS_KEY_ID,
    SignatureMethod: 'HMAC-SHA1',
    Timestamp: new Date().toISOString().replace(/\.\d+Z/, 'Z'),
    SignatureVersion: '1.0',
    SignatureNonce: crypto.randomUUID(),
    ...Object.fromEntries(
      Object.entries(extraParams || {})
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)])
    ),
  };

  const sortedKeys = Object.keys(params).sort();
  const canonicalQuery = sortedKeys.map(k => `${percentEncode(k)}=${percentEncode(params[k])}`).join('&');
  const stringToSign = `GET&${percentEncode('/')}&${percentEncode(canonicalQuery)}`;
  const signature = hmacSha1(ACCESS_KEY_SECRET, stringToSign);
  const url = `https://${endpoint}/?${canonicalQuery}&Signature=${percentEncode(signature)}`;

  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ raw: data }); }
      });
    }).on('error', reject);
  });
}

function ddsApi(action, extraParams) {
  return callApi(`dds.${REGION}.aliyuncs.com`, action, extraParams, '2015-12-01');
}

function vpcApi(action, extraParams) {
  return callApi(`vpc.${REGION}.aliyuncs.com`, action, extraParams, '2016-04-28');
}

// ========== 主流程 ==========

async function main() {
  log('===== Step 1: 查询可用区 =====');
  const regions = await ddsApi('DescribeRegions', { RegionId: REGION });
  log('Regions响应: ' + JSON.stringify(regions));
  const regionList = regions?.Regions?.DdsRegion || [];
  const beijingRegion = regionList.find(r => r.RegionId === REGION);
  const zoneId = beijingRegion?.Zones?.[0]?.ZoneId || 'cn-beijing-g';
  log(`选择可用区: ${zoneId}`);

  // Step 2: 查询 VPC
  log('\n===== Step 2: 查询 VPC =====');
  const vpcResult = await vpcApi('DescribeVpcs', { RegionId: REGION });
  log('VPC响应: ' + JSON.stringify(vpcResult));
  const vpcs = vpcResult?.Vpcs?.Vpc || [];
  if (vpcs.length === 0) {
    console.log('未找到 VPC，请先在阿里云控制台创建 VPC');
    process.exit(1);
  }
  const vpcId = vpcs[0].VpcId;
  log(`使用 VPC: ${vpcId}`);

  // Step 3: 查询 VSwitch
  log('\n===== Step 3: 查询 VSwitch =====');
  const vswResult = await vpcApi('DescribeVSwitches', { RegionId: REGION, VpcId: vpcId });
  log('VSwitch响应: ' + JSON.stringify(vswResult));
  const vswitches = vswResult?.VSwitches?.VSwitch || [];
  if (vswitches.length === 0) {
    console.log('未找到 VSwitch，请先在阿里云控制台创建 VSwitch');
    process.exit(1);
  }
  // 选一个和 zoneId 匹配的 VSwitch
  const matchedVsw = vswitches.find(v => v.ZoneId === zoneId) || vswitches[0];
  const vswitchId = matchedVsw.VSwitchId;
  const finalZoneId = matchedVsw.ZoneId;
  log(`使用 VSwitch: ${vswitchId}, Zone: ${finalZoneId}`);

  // Step 4: 创建 MongoDB 实例
  log('\n===== Step 4: 创建 MongoDB 副本集实例 =====');
  const createParams = {
    RegionId: REGION,
    ZoneId: finalZoneId,
    EngineVersion: '4.4',
    DBInstanceClass: 'mdb.shard.2x.large.c',
    DBInstanceStorage: 20,
    StorageType: 'cloud_essd1',
    ChargeType: 'PostPaid',
    NetworkType: 'VPC',
    VpcId: vpcId,
    VSwitchId: vswitchId,
    ReplicationFactor: '3',
    DBInstanceDescription: 'video-generator-mongodb-logs',
    AccountPassword: 'VgMongo2026!Aa',
    SecurityIPList: '0.0.0.0/0',
    Engine: 'MongoDB',
  };
  log('创建参数:');
  log(createParams);

  const result = await ddsApi('CreateDBInstance', createParams);
  log('\n创建结果:');
  log(result);

  if (result.DBInstanceId) {
    const instanceId = result.DBInstanceId;
    log(`\n✅ 实例创建请求已提交！ID: ${instanceId}`);

    // Step 5: 等待就绪
    log('\n===== Step 5: 等待实例创建完成（约5-10分钟）=====');
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 20000));
      const status = await ddsApi('DescribeDBInstanceAttribute', { DBInstanceId: instanceId });
      const state = status?.DBInstances?.DBInstance?.[0]?.DBInstanceStatus;
      log(`[${(i + 1) * 20}s] 状态: ${state}`);
      if (state === 'Running') {
        log('\n✅ 实例已就绪！');

        // Step 6: 获取连接信息
        const detail = await ddsApi('DescribeDBInstanceAttribute', { DBInstanceId: instanceId });
        const instance = detail?.DBInstances?.DBInstance?.[0];
        log('\n============================================');
        log('  MongoDB 实例创建完成！');
        log('============================================');
        log(`  实例 ID:   ${instanceId}`);
        log(`  连接地址:  ${instance?.ConnectionDomain || '请到控制台查看'}`);
        log(`  端口:      ${instance?.Port || '3717'}`);
        log('  root 密码: VgMongo2026!Aa');
        log('  数据库名:  video_generator');
        log('');
        log('  连接串（更新到 server/.env 的 MONGODB_URI）：');
        log(`  mongodb://root:VgMongo2026!Aa@${instance?.ConnectionDomain || '<连接地址>'}:${instance?.Port || '3717'}/video_generator?authSource=admin`);
        break;
      }
    }
  } else {
    log('\n❌ 创建失败！');
    log('错误码: ' + result.Code);
    log('错误信息: ' + result.Message);
    if (result.Message && result.Message.includes('VPC')) {
      console.log('\n提示: VPC/VSwitch 不匹配，请检查可用区是否一致');
    }
  }
}

main().catch(console.error);
