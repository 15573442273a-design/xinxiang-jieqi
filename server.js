const path = require("path");
const crypto = require("crypto");
const express = require("express");
const { clientQuestions } = require("./lib/questions");
const { scoreAnswers, resultFromStoredAnswers } = require("./lib/score");
const { TERM_ORDER, getTerm } = require("./lib/terms");
const db = require("./db");

const app = express();
const PORT = Number(process.env.PORT) || 3780;
const PUBLIC_BASE =
  (process.env.PUBLIC_BASE_URL || "https://xinxiang-jieqi.onrender.com").replace(
    /\/$/,
    ""
  );

const boot = db.ensureAdminPassword();
const adminTokens = new Map(); // token -> expiry

/** 简易按 IP 限流：/redeem 与领取 API */
const rateBuckets = new Map();
function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  let b = rateBuckets.get(key);
  if (!b || now > b.reset) {
    b = { count: 0, reset: now + windowMs };
    rateBuckets.set(key, b);
  }
  b.count += 1;
  return b.count <= limit;
}

function clientIp(req) {
  const xf = req.get("x-forwarded-for");
  if (xf) return String(xf).split(",")[0].trim();
  return req.ip || req.socket.remoteAddress || "unknown";
}

const BOT_UA =
  /bot|spider|crawl|slurp|preview|facebookexternalhit|twitterbot|linkedinbot|embedly|quora|pinterest|redditbot|applebot|bingpreview|discordbot|telegrambot|whatsapp|skypeuripreview|slackbot|vkshare|w3c_validator/i;

function looksLikeBot(ua) {
  return !ua || BOT_UA.test(ua);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

app.use(express.json({ limit: "256kb" }));
app.use(express.static(path.join(__dirname, "public")));

function publicMeta() {
  return {
    title: "心象节气",
    subtitle: "二十四候，对照你的内在气候",
    questionCount: clientQuestions().length,
    termCount: TERM_ORDER.length,
    disclaimer: "本测验仅供娱乐与自我反思，不构成任何心理或医学评估。",
    requireRedeem: true,
    publicBase: PUBLIC_BASE,
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
      return {
        id: t.id,
        name: t.name,
        meaning: t.meaning,
        group: t.group,
        seasonLabel: t.seasonLabel,
      };
    }),
  });
});

/** 继续领取会话开测（一码一测） */

app.post("/api/quiz/claim", (req, res) => {
  try {
    const ip = clientIp(req);
    if (!rateLimit(`claim:${ip}`, 20, 60_000)) {
      return res.status(429).json({ error: "请求过于频繁，请稍后再试" });
    }
    const codeText = req.body && req.body.code;
    const row = db.getCodeByText(codeText);
    if (!row) return res.status(400).json({ error: "兑换码无效" });
    if (!row.token) return res.status(400).json({ error: "兑换码缺少发货令牌，请联系商家" });
    const result = db.openDeliveryToken(row.token, {
      userAgent: req.get("user-agent") || "",
    });
    if (result.status === "ok") {
      return res.json({
        sessionId: result.sessionId,
        code: result.code,
        claimExpiresAt: result.claimExpiresAt,
        quizPath: result.quizPath,
      });
    }
    if (result.status === "already_opened") {
      return res.status(400).json({
        error: result.submitted
          ? "该兑换码已测过，不能再次使用"
          : result.expired
            ? "领取资格已过期，请联系商家重新发货"
            : "该兑换码已领取过，请使用当时的测验链接，或联系商家",
      });
    }
    if (result.status === "disabled") {
      return res.status(400).json({ error: "兑换码已停用" });
    }
    return res.status(400).json({ error: "兑换失败" });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || "兑换失败" });
  }
});

