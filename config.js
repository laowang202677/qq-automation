const config = {
  port: 3456,
  dataFile: 'data/db.json',

  // ===== 风控规则（基础红线，AI可动态调整） =====
  rules: {
    account: {
      minAgeDays: 7,
      safeAgeDays: 15,
      dailySendLimit: 15,
      dailyGroupLimit: 3,
      sendIntervalMin: 5,
      groupIntervalMin: 120,
    },
    behavior: {
      // 日间分布：各时段操作占比
      dayDistribution: { morning: 0.3, afternoon: 0.2, evening: 0.5 },
      // 操作类型穿插比例：私信:群聊:空间
      actionMix: { dm: 3, groupChat: 1, qzone: 0.5 },
      // 禁忌时段（不操作）
      deadHours: [0, 1, 2, 3, 4, 5],
      // 消息后的检查延迟（分钟）
      checkDelayMin: 30,
      checkDelayMax: 120,
    },
    // 温启动四阶段
    warmup: {
      zombieDays: 3,
      observeDays: 4,
      testDays: 7,
      zombieActionsPerDay: 0,
      observeActionsPerDay: 3,
      testActionsPerDay: 6,
    },
  },

  // 搜群关键词
  searchKeywords: [
    // 币圈直接相关
    '合约交流', '合约', '币圈', '比特币', '以太坊', '加密货币',
    '加密', 'web3', '数字货币', '区块链', '空投', '撸毛',
    '交易技术', '量化', '投资交流', '虚拟货币', '数字资产',
    '币价', '币行情', '币圈交流', 'defi', 'NFT',
    // 交易技术相关
    '技术分析', 'K线', '交易员', '波段交易', '短线交易',
    '趋势交易', '缠论', '网格交易', '量化交易',
    // 外汇/金融重叠
    '外汇', '外汇交易', '黄金交易', '股指期货', '期货',
    '现货', '金融投资', '理财交流',
    // 搞钱/副业类（截流目标）
    '搞钱', '副业', '赚钱', '创业交流', '自由职业',
    '项目交流', '网赚', '薅羊毛',
    // 社群/交友（混群伪装）
    '交友', '聊天', '兴趣爱好', '游戏交流', '动漫'
  ],

  ai: { provider: '', apiKey: '', model: '' }
};
export default config;
