// ============================================================
// 账号管理模块 - 生命周期 + 温启动 + 操作追踪 + 冲突检测
// ============================================================
import * as db from '../db.js';
import config from '../config.js';

export const STATUS = {
  PENDING:   'pending',
  BREEDING:  'breeding',
  READY:     'ready',
  LIMITED:   'limited',
  BANNED:    'banned',
  RETIRED:   'retired'
};
export const WARMUP = {
  ZOMBIE:  'zombie',    // 僵尸期：只登录
  OBSERVE: 'observe',   // 观察期：少量群聊
  TEST:    'test',      // 试探期：少量私信
  NORMAL:  'normal'     // 正常期：全量操作
};
const WARMUP_LABELS = {
  zombie:  '🧟 僵尸期 3天',
  observe: '👀 观察期 4天',
  test:    '🔍 试探期 7天',
  normal:  '✅ 正常期'
};
const STATUS_LABELS = {
  pending:'待养号', breeding:'养号中', ready:'可用号',
  limited:'被限制', banned:'已封号', retired:'弃用'
};

// 批量导入账号
export function batchImport(qqList) {
  const data = db.load(); let count = 0;
  const now = new Date().toISOString();
  for (const item of qqList) {
    if (data.accounts.find(a => a.qq === item.qq)) continue;
    data.accounts.push({
      id: db.nextId(data), qq: item.qq, pwd: item.pwd || '', remark: item.remark || '',
      status: STATUS.PENDING, warmupStage: WARMUP.ZOMBIE,
      registeredAt: item.registeredAt || now, importedAt: now, warmupStartedAt: now,
      deviceId: '', ipAddr: '',
      // 每日操作计数
      today: { dm:0, groupChat:0, qzone:0, joinGroup:0 },
      // 累计操作计数
      total: { dm:0, groupChat:0, qzone:0, joinGroup:0 },
      // 最后操作时间追踪
      lastOpAt: {},    // { dm:'2026-07-13T10:00', groupChat:'...', joinGroup:'...' }
      // 历史关联的目标对象ID（防重复/防图谱关联）
      contactedTargets: [],  // 已私信过的联系人ID
      joinedGroups: [],      // 已加入的群ID
      banCount: 0, events: []
    });
    count++;
  }
  db.save(data);
  return { imported: count, total: data.accounts.length };
}

// 获取账号列表（自动更新状态+温启动阶段）
export function list(filter) {
  const data = db.load();
  let list = data.accounts;
  if (filter && filter.status) list = list.filter(a => a.status === filter.status);
  list.forEach(a => { updateLifecycle(a); });
  return list;
}

// 生命周期自动流转
function updateLifecycle(a) {
  const now = Date.now();
  const regTime = new Date(a.registeredAt).getTime();
  const warmStarted = new Date(a.warmupStartedAt || a.registeredAt).getTime();
  const totalDays = (now - regTime) / 86400000;
  const warmDays = (now - warmStarted) / 86400000;

  // 状态自动流转
  if (a.status === STATUS.PENDING && totalDays >= 0) a.status = STATUS.BREEDING;
  if (a.status === STATUS.BREEDING && totalDays >= config.rules.account.minAgeDays) a.status = STATUS.READY;

  // 温启动阶段自动流转
  const w = config.rules.warmup;
  if (warmDays < w.zombieDays) a.warmupStage = WARMUP.ZOMBIE;
  else if (warmDays < w.zombieDays + w.observeDays) a.warmupStage = WARMUP.OBSERVE;
  else if (warmDays < w.zombieDays + w.observeDays + w.testDays) a.warmupStage = WARMUP.TEST;
  else a.warmupStage = WARMUP.NORMAL;

  // 重置每日计数（如果跨天）
  const today = new Date().toISOString().slice(0,10);
  if (!a._date || a._date !== today) {
    a.today = { dm:0, groupChat:0, qzone:0, joinGroup:0 };
    a._date = today;
  }
}

// 获取各账号当前阶段可操作的最大量
export function getDailyLimits(account) {
  updateLifecycle(account);
  const w = config.rules.warmup;
  const b = config.rules.account;
  const stage = account.warmupStage || WARMUP.ZOMBIE;
  const stageLimits = {
    zombie:  { dm:0, groupChat:0, joinGroup:0 },
    observe: { dm:0, groupChat:w.observeActionsPerDay, joinGroup:1 },
    test:    { dm:w.testActionsPerDay, groupChat:w.observeActionsPerDay, joinGroup:1 },
    normal:  { dm:b.dailySendLimit, groupChat:5, joinGroup:b.dailyGroupLimit }
  };
  return stageLimits[stage] || stageLimits.normal;
}