app.post("/api/quiz/start", (req, res) => {
  try {
    const sessionId = req.body && req.body.sessionId;
    if (!sessionId) {
      return res.status(400).json({
        error: "请先打开商家发货链接领取资格（一码一测）",
      });
    }
    const { attempt, codeRow } = db.resumeClaimSession(sessionId);
    res.json({
      sessionId: attempt.session_id,
      codeApplied: true,
      code: codeRow.code,
      claimExpiresAt: codeRow.claim_expires_at,
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
      const scored = resultFromStoredAnswers(
        attempt.answers_json,
        attempt.result_term
      );
      return res.json({
        alreadySubmitted: true,
        result: scored.result,
        top: scored.top,
      });
    }

    // 提交前再次校验领取未过期
    db.resumeClaimSession(sessionId);

    const scored = scoreAnswers(answers);
    db.submitAttempt(sessionId, {
      resultTerm: scored.termId,
      answers: scored.resolved,
      scores: scored.scores,
      consume: false,
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

function withRedeemUrl(row) {
  if (!row) return row;
  return {
    ...row,
    redeemPath: `/redeem/${row.token}`,
    redeemUrl: `${PUBLIC_BASE}/redeem/${row.token}`,
  };
}

app.post("/api/admin/login", (req, res) => {
  const password = (req.body && req.body.password) || "";
  if (!db.verifyAdminPassword(password)) {
    return res.status(401).json({ error: "密码错误" });
  }
  const token = crypto.randomBytes(24).toString("hex");
  adminTokens.set(token, Date.now() + 12 * 60 * 60 * 1000);
  res.json({ token, expiresInHours: 12, publicBase: PUBLIC_BASE });
});

app.post("/api/admin/password", requireAdmin, (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    db.changeAdminPassword(currentPassword, newPassword);
    adminTokens.clear();
    res.json({ ok: true, message: "密码已更新，请重新登录" });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || "修改失败" });
  }
});

app.get("/api/admin/codes", requireAdmin, (_req, res) => {
  res.json({
    codes: db.listCodes().map(withRedeemUrl),
    publicBase: PUBLIC_BASE,
  });
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
        withRedeemUrl(
          db.createCode({
            code: c,
            note: note || "",
            maxUses: maxUses || 1,
            maxOpens: 1,
          })
        )
      );
    }
    res.json({ codes: created, publicBase: PUBLIC_BASE });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || "创建失败" });
  }
});

app.patch("/api/admin/codes/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const active = Boolean(req.body && req.body.active);
  const row = db.setCodeActive(id, active);
  if (!row) return res.status(404).json({ error: "未找到" });
  res.json({ code: withRedeemUrl(row) });
});

app.get("/api/admin/stats", requireAdmin, (_req, res) => {
  res.json(db.aggregateStats());
});

function renderRedeemPage({ status, code, sessionId, note, claimExpiresAt }) {
  const title =
    status === "ok"
      ? "卡密已领取"
      : status === "already_opened"
        ? "链接已失效"
        : status === "bot"
          ? "请在浏览器打开"
          : status === "disabled"
            ? "链接已停用"
            : "链接无效";

  let body = "";
  if (status === "ok") {
    const quizHref = `/?session=${encodeURIComponent(sessionId)}`;
    body = `
      <p class="eyebrow">心象节气 · 一码一测</p>
      <h1>领取成功</h1>
      <p class="lead">请妥善保存下方卡密。本链接仅可打开一次，刷新或再次打开将无法再看到卡密。</p>
      <div class="code-box" id="code-box">${escapeHtml(code)}</div>
      <button type="button" class="btn" id="btn-copy">复制卡密</button>
      <p class="hint">建议立刻开始测验；领取资格约 ${db.claimTtlHours()} 小时内有效。</p>
      <a class="btn primary" href="${quizHref}">开始测验</a>
      ${note ? `<p class="note">备注：${escapeHtml(note)}</p>` : ""}
      <p class="tiny">过期时间（UTC）：${escapeHtml(claimExpiresAt || "")}</p>
      <script>
        document.getElementById("btn-copy").onclick = async () => {
          const t = ${JSON.stringify(code)};
          try {
            await navigator.clipboard.writeText(t);
            document.getElementById("btn-copy").textContent = "已复制";
          } catch (e) {
            prompt("请手动复制卡密", t);
          }
        };
      </script>`;
  } else if (status === "already_opened") {
    body = `
      <p class="eyebrow">心象节气</p>
      <h1>已失效 / 已领取</h1>
      <p class="lead">此发货链接已被打开过，卡密不再显示（一码一测）。若你是买家本人，请翻找聊天记录中的卡密，或联系商家重新发货。</p>
      <a class="btn" href="/">返回首页</a>`;
  } else if (status === "bot") {
    body = `
      <p class="eyebrow">心象节气</p>
      <h1>请在浏览器中打开</h1>
      <p class="lead">为防止链接预览误核销，请用手机或电脑浏览器打开此链接领取卡密。</p>`;
  } else if (status === "disabled") {
    body = `
      <p class="eyebrow">心象节气</p>
      <h1>链接已停用</h1>
      <p class="lead">该兑换码已被停用，请联系商家。</p>`;
  } else if (status === "rate") {
    body = `
      <p class="eyebrow">心象节气</p>
      <h1>请求过于频繁</h1>
      <p class="lead">请稍后再试。</p>`;
  } else {
    body = `
      <p class="eyebrow">心象节气</p>
      <h1>链接无效</h1>
      <p class="lead">找不到该发货链接，请核对商家发货内容。</p>`;
  }

  return `<!DOCTYPE html>
<html lang="zh-Hans">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  <title>${escapeHtml(title)} · 心象节气</title>
  <style>
    :root { --bg:#eef5eb; --card:#f7fbf5; --text:#1f3328; --muted:#5a7264; --accent:#3f6b4d; --line:rgba(63,107,77,.16); }
    * { box-sizing: border-box; }
    body { margin:0; font-family:"Noto Sans SC","PingFang SC",sans-serif; background:var(--bg); color:var(--text); min-height:100dvh; display:flex; align-items:center; justify-content:center; padding:1.5rem; }
    .card { width:min(100%,420px); background:var(--card); border:1px solid var(--line); border-radius:18px; padding:1.6rem 1.4rem 1.8rem; box-shadow:0 16px 40px rgba(63,107,77,.1); }
    .eyebrow { margin:0; color:var(--accent); font-size:.8rem; letter-spacing:.08em; }
    h1 { margin:.4rem 0 .8rem; font-size:1.55rem; color:var(--accent); }
    .lead { color:var(--muted); line-height:1.65; margin:0 0 1.1rem; }
    .code-box { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:1.35rem; letter-spacing:.06em; text-align:center; padding:1rem; background:#e4efe3; border-radius:12px; border:1px dashed var(--accent); word-break:break-all; margin-bottom:.9rem; }
    .btn { display:inline-block; margin:.35rem .35rem 0 0; padding:.65rem 1.1rem; border-radius:999px; border:1px solid var(--line); background:#fff; color:var(--accent); text-decoration:none; font:inherit; cursor:pointer; }
    .btn.primary { background:var(--accent); color:#f7fbf5; border-color:var(--accent); }
    .hint,.note,.tiny { color:var(--muted); font-size:.85rem; }
    .tiny { font-size:.75rem; opacity:.8; }
  </style>
</head>
<body>
  <main class="card">${body}</main>
</body>
</html>`;
}

