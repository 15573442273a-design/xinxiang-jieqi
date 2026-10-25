/**
 * 14 题；每选项对若干节气加权。
 * weights: { termId: number }
 */
const QUESTIONS = [
  {
    id: "q1",
    mood: "spring",
    moodLabel: "春意",
    q: "一段低潮刚过，你最自然的第一步是？",
    options: [
      { id: "q1a", text: "告诉自己可以重新开始，先做一件很小的新事", weights: { lichun: 3, yushui: 1, dongzhi: 1 } },
      { id: "q1b", text: "找信任的人聊聊，让情绪被轻轻润一润", weights: { yushui: 3, xiaoxue: 1, guyu: 1 } },
      { id: "q1c", text: "把卡住的话说开，打破这段假平静", weights: { jingzhe: 3, dashu: 1, xiazhi: 1 } },
      { id: "q1d", text: "先缩小生活半径，把自己养稳再出门", weights: { lidong: 3, dahan: 1, xiaohan: 1 } },
    ],
  },
  {
    id: "q2",
    mood: "spring",
    moodLabel: "春意",
    q: "朋友之间起了分歧，你更常怎么做？",
    options: [
      { id: "q2a", text: "尽量两边兼顾，找一个都还能接受的点", weights: { chunfen: 3, qiufen: 2, chushu: 1 } },
      { id: "q2b", text: "把关键矛盾摊开，宁可短暂难堪", weights: { jingzhe: 3, xiaohan: 2, qiufen: 1 } },
      { id: "q2c", text: "先安抚情绪，再慢慢把事情理顺", weights: { yushui: 3, xiaoxue: 2, bailu: 1 } },
      { id: "q2d", text: "帮大家善后收尾，让场子平复下来", weights: { chushu: 3, guyu: 2, mangzhong: 1 } },
    ],
  },
  {
    id: "q3",
    mood: "spring",
    moodLabel: "春意",
    q: "你更认同哪一种「清楚」？",
    options: [
      { id: "q3a", text: "把情绪与往事看干净，不强装轻松", weights: { qingming: 3, bailu: 2, hanlu: 1 } },
      { id: "q3b", text: "把对错与责任分清楚，尽量公道", weights: { qiufen: 3, chunfen: 2, xiaohan: 1 } },
      { id: "q3c", text: "把边界划清楚，什么能碰什么不能", weights: { shuangjiang: 3, lidong: 2, xiaohan: 1 } },
      { id: "q3d", text: "把下一步时机看清楚，再决定播种或收割", weights: { mangzhong: 3, guyu: 2, dahan: 1 } },
    ],
  },
  {
    id: "q4",
    mood: "summer",
    moodLabel: "夏气",
    q: "关于「被看见」，你更接近？",
    options: [
      { id: "q4a", text: "我想发光，也愿意主动展示热爱", weights: { lixia: 3, xiazhi: 2, dashu: 1 } },
      { id: "q4b", text: "有一点成就就好，太满反而不安", weights: { xiaoman: 3, bailu: 1, lidong: 1 } },
      { id: "q4c", text: "真正重要的事，我宁愿先藏着", weights: { daxue: 3, hanlu: 2, lidong: 1 } },
      { id: "q4d", text: "默默把事做成，掌声可有可无", weights: { guyu: 3, mangzhong: 2, chushu: 1 } },
    ],
  },
  {
    id: "q5",
    mood: "summer",
    moodLabel: "夏气",
    q: "工作进入高压期，你的状态更像？",
    options: [
      { id: "q5a", text: "进入正午模式，全力输出、气场拉满", weights: { xiazhi: 3, dashu: 2, lixia: 1 } },
      { id: "q5b", text: "按农时赶工，肩上的事必须按时落地", weights: { mangzhong: 3, dashu: 2, guyu: 1 } },
      { id: "q5c", text: "表面稳住，心里闷着酝酿下一步", weights: { xiaoshu: 3, daxue: 2, xiaoxue: 1 } },
      { id: "q5d", text: "热到极限也要拿下结果，再谈休息", weights: { dashu: 3, xiazhi: 2, mangzhong: 1 } },
    ],
  },
  {
    id: "q6",
    mood: "summer",
    moodLabel: "夏气",
    q: "你对「留白」怎么看？",
    options: [
      { id: "q6a", text: "将满未满最好，留空才能装下新的好", weights: { xiaoman: 3, chunfen: 1, lidong: 1 } },
      { id: "q6b", text: "空白让我不安，我更想把日程填热", weights: { lixia: 2, xiazhi: 3, mangzhong: 1 } },
      { id: "q6c", text: "空不是无，是蓄力的洞穴", weights: { lidong: 3, daxue: 2, xiaoxue: 1 } },
      { id: "q6d", text: "空下来时，我会整理余温和未完事项", weights: { chushu: 3, dahan: 2, liqiu: 1 } },
    ],
  },
  {
    id: "q7",
    mood: "autumn",
    moodLabel: "秋声",
    q: "当你感到自己「过热」了，你会？",
    options: [
      { id: "q7a", text: "主动收心，让生活先凉一点、清楚一点", weights: { liqiu: 3, chunfen: 1, xiaohan: 1 } },
      { id: "q7b", text: "把残局收拾好，再允许自己下线", weights: { chushu: 3, dahan: 2, mangzhong: 1 } },
      { id: "q7c", text: "更敏锐地察觉哪里不对劲，微调关系", weights: { bailu: 3, qingming: 2, hanlu: 1 } },
      { id: "q7d", text: "直接加厚边界，减少被消耗", weights: { shuangjiang: 3, lidong: 2, xiaohan: 1 } },
    ],
  },
  {
    id: "q8",
    mood: "autumn",
    moodLabel: "秋声",
    q: "表达在乎时，你更真实的样子是？",
    options: [
      { id: "q8a", text: "热烈直接，恨不得把真心放到桌上", weights: { dashu: 2, lixia: 3, xiazhi: 2 } },
      { id: "q8b", text: "深藏不露，但会用长久行动证明", weights: { hanlu: 3, daxue: 2, guyu: 1 } },
      { id: "q8c", text: "细腻捕捉对方情绪，用细节回应", weights: { bailu: 3, yushui: 2, qingming: 1 } },
      { id: "q8d", text: "陪伴在侧，不多话，让人感到安稳", weights: { xiaoxue: 3, yushui: 2, lidong: 1 } },
    ],
  },
  {
    id: "q9",
    mood: "autumn",
    moodLabel: "秋声",
    q: "做重要决定时，你最倚重什么？",
    options: [
      { id: "q9a", text: "是否对各方尽量公正、经得起追问", weights: { qiufen: 3, chunfen: 2, xiaohan: 1 } },
      { id: "q9b", text: "是否触及真相，哪怕听起来不舒服", weights: { jingzhe: 2, qingming: 3, xiaohan: 2 } },
      { id: "q9c", text: "是否守住我的原则与不可越的线", weights: { shuangjiang: 3, qiufen: 1, lidong: 1 } },
      { id: "q9d", text: "是否到了该收束或该播种的时机", weights: { mangzhong: 2, dahan: 3, lichiu: 2 } },
    ],
  },
  {
    id: "q10",
    mood: "winter",
    moodLabel: "冬藏",
    q: "社交电量偏低的一周，你如何对待自己？",
    options: [
      { id: "q10a", text: "关上门蓄力，把世界暂时调小", weights: { lidong: 3, daxue: 1, xiaoman: 1 } },
      { id: "q10b", text: "保持轻柔沉默，不硬撑热闹", weights: { xiaoxue: 3, bailu: 1, yushui: 1 } },
      { id: "q10c", text: "把重要想法埋得更深，等对的人再挖", weights: { daxue: 3, hanlu: 2, xiaoshu: 1 } },
      { id: "q10d", text: "复盘这一段，该结束的结束，该留的留", weights: { dahan: 3, chushu: 2, liqiu: 1 } },
    ],
  },
  {
    id: "q11",
    mood: "winter",
    moodLabel: "冬藏",
    q: "面对很长的低谷，你心底更相信？",
    options: [
      { id: "q11a", text: "夜最长处，就是转折要来的地方", weights: { dongzhi: 3, lichun: 2, xiaoshu: 1 } },
      { id: "q11b", text: "先把刀磨亮，把现实看锋利些", weights: { xiaohan: 3, qiufen: 1, jingzhe: 1 } },
      { id: "q11c", text: "厚积总会有用，现在不必解释", weights: { daxue: 3, guyu: 2, xiaoshu: 1 } },
      { id: "q11d", text: "用滋养与陪伴熬过去，自己的和他人的", weights: { yushui: 3, xiaoxue: 2, guyu: 1 } },
    ],
  },
  {
    id: "q12",
    mood: "winter",
    moodLabel: "冬藏",
    q: "别人最可能怎样夸你（或抱怨你）？",
    options: [
      { id: "q12a", text: "「你总能带来新开始 / 你有点太理想」", weights: { lichun: 3, lixia: 1, dongzhi: 1 } },
      { id: "q12b", text: "「跟着你很安心 / 你不太表达自己」", weights: { xiaoxue: 2, yushui: 2, lidong: 2, hanlu: 1 } },
      { id: "q12c", text: "「你太拼了 / 你一认真就点火」", weights: { dashu: 3, xiazhi: 2, mangzhong: 2 } },
      { id: "q12d", text: "「你看得太清 / 有时让人发冷」", weights: { xiaohan: 3, qingming: 2, shuangjiang: 2 } },
    ],
  },
  {
    id: "q13",
    mood: "spring",
    moodLabel: "回春",
    q: "如果用一种「生长」形容你，更像？",
    options: [
      { id: "q13a", text: "破土的芽——先动起来再说", weights: { lichun: 3, jingzhe: 2, lixia: 1 } },
      { id: "q13b", text: "灌浆的谷——默默把养分灌进成果", weights: { guyu: 3, mangzhong: 2, xiaoman: 1 } },
      { id: "q13c", text: "酿在罐里的酒——外表闷，内里变", weights: { xiaoshu: 3, daxue: 2, hanlu: 1 } },
      { id: "q13d", text: "雪下的根——现在看不见，来年会知道", weights: { dongzhi: 2, daxue: 2, lidong: 2, dahan: 1 } },
    ],
  },
  {
    id: "q14",
    mood: "autumn",
    moodLabel: "定候",
    q: "此刻若给内心选一种天气，你选？",
    options: [
      { id: "q14a", text: "雨后初晴，清亮里带着一点怀念", weights: { qingming: 3, bailu: 2, yushui: 1 } },
      { id: "q14b", text: "将满的麦田，风里有知足也有忙", weights: { xiaoman: 2, mangzhong: 2, guyu: 2, lixia: 1 } },
      { id: "q14c", text: "霜晨的路，冷而清晰，步子很稳", weights: { shuangjiang: 3, liqiu: 2, xiaohan: 2 } },
      { id: "q14d", text: "最长夜里的一盏灯，小，但亮着", weights: { dongzhi: 3, xiaoxue: 1, lichun: 1, dahan: 1 } },
    ],
  },
];

function clientQuestions() {
  return QUESTIONS.map((q) => ({
    id: q.id,
    mood: q.mood,
    moodLabel: q.moodLabel,
    q: q.q,
    options: q.options.map((o) => ({ id: o.id, text: o.text })),
  }));
}

function findOption(optionId) {
  for (const q of QUESTIONS) {
    const opt = q.options.find((o) => o.id === optionId);
    if (opt) return { question: q, option: opt };
  }
  return null;
}

module.exports = { QUESTIONS, clientQuestions, findOption };