// 检查某个账号能否对该目标操作（防图谱关联）
export function canOperateOnTarget(accountId, targetType, targetId) {
  const data = db.load();
  const account = data.accounts.find(a => a.id === accountId);
  if (!account) return false;

  if (targetType === 'group') {
    // 检查是否已有其他号加过该群
    const others = data.accounts.filter(a => a.id !== accountId);
    for (const other of others) {
      if ((other.joinedGroups || []).includes(targetId)) return false;
    }
    // 检查该号自己是否已加过
    return !(account.joinedGroups || []).includes(targetId);
  }

  if (targetType === 'contact') {
    const others = data.accounts.filter(a => a.id !== accountId);
    for (const other of others) {
      if ((other.contactedTargets || []).includes(targetId)) return { conflict:true, accountId:other.id, accountQQ:other.qq };
    }
    return !(account.contactedTargets || []).includes(targetId);
  }
  return true;
}

// 记录操作（扣减可操作量）
export function recordAction(accountId, type, targetId) {
  const data = db.load();
  const a = data.accounts.find(x => x.id === accountId);
  if (!a) return null;

  if (a.today[type] === undefined) a.today[type] = 0;
  a.today[type]++;
  if (!a.total) a.total = { dm:0, groupChat:0, qzone:0, joinGroup:0 };
  a.total[type] = (a.total[type] || 0) + 1;
  a.lastOpAt[type] = new Date().toISOString();

  // 记录关联目标
  if (type === 'dm' && targetId) {
    if (!a.contactedTargets) a.contactedTargets = [];
    if (!a.contactedTargets.includes(targetId)) a.contactedTargets.push(targetId);
  }
  if (type === 'joinGroup' && targetId) {
    if (!a.joinedGroups) a.joinedGroups = [];
    if (!a.joinedGroups.includes(targetId)) a.joinedGroups.push(targetId);
  }

  db.save(data);
  return a;
}

// 更新账号状态
export function updateStatusById(id, newStatus) {
  const data = db.load();
  const a = data.accounts.find(x => x.id === id);
  if (!a) return null;
  a.status = newStatus;
  // 如果是封号，记录事件
  if (newStatus === STATUS.BANNED) {
    if (!a.events) a.events = [];
    a.events.push({ time:new Date().toISOString(), type:'banned', detail:'手动标记封号' });
  }
  db.save(data);
  return a;
}

// 获取统计
export function getStats() {
  const data = db.load();
  const stats = {
    total: data.accounts.length, byStatus:{}, byWarmup:{},
    todayDm:0, todayGroup:0, healthy:0, banned:0
  };
  for (const a of data.accounts) {
    updateLifecycle(a);
    stats.byStatus[a.status] = (stats.byStatus[a.status] || 0) + 1;
    stats.byWarmup[a.warmupStage] = (stats.byWarmup[a.warmupStage] || 0) + 1;
    if (a.status === STATUS.READY || a.status === STATUS.BREEDING) stats.healthy++;
    if (a.status === STATUS.BANNED) stats.banned++;
    if (a.today) {
      stats.todayDm += a.today.dm || 0;
      stats.todayGroup += a.today.joinGroup || 0;
    }
  }
  return stats;
}

export function getBreedingProgress(account) {
  const now = Date.now();
  const reg = new Date(account.registeredAt).getTime();
  const ws = new Date(account.warmupStartedAt || account.registeredAt).getTime();
  const ageDays = Math.floor((now - reg) / 86400000);
  const warmDays = Math.floor((now - ws) / 86400000);
  const minDays = config.rules.account.minAgeDays;
  const safeDays = config.rules.account.safeAgeDays;
  const w = config.rules.warmup;
  const totalWarmDays = w.zombieDays + w.observeDays + w.testDays;
  return {
    ageDays, warmDays, minDays, safeDays,
    stage: account.warmupStage,
    progress: Math.min(100, Math.floor((warmDays / totalWarmDays) * 100)),
    canOperate: ageDays >= minDays,
    isSafe: ageDays >= safeDays
  };
}

// 导出供 scheduler 使用
export function updateLifecyclePublic(a) {
  updateLifecycle(a);
}

export { STATUS_LABELS, WARMUP_LABELS };
