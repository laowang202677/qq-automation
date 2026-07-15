// ================================================================
// 自适应规则引擎 - 根据实际效果自动调整风控参数
// 不需要AI也能跑（基于统计的自调整算法）
// 配置AI后获得深度分析建议
// ================================================================
import * as db from '../db.js';
import config from '../config.js';
import * as ai from './ai.js';

// 调整历史记录
let adjustments = [];
let lastAdjustAt = null;
let currentStatus = {
  mode: 'normal',    // normal / cautious / stopped
  banRate: 0,
  deliveryRate: 1,
  replyRate: 0,
  activeAccounts: 0,
  totalAccounts: 0
};

// ===== 1. 收集当前运行数据 =====
function collectStats() {
  const data = db.load();
  const now = Date.now();
  const oneDayAgo = now - 86400000;
  const oneHourAgo = now - 3600000;

  const accounts = data.accounts || [];
  const totalAccounts = accounts.length;
  const banned = accounts.filter(a => a.status === 'banned').length;
  const banRate24h = totalAccounts > 0 ? banned / totalAccounts : 0;

  // 计算近期封号率（24小时内封禁的）
  const recentBans = accounts.filter(a => {
    const lastEvent = (a.events || []).slice(-1)[0];
    return lastEvent && lastEvent.type === 'banned' && new Date(lastEvent.time).getTime() > oneDayAgo;
  }).length;
  const recentBanRate = totalAccounts > 0 ? recentBans / totalAccounts : 0;

  // 计算发送成功率
  const events = (data.events || []).slice(-100);
  const recentEvents = events.filter(e => new Date(e.time).getTime() > oneHourAgo);
  const sendAttempts = recentEvents.filter(e => e.type === 'send_msg').length;
  const sendSuccess = recentEvents.filter(e => e.type === 'send_msg' && !e.error).length;
  const deliveryRate = sendAttempts > 0 ? sendSuccess / sendAttempts : 1;

  // 计算回复率
  const contacts = data.contacts || [];
  const totalSent = contacts.length;
  const withReplies = contacts.filter(c => c.lastReplyAt).length;
  const replyRate = totalSent > 0 ? withReplies / totalSent : 0;

  const activeAccounts = accounts.filter(a =>
    a.status === 'ready' || (a.status === 'breeding' && a.warmupStage !== 'zombie')
  ).length;

  return {
    totalAccounts,
    banned, recentBans,
    recentBanRate, deliveryRate, replyRate,
    activeAccounts,
    sendAttempts, sendSuccess
  };
}

// ===== 2. 根据数据自动调整参数 =====
function autoAdjust(stats) {
  const rules = config.rules;
  let changed = false;
  let reasons = [];

  // 决策树：根据封号率调整
  if (stats.recentBanRate > 0.5) {
    // 封号率 > 50%: 立即停止所有操作
    if (currentStatus.mode !== 'stopped') {
      currentStatus.mode = 'stopped';
      rules.account.dailySendLimit = 0;
      rules.account.dailyGroupLimit = 0;
      changed = true;
      reasons.push(`封号率${(stats.recentBanRate*100).toFixed(0)}% > 50%，已停止所有操作`);
    }
  } else if (stats.recentBanRate > 0.2) {
    // 封号率 > 20%: 收紧限额
    if (currentStatus.mode !== 'cautious' || rules.account.dailySendLimit > 5) {
      currentStatus.mode = 'cautious';
      rules.account.dailySendLimit = Math.min(rules.account.dailySendLimit, 5);
      rules.account.dailyGroupLimit = 1;
      rules.account.sendIntervalMin = Math.max(rules.account.sendIntervalMin, 10);
      changed = true;
      reasons.push(`封号率${(stats.recentBanRate*100).toFixed(0)}% > 20%，已收紧限额和间隔`);
    }
  } else if (stats.recentBanRate < 0.05 && currentStatus.mode === 'cautious') {
    // 封号率恢复正常，逐步恢复
    currentStatus.mode = 'normal';
    rules.account.dailySendLimit = 10;
    rules.account.dailyGroupLimit = 2;
    rules.account.sendIntervalMin = 5;
    changed = true;
    reasons.push(`封号率已降至${(stats.recentBanRate*100).toFixed(0)}%，逐步恢复限额`);
  }

  // 发送成功率过低 → 减小每日总量
  if (stats.deliveryRate < 0.5 && rules.account.dailySendLimit > 3) {
    rules.account.dailySendLimit = Math.max(3, Math.floor(rules.account.dailySendLimit * 0.5));
    changed = true;
    reasons.push(`发送成功率仅${(stats.deliveryRate*100).toFixed(0)}%，已减半每日私信量`);
  }

  if (changed) {
    const record = {
      time: new Date().toISOString(),
      mode: currentStatus.mode,
      limits: {
        send: rules.account.dailySendLimit,
        group: rules.account.dailyGroupLimit,
        interval: rules.account.sendIntervalMin
      },
      reasons
    };
    adjustments.push(record);
    lastAdjustAt = record.time;
    currentStatus = { ...currentStatus, ...stats };
    return record;
  }
  return null;
}