app.get("/redeem/:token", (req, res) => {
  const ip = clientIp(req);
  if (!rateLimit(`redeem:${ip}`, 40, 60_000)) {
    res.status(429).send(renderRedeemPage({ status: "rate" }));
    return;
  }

  const ua = req.get("user-agent") || "";
  const wantsJson =
    (req.get("accept") || "").includes("application/json") ||
    req.query.format === "json";

  // 预览机器人不核销，避免小红书/微信预览烧掉一码一测
  if (looksLikeBot(ua) && !req.query.force) {
    if (wantsJson) {
      return res.status(200).json({
        status: "bot",
        error: "请在浏览器中打开此链接领取",
      });
    }
    return res.status(200).send(renderRedeemPage({ status: "bot" }));
  }

  const result = db.openDeliveryToken(req.params.token, { userAgent: ua });

  if (wantsJson) {
    if (result.status === "ok") {
      return res.json({
        status: "ok",
        code: result.code,
        sessionId: result.sessionId,
        quizPath: result.quizPath,
        claimExpiresAt: result.claimExpiresAt,
      });
    }
    return res.status(result.status === "invalid" ? 404 : 410).json({
      status: result.status,
      error:
        result.status === "already_opened"
          ? "已失效/已领取"
          : result.status === "disabled"
            ? "已停用"
            : "链接无效",
    });
  }

  if (result.status === "ok") {
    res.set("Cache-Control", "no-store");
    return res.send(
      renderRedeemPage({
        status: "ok",
        code: result.code,
        sessionId: result.sessionId,
        note: result.note,
        claimExpiresAt: result.claimExpiresAt,
      })
    );
  }
  res
    .status(result.status === "invalid" ? 404 : 410)
    .set("Cache-Control", "no-store")
    .send(renderRedeemPage({ status: result.status }));
});

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  if (req.path.startsWith("/redeem/")) return next();
  res.status(404).send("Not found");
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`心象节气 listening on http://127.0.0.1:${PORT}`);
  console.log(`测验首页: http://127.0.0.1:${PORT}/`);
  console.log(`管理后台: http://127.0.0.1:${PORT}/admin.html`);
  console.log(`发货域名: ${PUBLIC_BASE}/redeem/<token>`);
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
