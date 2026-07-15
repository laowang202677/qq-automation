// ============================================================
// QQ自动化系统 - 管理服务
// ============================================================
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import config from './config.js';
import db from './db.js';
import * as accounts from './modules/accounts.js';
import * as scheduler from './modules/scheduler.js';
import * as ai from './modules/ai.js';
import * as collector from './modules/collector.js';
import * as executor from './modules/executor.js';
import * as napcat from './modules/napcat.js';
import * as adaptive from './modules/adaptive.js';
import * as registrar from './modules/registrar.js';
import * as adb from './modules/adb.js';

const __dirname = typeof __dirname !== "undefined" ? __dirname : path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
// 禁止HTML缓存，确保页面始终最新
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path === '/') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

// ======================== API: 账号管理 ========================

// 获取账号列表
app.get('/api/accounts', (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  const list = accounts.list(filter);
  res.json(list);
});

// 批量导入账号
app.post('/api/accounts/import', (req, res) => {
  const { qqList } = req.body;
  if (!qqList || !Array.isArray(qqList)) {
    return res.status(400).json({ error: '需要qqList数组' });
  }
  const result = accounts.batchImport(qqList);
  res.json(result);
});

// 更新账号状态
app.put('/api/accounts/:id/status', (req, res) => {
  const id = parseInt(req.params.id);
  const { status } = req.body;
  const account = accounts.updateStatusById(id, status);
  if (!account) return res.status(404).json({ error: '账号不存在' });
  res.json(account);
});

// 删除账号
app.delete('/api/accounts/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const data = db.load();
  const idx = data.accounts.findIndex(a => a.id === id);
  if (idx === -1) return res.status(404).json({ error: '账号不存在' });
  data.accounts.splice(idx, 1);
  db.save(data);
  res.json({ ok: true });
});

// 获取账号统计数据
app.get('/api/accounts/stats', (req, res) => {
  const stats = accounts.getStats();
  res.json(stats);
});

// 获取单个账号详情（含养号进度）
app.get('/api/accounts/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const data = db.load();
  const acc = data.accounts.find(a => a.id === id);
  if (!acc) return res.status(404).json({ error: '账号不存在' });
  const progress = accounts.getBreedingProgress(acc);
  res.json({ ...acc, progress });
});

// ======================== API: 目标群 ========================

app.get('/api/groups', (req, res) => {
  const data = db.load();
  res.json(data.groups);
});

app.post('/api/groups', (req, res) => {
  const data = db.load();
  const g = req.body;
  g.id = db.nextId(data);
  g.createdAt = new Date().toISOString();
  g.status = 'pending'; // pending / joined / rejected / banned
  data.groups.push(g);
  db.save(data);
  res.json(g);
});

app.put('/api/groups/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const data = db.load();
  const g = data.groups.find(x => x.id === id);
  if (!g) return res.status(404).json({ error: '不存在' });
  Object.assign(g, req.body);
  db.save(data);
  res.json(g);
});

// ======================== API: 任务 ========================

app.get('/api/tasks', (req, res) => {
  const data = db.load();
  const tasks = data.tasks || [];
  // 按排期时间排序
  tasks.sort((a, b) => new Date(a.scheduledAt || 0) - new Date(b.scheduledAt || 0));
  res.json(tasks);
});

app.post('/api/tasks', (req, res) => {
  const data = db.load();
  const task = req.body;
  task.id = db.nextId(data);
  task.createdAt = new Date().toISOString();
  task.status = task.status || 'pending';
  if (!data.tasks) data.tasks = [];
  data.tasks.push(task);
  db.save(data);
  res.json(task);
});

app.put('/api/tasks/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const data = db.load();
  const t = (data.tasks || []).find(x => x.id === id);
  if (!t) return res.status(404).json({ error: '不存在' });
  Object.assign(t, req.body);
  db.save(data);
  res.json(t);
});

// ======================== API: 话术 ========================

app.get('/api/messages', (req, res) => {
  const data = db.load();
  res.json(data.messages || []);
});

app.post('/api/messages', (req, res) => {
  const data = db.load();
  const msg = req.body;
  msg.id = db.nextId(data);
  msg.createdAt = new Date().toISOString();
  if (!data.messages) data.messages = [];
  data.messages.push(msg);
  db.save(data);
  res.json(msg);
});

