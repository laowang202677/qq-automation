// ================================================================
// 调度引擎：行为随机化 + 日间分布 + 冲突检测 + 温启动 + 消息追踪
// ================================================================
import * as db from '../db.js';
import config from '../config.js';
import * as accounts from './accounts.js';

// 今天日期
function today() { return new Date().toISOString().slice(0,10); }

// 当前时段
function getPeriod() {
  const h = new Date().getHours();
  if (h >= 10 && h < 12) return 'morning';
  if (h >= 14 && h < 17) return 'afternoon';
  if (h >= 19 && h < 22) return 'evening';
  return 'off';
}

// 是否在禁忌时段（由config控制，用户可配置）
function isDeadHour() {
  const dh = config.rules.behavior.deadHours || [];
  return dh.length > 0 && dh.includes(new Date().getHours());
}

// ===== 1. 随机化生成自然间隔（秒） =====
// 用半随机分布模拟人的不均匀节奏
export function randomInterval(type) {
  const base = {
    dm:        [30, 180],    // 私信：30秒-3分钟
    groupChat: [60, 300],    // 群聊：1-5分钟
    joinGroup: [180, 600],   // 加群：3-10分钟
    qzone:     [10, 60],     // 空间：10-60秒
  };
  const [min, max] = base[type] || [30, 120];
  // 正态分布偏向min，偶尔跳出到max
  const r = Math.random();
  if (r < 0.6) return min + Math.random() * (max - min) * 0.3;   // 60%概率短间隔
  if (r < 0.9) return min + Math.random() * (max - min) * 0.6;   // 30%概率中间隔
  return min + Math.random() * (max - min) * 1.5;                // 10%概率长间隔（上厕所）
}

// ===== 2. 获取账号当前时段可操作量 =====
export function getCurrentSlotLimit(account) {
  const limits = accounts.getDailyLimits(account);
  const dist = config.rules.behavior.dayDistribution;
  const period = getPeriod();
  // 不在操作时段
  if (period === 'off') return { dm:0, groupChat:0, joinGroup:0 };
  const factor = dist[period] || 0;
  return {
    dm: Math.round(limits.dm * factor),
    groupChat: Math.round(limits.groupChat * factor),
    joinGroup: Math.round(limits.joinGroup * factor)
  };
}

// ===== 3. 检查是否还能操作 =====
export function canOperate(account, type) {
  // 先更新生命周期（确保温启动阶段最新）
  if (typeof accounts.updateLifecycle === 'function') {
    accounts.updateLifecycle(account);
  }
  // 禁忌时段
  // 温启动阶段限制（由getDailyLimits自动更新生命周期）
  const limits = accounts.getDailyLimits(account);
  const current = account.today[type] || 0;
  if (current >= limits[type]) {
    return { ok:false, reason:`今日${type}已达上限(${current}/${limits[type]})` };
  }
  // 时段限制
  const slot = getCurrentSlotLimit(account);
  if ((slot[type] || 0) <= 0) return { ok:false, reason:'当前时段不安排此类型操作' };
  // 操作间隔
  const lastOp = account.lastOpAt ? account.lastOpAt[type] : null;
  if (lastOp) {
    const elapsed = (Date.now() - new Date(lastOp).getTime()) / 1000;
    const minInterval = type === 'joinGroup' ? config.rules.account.groupIntervalMin * 60 : config.rules.account.sendIntervalMin * 60;
    if (elapsed < minInterval) return { ok:false, reason:`操作间隔未到，还需${Math.ceil((minInterval - elapsed) / 60)}分钟` };
  }
  return { ok:true };
}

// ===== 4. 社交图谱冲突检测（推荐最佳操作账号） =====
export function findBestAccountForTarget(targetType, targetId) {
  const data = db.load();
  let candidates = data.accounts.filter(a => a.status === 'ready' || (a.status === 'breeding' && a.warmupStage !== 'zombie'));
  if (candidates.length === 0) return null;

  // 排除已操作过该目标的账号
  if (targetType === 'contact') {
    candidates = candidates.filter(a => !(a.contactedTargets || []).includes(targetId));
  }
  if (targetType === 'group') {
    candidates = candidates.filter(a => !(a.joinedGroups || []).includes(targetId));
  }
  if (candidates.length === 0) return null;

  // 按今日操作量最少的排序
  candidates.sort((a, b) => {
    const aTotal = (a.today?.dm || 0) + (a.today?.groupChat || 0) + (a.today?.joinGroup || 0);
    const bTotal = (b.today?.dm || 0) + (b.today?.groupChat || 0) + (b.today?.joinGroup || 0);
    return aTotal - bTotal;
  });

  // 再检查操作可行性
  for (const a of candidates) {
    const targetOp = targetType === 'contact' ? 'dm' : 'joinGroup';
    const check = canOperate(a, targetOp);
    if (check.ok) return a;
  }
  return null;
}

// ===== 5. 根据温启动阶段决定操作类型 =====
export function getNextActionType(account) {
  const stage = account.warmupStage;
  const mix = config.rules.behavior.actionMix;

  // 各阶段可用的操作类型
  const available = {
    zombie:  [],
    observe: ['groupChat'],
    test:    ['groupChat', 'dm'],
    normal:  ['dm', 'groupChat', 'qzone', 'joinGroup']
  };

  const types = available[stage] || ['dm'];
  if (types.length === 0) return null;

  // 按比例随机选择操作类型
  const weights = types.map(t => {
    const w = {
      dm:        mix.dm,
      groupChat: mix.groupChat,
      qzone:     mix.qzone,
      joinGroup: 0.3
    };
    return w[t] || 1;
  });
  const totalW = weights.reduce((a,b) => a+b, 0);
  let r = Math.random() * totalW;
  for (let i = 0; i < types.length; i++) {
    r -= weights[i];
    if (r <= 0) return types[i];
  }
  return types[types.length - 1];
}

// ===== 6. 消息状态追踪 =====
// 检查哪些消息需要回访（对方是否回复）
export function getMessagesToFollowUp(accountId) {
  const data = db.load();
  const contacts = (data.contacts || []).filter(c => c.accountId === accountId);
  return contacts.filter(c => {
    if (c.status === 'new' || c.status === 'chatting') {
      const lastContact = c.lastMsgAt ? new Date(c.lastMsgAt).getTime() : 0;
      const elapsed = Date.now() - lastContact;
      // 超过24小时没回复，但之前聊过 → 需要跟进
      return c.lastReplyAt && (Date.now() - new Date(c.lastReplyAt).getTime()) > 86400000;
    }
    return false;
  });
}

// ===== 7. 生成当日任务排期 =====
export function generateDailySchedule(accountId) {
  const data = db.load();
  const account = data.accounts.find(a => a.id === accountId);
  if (!account) return [];

  const stage = account.warmupStage;
  const schedule = [];
  const period = getPeriod();
  if (period === 'off') return [{ action:'休息', note:'禁忌时段，无任务' }];

  const actionTypes = stage === 'normal' ? ['dm', 'groupChat', 'qzone'] : ['groupChat'];
  for (const type of actionTypes) {
    const check = canOperate(account, type);
    if (check.ok) {
      schedule.push({ action: type, interval: randomInterval(type) });
    }
  }
  return schedule;
}

export default {
  randomInterval, getCurrentSlotLimit, canOperate,
  findBestAccountForTarget, getNextActionType,
  getMessagesToFollowUp, generateDailySchedule
};
