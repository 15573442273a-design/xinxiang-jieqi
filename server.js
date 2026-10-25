const path = require("path");
const crypto = require("crypto");
const express = require("express");
const { clientQuestions } = require("./lib/questions");
const { scoreAnswers, resultFromStoredAnswers } = require("./lib/score");
const { TERM_ORDER, getTerm } = require("./lib/terms");
const db = require("./db");

const app = express();
const PORT = Number(process.env.PORT) || 3780;

const boot = db.ensureAdminPassword();
const adminTokens = new Map(); // token -> expiry

app.use(express.json({ limit: "256kb" }));
app.use(express.static(path.join(__dirname, "public")));

function publicMeta() {
  return {
    title: "心象节气",
    subtitle: "二十四候，对照你的内在气候",
    questionCount: clientQuestions().length,
    termCount: TERM_ORDER.length,
    disclaimer: "本测验仅供娱乐与自我反思，不构成任何心理或医学评估。",
  };
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "xinxiang-jieqi" });
});

app.get("/api/meta", (_req, res) => {
  res.json(publicMeta());
});

app.get("/api/questions", (_req, res) => {
  res.json({ questions: clientQuestions() });
});

app.get("/api/terms", (_req, res) => {
  res.json({
    terms: TERM_ORDER.map((id) => {
      const t = getTerm(id);
      return { id: t.id, name: t.name, meaning: t.meaning, group: t.group, seasonLabel: t.seasonLabel };
    }),
  });
});

app.post("/api/quiz/start", (req, res) => {
  try {
    const code = req.body && req.body.code;
    const { codeRow } = db.validateCodeForUse(code);
    const sessionId = crypto.randomBytes(16).toString("hex");
    db.createAttempt({
      sessionId,
      codeRow,
      userAgent: req.get("user-agent") || "",
    });
    res.json({
      sessionId,
      codeApplied: Boolean(codeRow),
      code: codeRow ? codeRow.code : null,
      questions: clientQuestions(),
      meta: publicMeta(),
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || "启动失败" });
  }
});

app.post("/api/quiz/submit", (req, res) => {
  try {
    const { sessionId, answers } = req.body || {};
    if (!sessionId) {
      return res.status(400).json({ error: "缺少 sessionId" });
    }
    const attempt = db.getAttempt(sessionId);
    if (!attempt) return res.status(404).json({ error: "会话不存在" });
    if (attempt.submitted_at) {
      const scored = resultFromStoredAnswers(attempt.answers_json, attempt.result_term);
      return res.json({
        alreadySubmitted: true,
        result: scored.result,
        top: scored.top,
      });
    }

    const scored = scoreAnswers(answers);
    db.submitAttempt(sessionId, {
      resultTerm: scored.termId,
      answers: scored.resolved,
      scores: scored.scores,
      consume: Boolean(attempt.code_id),
    });

    res.json({
      result: scored.result,
      top: scored.top,
      sessionId,
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || "提交失败" });
  }
});

function requireAdmin(req, res, next) {
  const auth = req.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const exp = adminTokens.get(token);
  if (!token || !exp || Date.now() > exp) {
    return res.status(401).json({ error: "未登录或登录已过期" });
  }
  next();
}

app.post("/api/admin/login", (req, res) => {
  const password = (req.body && req.body.password) || "";
  if (!db.verifyAdminPassword(password)) {
    return res.status(401).json({ error: "密码错误" });
  }
  const token = crypto.randomBytes(24).toString("hex");
  adminTokens.set(token, Date.now() + 12 * 60 * 60 * 1000);
  res.json({ token, expiresInHours: 12 });
});

app.post("/api/admin/password", requireAdmin, (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    db.changeAdminPassword(currentPassword, newPassword);
    // 改密后作废现有 token，强制重新登录
    adminTokens.clear();
    res.json({ ok: true, message: "密码已更新，请重新登录" });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || "修改失败" });
  }
});

app.get("/api/admin/codes", requireAdmin, (_req, res) => {
  res.json({ codes: db.listCodes() });
});

app.post("/api/admin/codes", requireAdmin, (req, res) => {
  try {
    const { code, note, maxUses, count } = req.body || {};
    const n = Math.min(50, Math.max(1, Number(count) || 1));
    const created = [];
    for (let i = 0; i < n; i++) {
      const c =
        code && n === 1
          ? code
          : (code ? `${code}-` : "XQ-") +
            crypto.randomBytes(3).toString("hex").toUpperCase();
      created.push(
        db.createCode({
          code: c,
          note: note || "",
          maxUses: maxUses || 1,
        })
      );
    }
    res.json({ codes: created });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || "创建失败" });
  }
});

app.patch("/api/admin/codes/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const active = Boolean(req.body && req.body.active);
  const row = db.setCodeActive(id, active);
  if (!row) return res.status(404).json({ error: "未找到" });
  res.json({ code: row });
});

app.get("/api/admin/stats", requireAdmin, (_req, res) => {
  res.json(db.aggregateStats());
});

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.status(404).send("Not found");
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`心象节气 listening on http://127.0.0.1:${PORT}`);
  console.log(`测验首页: http://127.0.0.1:${PORT}/`);
  console.log(`管理后台: http://127.0.0.1:${PORT}/admin.html`);
  console.log(`SQLite: ${db.dbPath}`);
  if (boot.generated) {
    console.log("========================================");
    console.log("已生成初始管理员密码（仅显示一次，请立即保存）：");
    console.log(boot.generated);
    console.log("可在后台「修改密码」中更换。勿将密码提交到 Git。");
    console.log("========================================");
  } else if (boot.fromEnv) {
    console.log("管理员密码已从 ADMIN_PASSWORD 写入数据库（哈希存储）。");
  } else {
    console.log("管理员密码已存在于数据库（哈希）。可用后台修改。");
  }
});
