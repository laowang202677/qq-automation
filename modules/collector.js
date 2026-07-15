// ================================================================
// 群采集模块 - 搜群/禁言检测/人数过滤/入库
// ================================================================
import * as db from '../db.js';
import config from '../config.js';

// 默认过滤规则
const FILTER = {
  minMembers: 50,       // 最少人数
  skipMuted: true,      // 跳过禁言群
  skipVerified: false,  // 不跳过认证群
};

// 创建群对象
function makeGroup(raw) {
  return {
    id: db.nextId(db.load()),
    groupNum: raw.groupNum || '',
    groupName: raw.groupName || '',
    memberCount: raw.memberCount || 0,
    maxMembers: raw.maxMembers || 500,
    isMuted: raw.isMuted || false,
    isVerified: raw.isVerified || false,
    keyword: raw.keyword || '',
    source: raw.source || 'manual',
    status: 'collected',    // collected/qualified/joined/failed
    filterReason: '',       // 不合格原因
    collectedAt: new Date().toISOString()
  };
}

// ===== 1. 批量录入搜索结果 =====
// 用户在QQ里搜完群，把结果粘贴进来
export function importRawResults(keyword, rawGroups) {
  const data = db.load();
  let imported = 0, filtered = 0;

  for (const g of rawGroups) {
    // 去重（按群号）
    if (data.groups.find(x => x.groupNum === g.groupNum)) continue;

    const group = makeGroup({ ...g, keyword });

    // 过滤：禁言群
    if (FILTER.skipMuted && group.isMuted) {
      group.status = 'failed';
      group.filterReason = '禁言群';
      filtered++;
    }
    // 过滤：人数不够
    else if (group.memberCount < FILTER.minMembers) {
      group.status = 'failed';
      group.filterReason = `人数不足(${group.memberCount}<${FILTER.minMembers})`;
      filtered++;
    }
    // 合格
    else {
      group.status = 'qualified';
    }

    data.groups.push(group);
    imported++;
  }

  db.save(data);
  return { imported, filtered, qualified: imported - filtered };
}

// ===== 2. 获取待加群的列表（合格、未加过） =====
export function getPendingGroups(limit = 20) {
  const data = db.load();
  // 去重：跳过 status=joined/failed 的，跳过已被账号加过的
  const joinedGroupIds = new Set();
  data.accounts.forEach(a => {
    (a.joinedGroups || []).forEach(gid => joinedGroupIds.add(gid));
  });

  return data.groups
    .filter(g => g.status === 'qualified' && !joinedGroupIds.has(g.id))
    .slice(0, limit);
}

// ===== 3. 标记群状态 =====
export function updateGroupStatus(groupId, newStatus, reason) {
  const data = db.load();
  const g = data.groups.find(x => x.id === groupId);
  if (!g) return null;
  g.status = newStatus;
  if (reason) g.filterReason = reason;
  db.save(data);
  return g;
}

// ===== 4. 统计 =====
export function getStats() {
  const data = db.load();
  const stats = { total:0, qualified:0, joined:0, failed:0, muted:0 };
  data.groups.forEach(g => {
    stats.total++;
    if (g.status === 'qualified') stats.qualified++;
    if (g.status === 'joined') stats.joined++;
    if (g.status === 'failed') stats.failed++;
    if (g.isMuted) stats.muted++;
  });
  return stats;
}

// ===== 5. 获取下一个要搜索的关键词（轮换策略） =====
export function getNextKeyword() {
  const data = db.load();
  const kws = config.searchKeywords || [];
  if (kws.length === 0) return null;

  // 记录已搜过的关键词
  const searched = new Set();
  data.groups.forEach(g => { if (g.keyword) searched.add(g.keyword); });

  // 找没搜过的
  const unsorted = kws.filter(k => !searched.has(k));
  if (unsorted.length > 0) return unsorted[Math.floor(Math.random() * unsorted.length)];
  return kws[Math.floor(Math.random() * kws.length)]; // 搜过的也轮换重搜
}

// ===== 6. 手动录入单条群（快速添加） =====
export function manualAdd(groupNum, groupName, memberCount, isMuted) {
  const data = db.load();
  if (data.groups.find(x => x.groupNum === groupNum)) return { error: '该群号已存在' };
  
  const g = makeGroup({ groupNum, groupName, memberCount, isMuted, source:'manual' });
  
  if (FILTER.skipMuted && g.isMuted) {
    g.status = 'failed';
    g.filterReason = '禁言群';
  } else if (memberCount < FILTER.minMembers) {
    g.status = 'failed';
    g.filterReason = `人数不足(${memberCount}<${FILTER.minMembers})`;
  } else {
    g.status = 'qualified';
  }
  
  data.groups.push(g);
  db.save(data);
  return { group: g };
}

export default { importRawResults, getPendingGroups, updateGroupStatus, getStats, getNextKeyword, manualAdd };