app.delete('/api/messages/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const data = db.load();
  const idx = (data.messages || []).findIndex(m => m.id === id);
  if (idx === -1) return res.status(404).json({ error: '不存在' });
  data.messages.splice(idx, 1);
  db.save(data);
  res.json({ ok: true });
});

// ======================== API: 系统状态 ========================

app.get('/api/status', (req, res) => {
  const data = db.load();
  res.json({
    uptime: process.uptime(),
    accountCount: data.accounts.length,
    groupCount: data.groups.length,
    taskCount: (data.tasks || []).length,
    messageCount: (data.messages || []).length,
    today: new Date().toISOString().slice(0, 10)
  });
});

app.get('/api/config', (req, res) => {
  res.json(config);
});

app.put('/api/config', (req, res) => {
  if (req.body.rules) Object.assign(config.rules, req.body.rules);
  if (req.body.searchKeywords) config.searchKeywords = req.body.searchKeywords;
  if (req.body.ai) Object.assign(config.ai, req.body.ai);
  res.json({ ok: true });
});


// ======================== API: AI引擎 ========================

// 测试AI连接
app.post('/api/ai/test', async (req, res) => {
  const result = await ai.testConnection();
  res.json(result);
});

// 话术改写
app.post('/api/ai/rewrite', async (req, res) => {
  const { content, scene } = req.body;
  if (!content) return res.status(400).json({ error: '需要content参数' });
  const result = await ai.rewriteMessage(content, scene || 'first');
  res.json(result);
});

// 跟进判断
app.post('/api/ai/analyze-followup', async (req, res) => {
  const { conversation } = req.body;
  if (!conversation) return res.status(400).json({ error: '需要conversation参数' });
  const result = await ai.analyzeFollowUp(conversation);
  res.json(result);
});

// 温启动分析
app.get('/api/ai/warmup-analysis/:id', async (req, res) => {
  const data = db.load();
  const account = data.accounts.find(a => a.id === parseInt(req.params.id));
  if (!account) return res.status(404).json({ error: '账号不存在' });
  const result = await ai.analyzeWarmup(account);
  res.json(result);
});

// 获取AI配置
app.get('/api/ai/config', (req, res) => {
  res.json({ provider: config.ai.provider, model: config.ai.model, keyConfigured: !!config.ai.apiKey });
});

// ======================== API: 任务调度器 ========================

// 获取账号实时调度状态
app.get('/api/scheduler/status/:id', (req, res) => {
  const data = db.load();
  const id = parseInt(req.params.id);
  const a = data.accounts.find(x => x.id === id);
  if (!a) return res.status(404).json({ error: '不存在' });
  const progress = accounts.getBreedingProgress(a);
  const limits = accounts.getDailyLimits(a);
  const slotLimit = scheduler.getCurrentSlotLimit(a);
  const canOp = scheduler.canOperate(a, 'dm');
  const nextAction = scheduler.getNextActionType(a);
  const schedule = scheduler.generateDailySchedule(id);
  res.json({ progress, limits, slotLimit, canOperate:canOp, nextAction, schedule });
});

// 获取所有账号的调度摘要
app.get('/api/scheduler/summary', (req, res) => {
  const data = db.load();
  const summaries = data.accounts.map(a => {
    const limits = accounts.getDailyLimits(a);
    const slotLimit = scheduler.getCurrentSlotLimit(a);
    return {
      id: a.id, qq: a.qq, status: a.status, warmupStage: a.warmupStage,
      today: { dm: a.today?.dm || 0, groupChat: a.today?.groupChat || 0, joinGroup: a.today?.joinGroup || 0 },
      limits: { dm: limits.dm, groupChat: limits.groupChat, joinGroup: limits.joinGroup },
      slotLimit: { dm: slotLimit.dm, groupChat: slotLimit.groupChat, joinGroup: slotLimit.joinGroup },
      lastOp: a.lastOpAt || {}
    };
  });
  res.json(summaries);
});

// 冲突检测：推荐最佳账号操作某个目标
app.get('/api/scheduler/find-best', (req, res) => {
  const { targetType, targetId } = req.query;
  if (!targetType || !targetId) return res.status(400).json({ error: '需要targetType和targetId' });
  const best = scheduler.findBestAccountForTarget(targetType, parseInt(targetId));
  if (!best) return res.json({ found: false, reason: '无可用的账号，可能所有账号已接触过该目标' });
  res.json({ found: true, account: { id: best.id, qq: best.qq, warmupStage: best.warmupStage } });
});