// ===== 3. AI增强分析 =====
async function aiAnalyze() {
  const data = db.load();
  const cfg = config.ai;
  if (!cfg.apiKey) return { error: 'AI未配置，跳过分析' };

  const stats = collectStats();
  const recentAdjustments = adjustments.slice(-5);

  const prompt = `你是一个QQ自动化风控分析师。分析以下运行数据，给出具体的参数调整建议。

运行统计（过去24小时）：
- 总账号数: ${stats.totalAccounts}
- 活跃账号: ${stats.activeAccounts}
- 封禁数: ${stats.banned}
- 24h封禁率: ${(stats.recentBanRate*100).toFixed(1)}%
- 发送成功率: ${(stats.deliveryRate*100).toFixed(1)}%
- 回复率: ${(stats.replyRate*100).toFixed(1)}%
- 近期发送尝试: ${stats.sendAttempts}次

当前参数：
- 每日私信上限: ${config.rules.account.dailySendLimit}
- 每日加群上限: ${config.rules.account.dailyGroupLimit}
- 私信间隔(分钟): ${config.rules.account.sendIntervalMin}
- 当前模式: ${currentStatus.mode}

近期调整记录：
${recentAdjustments.map(a => `- ${a.time.slice(11,16)}: ${a.reasons.join('; ')}`).join('\n')}

请输出以下格式（每行一个建议，用|分隔）：
建议调整|调整原因|预期效果`;

  const result = await ai.callLLM('你是一个QQ风控分析师。', prompt, 0.3);
  return result;
}

// ===== 4. 执行一次评估 =====
export function evaluate() {
  const stats = collectStats();
  const result = autoAdjust(stats);
  return {
    stats,
    adjustment: result,
    currentMode: currentStatus.mode,
    currentLimits: {
      dailySend: config.rules.account.dailySendLimit,
      dailyGroup: config.rules.account.dailyGroupLimit,
      sendInterval: config.rules.account.sendIntervalMin
    }
  };
}

// ===== 5. AI分析（外部调用） =====


// ===== 6. 获取状态 =====
export function getStatus() {
  return {
    ...currentStatus,
    lastAdjustAt,
    adjustmentCount: adjustments.length,
    recentAdjustments: adjustments.slice(-5),
    currentLimits: {
      send: config.rules.account.dailySendLimit,
      group: config.rules.account.dailyGroupLimit,
      interval: config.rules.account.sendIntervalMin
    }
  };
}

// ===== 7. 重置 =====
export function reset() {
  adjustments = [];
  lastAdjustAt = null;
  currentStatus = { mode:'normal', banRate:0, deliveryRate:1, replyRate:0, activeAccounts:0, totalAccounts:0 };
}

export default { evaluate, getStatus, aiAnalysis: aiAnalyze, reset };
