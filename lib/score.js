const { TERM_ORDER, getTerm } = require("./terms");
const { QUESTIONS, findOption } = require("./questions");
const { buildPersonalizedResult } = require("./path-text");

function scoreAnswers(optionIds) {
  if (!Array.isArray(optionIds) || optionIds.length !== QUESTIONS.length) {
    const err = new Error("答案数量须与题目一致");
    err.status = 400;
    throw err;
  }

  const scores = Object.fromEntries(TERM_ORDER.map((id) => [id, 0]));
  const resolved = [];

  for (let i = 0; i < optionIds.length; i++) {
    const oid = optionIds[i];
    const found = findOption(oid);
    if (!found || found.question.id !== QUESTIONS[i].id) {
      const err = new Error(`第 ${i + 1} 题选项无效`);
      err.status = 400;
      throw err;
    }
    resolved.push({ questionId: found.question.id, optionId: oid });
    for (const [termId, w] of Object.entries(found.option.weights)) {
      if (scores[termId] !== undefined) scores[termId] += w;
    }
  }

  let best = TERM_ORDER[0];
  let bestScore = -1;
  for (const id of TERM_ORDER) {
    if (scores[id] > bestScore) {
      bestScore = scores[id];
      best = id;
    }
  }

  const term = getTerm(best);
  const top = [...TERM_ORDER]
    .sort((a, b) => scores[b] - scores[a] || TERM_ORDER.indexOf(a) - TERM_ORDER.indexOf(b))
    .slice(0, 3)
    .map((id) => ({ id, name: getTerm(id).name, score: scores[id] }));

  const result = buildPersonalizedResult(term, { scores, resolved, top });

  return {
    termId: best,
    result,
    scores,
    top,
    resolved,
  };
}

/** 从已存 answers_json 重放个性化结果 */
function resultFromStoredAnswers(answersJson, resultTerm) {
  let optionIds;
  try {
    const parsed = JSON.parse(answersJson || "[]");
    if (Array.isArray(parsed) && parsed.length && typeof parsed[0] === "string") {
      optionIds = parsed;
    } else if (Array.isArray(parsed)) {
      optionIds = parsed.map((a) => a.optionId);
    }
  } catch (_) {
    optionIds = null;
  }
  if (optionIds && optionIds.length === QUESTIONS.length) {
    try {
      return scoreAnswers(optionIds);
    } catch (_) {
      /* fall through */
    }
  }
  const term = getTerm(resultTerm);
  const { publicTerm } = require("./terms");
  const { buildPersonalizedResult: build } = require("./path-text");
  return {
    termId: resultTerm,
    result: term
      ? build(term, {
          scores: {},
          resolved: [],
          top: [{ id: resultTerm, name: term.name, score: 0 }],
        })
      : publicTerm(term),
    scores: {},
    top: term ? [{ id: term.id, name: term.name, score: 0 }] : [],
    resolved: [],
  };
}

module.exports = { scoreAnswers, resultFromStoredAnswers };
