// ================================================================
// QQ号注册模块 - 对接5sim接码平台
// 半自动流程：系统拿号码→用户填表→系统收验证码→自动入库
// ================================================================
import * as db from '../db.js';
import * as accounts from './accounts.js';

const CONFIG = {
  provider: 'manual',     // manual / 5sim
  apiKey: '',             // 5sim API Key
  country: 'china',       // 国家
  operator: 'any',        // 运营商
  product: 'qq'           // 产品
};

// 更新配置
export function configure(cfg) {
  Object.assign(CONFIG, cfg);
}

export function getConfig() {
  return { ...CONFIG };
}

// ===== 1. 向5sim请求一个手机号 =====
async function requestPhone5sim() {
  const url = `https://5sim.net/v1/user/buy/activation/${CONFIG.country}/${CONFIG.operator}/${CONFIG.product}`;
  try {
    const res = await fetch(url, {
      headers: { 'Authorization': 'Bearer ' + CONFIG.apiKey }
    });
    if (!res.ok) return { error: `5sim请求失败: HTTP ${res.status}` };
    const data = await res.json();
    return {
      phone: data.phone,
      orderId: data.id,
      country: data.country,
      operator: data.operator
    };
  } catch (e) {
    return { error: '连接5sim失败: ' + e.message };
  }
}

// ===== 2. 查询验证码 =====
async function checkSms5sim(orderId) {
  const url = `https://5sim.net/v1/user/check/${orderId}`;
  try {
    const res = await fetch(url, {
      headers: { 'Authorization': 'Bearer ' + CONFIG.apiKey }
    });
    if (!res.ok) return { error: `查询失败: HTTP ${res.status}` };
    const data = await res.json();
    // 提取验证码（通常是4-6位数字）
    if (data.sms && data.sms.length > 0) {
      const sms = data.sms[0];
      // 从短信内容中提取验证码
      const code = sms.text.match(/\d{4,6}/);
      return { code: code ? code[0] : sms.text, sms: sms.text, createdAt: sms.created_at };
    }
    return { code: null, status: 'waiting', message: '暂未收到验证码' };
  } catch (e) {
    return { error: '查询失败: ' + e.message };
  }
}

// ===== 3. 创建注册任务 =====
export function createTask() {
  const data = db.load();
  if (!data.registrationTasks) data.registrationTasks = [];
  const task = {
    id: db.nextId(data),
    status: 'pending',  // pending/got_number/waiting_code/done/failed
    phoneNumber: '',
    countryCode: CONFIG.country,
    orderId: null,
    verificationCode: '',
    registeredQQ: '',
    smsContent: '',
    createdAt: new Date().toISOString(),
    completedAt: null,
    error: ''
  };
  data.registrationTasks.push(task);
  db.save(data);
  return task;
}

// ===== 4. 获取手机号 =====
export async function getPhone(taskId) {
  const data = db.load();
  const task = (data.registrationTasks || []).find(t => t.id === taskId);
  if (!task) return { error: '任务不存在' };

  if (CONFIG.provider === '5sim' && CONFIG.apiKey) {
    const result = await requestPhone5sim();
    if (result.error) return result;
    task.phoneNumber = result.phone;
    task.orderId = result.orderId;
    task.status = 'got_number';
    db.save(data);
    return result;
  }

  // 手动模式：用户自己输入手机号
  task.status = 'got_number';
  db.save(data);
  return { phone: null, manual: true, message: '请手动输入手机号' };
}

// ===== 5. 手动填入手机号 =====
export function setPhone(taskId, phoneNumber) {
  const data = db.load();
  const task = (data.registrationTasks || []).find(t => t.id === taskId);
  if (!task) return { error: '任务不存在' };
  task.phoneNumber = phoneNumber;
  task.status = 'got_number';
  db.save(data);
  return { ok: true };
}

// ===== 6. 检查验证码 =====
export async function checkCode(taskId) {
  const data = db.load();
  const task = (data.registrationTasks || []).find(t => t.id === taskId);
  if (!task) return { error: '任务不存在' };

  if (CONFIG.provider === '5sim' && task.orderId) {
    const result = await checkSms5sim(task.orderId);
    if (result.error) return result;
    if (result.code) {
      task.verificationCode = result.code;
      task.smsContent = result.sms || '';
      task.status = 'waiting_code';
      db.save(data);
    }
    return result;
  }

  return { code: null, manual: true, message: '请手动输入收到的验证码' };
}

// ===== 7. 手动填入验证码 =====
export function setCode(taskId, code) {
  const data = db.load();
  const task = (data.registrationTasks || []).find(t => t.id === taskId);
  if (!task) return { error: '任务不存在' };
  task.verificationCode = code;
  task.status = 'waiting_code';
  db.save(data);
  return { ok: true };
}

// ===== 8. 注册完成，导入账号池 =====
export function completeRegistration(taskId, qqNumber, password) {
  const data = db.load();
  const task = (data.registrationTasks || []).find(t => t.id === taskId);
  if (!task) return { error: '任务不存在' };

  task.registeredQQ = qqNumber;
  task.status = 'done';
  task.completedAt = new Date().toISOString();
  db.save(data);

  // 自动导入到账号池
  const result = accounts.batchImport([{ qq: qqNumber, pwd: password || '', remark: '自注册' }]);
  return { ok: true, imported: result.imported };
}

