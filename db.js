// ============================================================
// JSON文件数据库 - 自动创建、读写、备份
// ============================================================
import fs from 'fs';
import config from './config.js';

const filePath = config.dataFile;

// 默认数据结构
const defaultData = {
  accounts: [],      // QQ账号列表
  groups: [],        // 目标群列表
  contacts: [],      // 联系人列表
  messages: [],      // 话术列表
  tasks: [],         // 任务队列
  events: [],        // 风控事件日志
  stats: {           // 每日统计
    date: '',
    groupsJoined: 0,
    messagesSent: 0,
    friendsAdded: 0
  },
  lastId: 0
};

// 读取数据
export function load() {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('读取数据失败，使用默认数据:', e.message);
  }
  return JSON.parse(JSON.stringify(defaultData));
}

// 保存数据
export function save(data) {
  const dir = filePath.substring(0, filePath.lastIndexOf('/'));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// 生成自增ID
export function nextId(data) {
  data.lastId++;
  return data.lastId;
}

// 获取今日统计（自动重置过期统计）
export function getStats(data) {
  const today = new Date().toISOString().slice(0, 10);
  if (data.stats.date !== today) {
    data.stats = { date: today, groupsJoined: 0, messagesSent: 0, friendsAdded: 0 };
    save(data);
  }
  return data.stats;
}

export default { load, save, nextId, getStats };
