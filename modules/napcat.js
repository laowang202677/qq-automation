// ================================================================
// NapCat API 客户端 - 通过HTTP控制QQ
// 安装NapCat后配置连接信息即可使用
// ================================================================

// 支持的NapCat API端点
const NAPCAT_ACTIONS = {
  sendPrivateMsg:    '/send_private_msg',       // 发送私聊消息
  sendGroupMsg:      '/send_group_msg',          // 发送群消息
  getGroupList:      '/get_group_list',          // 获取群列表
  getFriendList:     '/get_friend_list',         // 获取好友列表
  getGroupInfo:      '/get_group_info',          // 获取群信息
  setGroupAddRequest:'/set_group_add_request',   // 处理加群请求
};

let config = {
  enabled: false,
  baseUrl: 'http://127.0.0.1:3001',
  token: '',
  accounts: {}  // { 'QQ号': { port:3001, token:'' } }
};

// 更新配置
export function configure(cfg) {
  config = { ...config, ...cfg };
}

// 获取配置
export function getConfig() {
  return config;
}

// 调用NapCat HTTP API
async function callNapCat(action, params, port) {
  if (!config.enabled) return { error: 'NapCat未启用，请在设置中配置' };
  const baseUrl = port ? `http://127.0.0.1:${port}` : config.baseUrl;
  const url = `${baseUrl}${NAPCAT_ACTIONS[action]}`;

  const headers = { 'Content-Type': 'application/json' };
  if (config.token) headers['Authorization'] = `Bearer ${config.token}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(params)
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text.slice(0,200)}`);
    }
    return await res.json();
  } catch (e) {
    if (e.message.includes('fetch failed')) {
      return { error: `NapCat连接失败 (${baseUrl})，请确认NapCat已启动` };
    }
    return { error: e.message };
  }
}

// ===== 发送私信 =====
export async function sendPrivateMsg(userId, message, accountQQ) {
  const port = config.accounts[accountQQ]?.port;
  return callNapCat('sendPrivateMsg', { user_id: parseInt(userId), message }, port);
}

// ===== 发送群消息 =====
export async function sendGroupMsg(groupId, message, accountQQ) {
  const port = config.accounts[accountQQ]?.port;
  return callNapCat('sendGroupMsg', { group_id: parseInt(groupId), message }, port);
}

// ===== 加入群聊（发送加群申请） =====
export async function joinGroup(groupId, reason, accountQQ) {
  // NapCat暂不支持直接API加群，标记为待处理
  return { error: '加群操作需手动在QQ中完成，NapCat不支持该API' };
}

// ===== 测试连接 =====
export async function testConnection(port) {
  const result = await callNapCat('getFriendList', {}, port);
  if (result.error) return result;
  return { status: 'connected', message: 'NapCat连接成功' };
}

export default {
  configure, getConfig, sendPrivateMsg, sendGroupMsg, joinGroup, testConnection
};