// ===== 9. 标记失败 =====
export function failTask(taskId, reason) {
  const data = db.load();
  const task = (data.registrationTasks || []).find(t => t.id === taskId);
  if (!task) return { error: '任务不存在' };
  task.status = 'failed';
  task.error = reason;
  task.completedAt = new Date().toISOString();
  db.save(data);
  return { ok: true };
}

// ===== 10. 获取任务列表 =====
export function listTasks() {
  const data = db.load();
  return (data.registrationTasks || []).slice().reverse();
}

// ===== 11. 统计 =====
export function getStats() {
  const data = db.load();
  const tasks = data.registrationTasks || [];
  return {
    total: tasks.length,
    pending: tasks.filter(t => t.status === 'pending').length,
    gotNumber: tasks.filter(t => t.status === 'got_number').length,
    waitingCode: tasks.filter(t => t.status === 'waiting_code').length,
    done: tasks.filter(t => t.status === 'done').length,
    failed: tasks.filter(t => t.status === 'failed').length
  };
}

export default {
  configure, getConfig,
  createTask, getPhone, setPhone, checkCode, setCode,
  completeRegistration, failTask, listTasks, getStats
};


// ================================================================
// 录制与回放 - 通过模拟器自动注册QQ
// ================================================================
import * as adb from './adb.js';

// ---- 录制 ----
// 录制步骤格式
// { type:'tap'|'input'|'swipe'|'wait', selector:'按钮文字', value:'输入内容', waitMs:2000, desc:'描述' }

export const RECORD = {
  steps: [],
  isRecording: false,
  name: ''
};

// 开始录制
export function startRecord(name) {
  RECORD.steps = [];
  RECORD.isRecording = true;
  RECORD.name = name;
  RECORD.steps.push({ type:'wait', waitMs:2000, desc:'等待QQ启动' });
  return { ok: true };
}

// 添加录制步骤（人工标记）
export function addRecordStep(type, selector, value, waitMs, desc) {
  if (!RECORD.isRecording) return { error: '未在录制状态' };
  RECORD.steps.push({ type, selector, value: value || '', waitMs: waitMs || 2000, desc });
  return { ok: true, step: RECORD.steps.length };
}

// 结束录制
export function stopRecord() {
  RECORD.isRecording = false;
  const data = db.load();
  if (!data.recordingFlows) data.recordingFlows = [];
  const flow = {
    id: db.nextId(data),
    name: RECORD.name,
    steps: [...RECORD.steps],
    version: 1,
    createdAt: new Date().toISOString()
  };
  data.recordingFlows.push(flow);
  db.save(data);
  RECORD.steps = [];
  return { flow };
}

// 获取录制的流程列表
export function listFlows() {
  const data = db.load();
  return (data.recordingFlows || []).slice().reverse();
}

// ---- 回放 ----
export async function playback(flowId, phoneNumber, password) {
  const data = db.load();
  const flow = (data.recordingFlows || []).find(f => f.id === flowId);
  if (!flow) return { error: '流程不存在' };

  // 先连接模拟器
  const conn = adb.connect();
  if (conn.error) return conn;

  const task = createTask();
  const results = [];
  let code = '';
  let registeredQQ = '';

  for (const step of flow.steps) {
    // 替换变量
    let value = step.value
      .replace(/\${PHONE}/g, phoneNumber)
      .replace(/\${CODE}/g, code)
      .replace(/\${PASSWORD}/g, password || 'qq123456');

    try {
      if (step.type === 'wait') {
        await sleep(step.waitMs || 2000);
        results.push({ step: step.desc, status: 'ok' });
      } else if (step.type === 'tap') {
        if (step.selector) {
          const r = adb.tapText(step.selector);
          results.push({ step: step.desc, status: r.error ? 'warn:manual' : 'ok', note: r.error });
        } else {
          results.push({ step: step.desc, status: 'warn:no_selector' });
        }
        await sleep(step.waitMs || 1000);
      } else if (step.type === 'input') {
        adb.tapText(step.selector);
        await sleep(500);
        adb.inputText(value);
        results.push({ step: step.desc, status: 'ok' });
        await sleep(step.waitMs || 1000);
      } else {
        results.push({ step: step.desc, status: 'warn:unknown_type' });
      }
    } catch (e) {
      results.push({ step: step.desc, status: 'error', note: e.message });
    }

    // 检查验证码（在发送验证码步骤后自动获取）
    if (step.desc && step.desc.includes('验证码')) {
      const smsResult = await checkCode(task.id);
      if (smsResult.code) {
        code = smsResult.code;
        // 自动填入验证码到某一步
      }
    }
  }

  // 注册完成
  results.push({ step: '注册流程结束，请在界面确认QQ号', status: 'info' });

  return { taskId: task.id, results, flowName: flow.name };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// 导出录制相关