// 记录一次操作
app.post('/api/scheduler/record-action', (req, res) => {
  const { accountId, type, targetId } = req.body;
  const result = accounts.recordAction(parseInt(accountId), type, targetId ? parseInt(targetId) : undefined);
  if (!result) return res.status(404).json({ error: '账号不存在' });
  res.json({ ok: true, today: result.today });
});

// ======================== API: 联系人（含消息追踪） ========================

app.get('/api/contacts', (req, res) => {
  const data = db.load();
  res.json(data.contacts || []);
});

app.post('/api/contacts', (req, res) => {
  const data = db.load();
  const c = req.body;
  c.id = db.nextId(data);
  c.createdAt = new Date().toISOString();
  c.lastMsgAt = null;
  c.lastReplyAt = null;
  if (!data.contacts) data.contacts = [];
  data.contacts.push(c);
  db.save(data);
  res.json(c);
});

app.put('/api/contacts/:id', (req, res) => {
  const data = db.load();
  const id = parseInt(req.params.id);
  const c = (data.contacts || []).find(x => x.id === id);
  if (!c) return res.status(404).json({ error: '不存在' });
  Object.assign(c, req.body);
  db.save(data);
  res.json(c);
});

// 获取需要跟进的联系人
app.get('/api/contacts/follow-up/:accountId', (req, res) => {
  const result = scheduler.getMessagesToFollowUp(parseInt(req.params.accountId));
  res.json(result);
});



// ======================== API: 群采集 ========================

// 导入搜索结果（批量）
app.post('/api/collector/import', (req, res) => {
  const { keyword, groups } = req.body;
  if (!keyword || !groups) return res.status(400).json({ error: '需要keyword和groups' });
  const result = collector.importRawResults(keyword, groups);
  res.json(result);
});

// 获取待加群列表
app.get('/api/collector/pending', (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  res.json(collector.getPendingGroups(limit));
});

// 获取下一个要搜的关键词
app.get('/api/collector/next-keyword', (req, res) => {
  res.json({ keyword: collector.getNextKeyword() });
});

// 手动添加群
app.post('/api/collector/manual-add', (req, res) => {
  const { groupNum, groupName, memberCount, isMuted } = req.body;
  const result = collector.manualAdd(groupNum, groupName, memberCount, isMuted);
  res.json(result);
});

// 采集统计
app.get('/api/collector/stats', (req, res) => {
  res.json(collector.getStats());
});

// ======================== API: 操作日志 ========================

app.get('/api/logs', (req, res) => {
  const data = db.load();
  const limit = parseInt(req.query.limit) || 50;
  res.json((data.events || []).slice(-limit).reverse());
});

app.post('/api/logs', (req, res) => {
  const data = db.load();
  const log = { time: new Date().toISOString(), ...req.body, id: db.nextId(data) };
  if (!data.events) data.events = [];
  data.events.push(log);
  db.save(data);
  res.json(log);
});


// ======================== API: 执行引擎 ========================

// 启动执行引擎
app.post('/api/executor/start', (req, res) => {
  executor.start();
  res.json(executor.getStatus());
});

// 停止执行引擎
app.post('/api/executor/stop', (req, res) => {
  executor.stop();
  res.json(executor.getStatus());
});

// 执行引擎状态
app.get('/api/executor/status', (req, res) => {
  res.json(executor.getStatus());
});

// 手动执行任务
app.post('/api/executor/run/:id', async (req, res) => {
  const result = await executor.executeTask(parseInt(req.params.id));
  res.json(result);
});

// ======================== API: NapCat ========================

// 获取NapCat配置
app.get('/api/napcat/config', (req, res) => {
  res.json(napcat.getConfig());
});

// 更新NapCat配置
app.put('/api/napcat/config', (req, res) => {
  napcat.configure(req.body);
  res.json({ ok: true });
});

// 测试NapCat连接
app.post('/api/napcat/test', async (req, res) => {
  const port = req.body.port || 3000;
  const result = await napcat.testConnection(port);
  res.json(result);
});


// ======================== API: 自适应规则引擎 ========================

// 执行一次评估并自动调整
app.post('/api/adaptive/evaluate', (req, res) => {
  const result = adaptive.evaluate();
  // 记录到日志
  const data = db.load();
  if (result.adjustment && !data.events) data.events = [];
  if (result.adjustment) {
    data.events.push({
      time: new Date().toISOString(), id: db.nextId(data),
      type: 'adaptive_adjust', detail: result.adjustment.reasons.join('; ')
    });
    db.save(data);
  }
  res.json(result);
});

