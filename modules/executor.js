// ================================================================
// 执行引擎 - 自动从任务队列拉取任务 → 调NapCat执行 → 记录结果
// ================================================================
import * as db from '../db.js';
import config from '../config.js';
import * as napcat from './napcat.js';
import * as accounts from './accounts.js';

let running = false;
let intervalId = null;
let stats = { executed:0, success:0, failed:0, lastRun:null };

// 启动执行引擎
export function start() {
  if (running) return;
  running = true;
  intervalId = setInterval(processQueue, 10000); // 每10秒检查一次
  const log = { time:new Date().toISOString(), type:'executor_start', detail:'执行引擎已启动' };
  const data = db.load();
  if (!data.events) data.events = [];
  data.events.push(log);
  db.save(data);
}

// 停止执行引擎
export function stop() {
  running = false;
  if (intervalId) clearInterval(intervalId);
  intervalId = null;
  const log = { time:new Date().toISOString(), type:'executor_stop', detail:'执行引擎已停止' };
  const data = db.load();
  if (!data.events) data.events = [];
  data.events.push(log);
  db.save(data);
}

// 获取状态
export function getStatus() {
  return { running, ...stats };
}

// 重置统计
export function resetStats() {
  stats = { executed:0, success:0, failed:0, lastRun:null };
}

// ===== 处理任务队列 =====
async function processQueue() {
  if (!running) return;
  const data = db.load();
  const tasks = data.tasks || [];
  const now = Date.now();

  // 找出待执行且到时间的任务
  const ready = tasks.filter(t => 
    t.status === 'pending' && t.scheduledAt && new Date(t.scheduledAt).getTime() <= now
  ).slice(0, 5);  // 每次最多处理5个

  for (const task of ready) {
    task.status = 'running';
    db.save(data);

    let result;
    if (task.type === 'send_msg') {
      // 查找对应的账号
      const account = data.accounts.find(a => a.id === task.accountId);
      if (!account) {
        task.status = 'failed';
        task.error = '账号不存在';
      } else {
        result = await napcat.sendPrivateMsg(task.target, task.content, account.qq);
        if (result.error) {
          task.status = 'failed';
          task.error = result.error;
        } else {
          task.status = 'done';
          task.doneAt = new Date().toISOString();
          accounts.recordAction(task.accountId, 'dm', task.targetId);
        }
      }
    } else if (task.type === 'send_group_msg') {
      result = await napcat.sendGroupMsg(task.target, task.content);
      if (result.error) {
        task.status = 'failed';
        task.error = result.error;
      } else {
        task.status = 'done';
        task.doneAt = new Date().toISOString();
        accounts.recordAction(task.accountId, 'groupChat');
      }
    } else if (task.type === 'join_group') {
      task.status = 'failed';
      task.error = '加群需手动操作';
    } else {
      task.status = 'failed';
      task.error = '未知任务类型';
    }

    // 模拟模式：如果没有启用NapCat，模拟执行结果
    if (task.status === 'running') {
      task.status = 'done';
      task.doneAt = new Date().toISOString();
      task.note = '模拟执行（NapCat未连接）';
    }

    stats.executed++;
    if (task.status === 'done') stats.success++;
    else stats.failed++;
    stats.lastRun = new Date().toISOString();

    db.save(data);
  }

  // 如果是模拟模式且有任务执行了，记录日志
  if (ready.length > 0) {
    const napcatCfg = napcat.getConfig();
    if (!napcatCfg.enabled) {
      console.log(`[执行器] 模拟执行 ${ready.length} 个任务 (NapCat未连接)`);
    }
  }
}

// ===== 手动执行单个任务 =====
export async function executeTask(taskId) {
  const data = db.load();
  const task = (data.tasks || []).find(t => t.id === taskId);
  if (!task) return { error: '任务不存在' };
  
  // 临时修改时间为现在
  task.scheduledAt = new Date().toISOString();
  db.save(data);
  
  // 执行一轮
  await processQueue();
  
  // 返回任务新状态
  const data2 = db.load();
  const updated = (data2.tasks || []).find(t => t.id === taskId);
  return updated || task;
}

export default { start, stop, getStatus, executeTask, resetStats };
