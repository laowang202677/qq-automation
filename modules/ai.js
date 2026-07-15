// ================================================================
// AI引擎 - 支持DeepSeek/通义千问/GLM-4
// 功能：话术改写(P0) + 跟进判断(P1) + 温启动分析(P2)
// ================================================================
import config from '../config.js';

const PROVIDERS = {
  deepseek: { baseUrl: 'https://api.deepseek.com/v1/chat/completions', model: 'deepseek-chat', format: 'openai' },
  qwen: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', model: 'qwen-plus', format: 'openai' },
  glm: { baseUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', model: 'glm-4-flash', format: 'openai' }
};

// 导出供adaptive.js使用
export async function callLLM(systemPrompt, userMessage, temperature = 0.7) {
  const cfg = config.ai;
  if (!cfg.provider || !cfg.apiKey) return { error: 'AI未配置，请在设置中配置API Key' };
  const provider = PROVIDERS[cfg.provider];
  if (!provider) return { error: '不支持的AI服务商' };
  const body = { model: cfg.model || provider.model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }], temperature, max_tokens: 2000 };
  try {
    const res = await fetch(provider.baseUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey }, body: JSON.stringify(body) });
    if (!res.ok) return { error: 'API调用失败: HTTP ' + res.status };
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return { error: 'API返回格式异常' };
    return { content: content.trim() };
  } catch (e) { return { error: '网络错误: ' + e.message }; }
}

// P0: 话术改写
export async function rewriteMessage(original, scene) {
  const sceneNames = { first:'首次私信(对方是陌生人)', follow:'跟进(对方已聊过)', convert:'转化(建议对方注册)', rechat:'复聊(隔了一段时间再联系)' };
  const prompt = `你是一个营销话术改写专家。把以下中文私信话术改写成10个不同版本，用于在QQ群发时规避文本指纹检测。\n规则：保留核心意思但措辞不同；每句话术开头不相似；输出每行一个版本，不要编号；全部用中文。\n场景：${sceneNames[scene]||'私信'}\n原话术：${original}`;
  const result = await callLLM('你是一个精通中文营销话术的AI助手。', prompt, 0.8);
  if (result.error) return result;
  const versions = result.content.split('\n').map(l => l.replace(/^\d+[.、\s)]*/, '').trim()).filter(l => l.length > 5 && l.length < 200);
  return { versions: versions.slice(0, 10), original };
}

// P1: 跟进判断
export async function analyzeFollowUp(conversation) {
  const prompt = `分析以下QQ私信对话，判断对方当前的意向程度和最佳跟进策略。\n对话记录：\n${conversation}\n请按以下格式输出：\n意向级别：[高/中/低/无]\n判断依据：[一句话]\n建议下一步：[一句话]\n建议话术：[一句建议的下一条话术]`;
  return await callLLM('你是一个客户意向分析专家。', prompt, 0.5);
}

// P2: 温启动建议
export async function analyzeWarmup(account) {
  const events = (account.events || []).slice(-5).map(e => e.type + ': ' + e.detail).join('\n');
  const prompt = `分析以下QQ账号的温启动数据，判断是否可以提前进入下一阶段。\n当前阶段：${account.warmupStage}\n已养${Math.floor((Date.now()-new Date(account.warmupStartedAt||account.registeredAt).getTime())/86400000)}天\n总私信：${account.total?.dm||0} 总群聊：${account.total?.groupChat||0}\n封禁次数：${account.banCount||0}\n近期事件：${events||'无'}\n请判断：\n1. 是否可以提前进入下一阶段？为什么？\n2. 综合评分(0-100)：`;
  return await callLLM('你是一个账号养号策略分析师。', prompt, 0.4);
}

export async function testConnection() {
  return await callLLM('你是一个助手。回复"连接成功"四个字。', '测试连接');
}