// 获取自适应状态
app.get('/api/adaptive/status', (req, res) => {
  res.json(adaptive.getStatus());
});

// AI深度分析
app.post('/api/adaptive/ai-analyze', async (req, res) => {
  const result = await adaptive.aiAnalysis();
  res.json(result);
});

// 重置自适应数据
app.post('/api/adaptive/reset', (req, res) => {
  adaptive.reset();
  res.json({ ok: true });
});



// ======================== API: QQ注册 ========================

// 创建注册任务
app.post('/api/registrar/create', (req, res) => {
  res.json(registrar.createTask());
});

// 获取手机号
app.post('/api/registrar/get-phone/:id', async (req, res) => {
  const result = await registrar.getPhone(parseInt(req.params.id));
  res.json(result);
});

// 手动填入手机号
app.post('/api/registrar/set-phone/:id', (req, res) => {
  const { phone } = req.body;
  res.json(registrar.setPhone(parseInt(req.params.id), phone));
});

// 检查验证码
app.post('/api/registrar/check-code/:id', async (req, res) => {
  const result = await registrar.checkCode(parseInt(req.params.id));
  res.json(result);
});

// 手动填入验证码
app.post('/api/registrar/set-code/:id', (req, res) => {
  const { code } = req.body;
  res.json(registrar.setCode(parseInt(req.params.id), code));
});

// 注册完成
app.post('/api/registrar/complete/:id', (req, res) => {
  const { qq, password } = req.body;
  res.json(registrar.completeRegistration(parseInt(req.params.id), qq, password));
});

// 标记失败
app.post('/api/registrar/fail/:id', (req, res) => {
  const { reason } = req.body;
  res.json(registrar.failTask(parseInt(req.params.id), reason));
});

// 任务列表
app.get('/api/registrar/tasks', (req, res) => {
  res.json(registrar.listTasks());
});

// 注册统计
app.get('/api/registrar/stats', (req, res) => {
  res.json(registrar.getStats());
});

// 注册配置
app.get('/api/registrar/config', (req, res) => {
  res.json(registrar.getConfig());
});
app.put('/api/registrar/config', (req, res) => {
  registrar.configure(req.body);
  res.json({ ok: true });
});



// ======================== API: 录制回放 ========================

// ADB连接模拟器
app.post('/api/adb/connect', (req, res) => {
  res.json(adb.connect());
});

app.post('/api/adb/disconnect', (req, res) => {
  res.json(adb.disconnect());
});

app.get('/api/adb/status', (req, res) => {
  res.json({ online: adb.isOnline() });
});

// 录制流程
app.post('/api/record/start', (req, res) => {
  const { name } = req.body;
  res.json(registrar.startRecord(name || 'QQ注册流程'));
});

app.post('/api/record/step', (req, res) => {
  const { type, selector, value, waitMs, desc } = req.body;
  res.json(registrar.addRecordStep(type, selector, value, waitMs, desc));
});

app.post('/api/record/stop', (req, res) => {
  const r = registrar.stopRecord();
  // 录制结束时自动截图
  adb.screenshot('flow_' + r.flow?.id);
  res.json(r);
});

app.get('/api/record/flows', (req, res) => {
  res.json(registrar.listFlows());
});

// 回放
app.post('/api/playback/:flowId', async (req, res) => {
  const { phone, password } = req.body;
  const r = await registrar.playback(parseInt(req.params.flowId), phone, password);
  res.json(r);
});
// ======================== 启动 ========================

app.listen(config.port, async () => {
  console.log(`QQ自动化系统v2已启动`);
  console.log(`管理界面: http://localhost:${config.port}`);
  console.log(`API接口:  http://localhost:${config.port}/api/status`);
  console.log(`调度引擎: 已激活 | 温启动: 已激活 | 图谱冲突检测: 已激活 | 执行引擎: 待启动`);
  
  // exe模式下自动打开浏览器
  if (process.argv[0].endsWith('.exe') && process.platform === 'win32') {
    const { execSync } = await import('child_process');
    try {
      execSync(`start http://127.0.0.1:${config.port}`, { shell: 'cmd.exe' });
    } catch(e) {
      console.log('Could not open browser automatically');
    }
  }
});
