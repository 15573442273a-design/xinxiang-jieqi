const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Database = require("better-sqlite3");

function resolveDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  const local = path.join(__dirname, "data");
  try {
    if (!fs.existsSync(local)) fs.mkdirSync(local, { recursive: true });
    fs.accessSync(local, fs.constants.W_OK);
    return local;
  } catch (_) {
    const tmp = path.join("/tmp", "xinxiang-jieqi-data");
    fs.mkdirSync(tmp, { recursive: true });
    console.warn(`[db] data/ 不可写，回退到 ${tmp}（免费实例磁盘常为临时）`);
    return tmp;
  }
}

const dataDir = resolveDataDir();
const dbPath = process.env.DB_PATH || path.join(dataDir, "quiz.sqlite");
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS redeem_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  note TEXT DEFAULT '',
  max_uses INTEGER NOT NULL DEFAULT 1,
  used_count INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL UNIQUE,
  code_id INTEGER,
  code_text TEXT,
  result_term TEXT,
  answers_json TEXT,
  scores_json TEXT,
  user_agent TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  submitted_at TEXT,
  FOREIGN KEY (code_id) REFERENCES redeem_codes(id)
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attempts_term ON attempts(result_term);
CREATE INDEX IF NOT EXISTS idx_attempts_code ON attempts(code_id);
`);

function columnNames(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

function migrateRedeemSchema() {
  const cols = columnNames("redeem_codes");
  const add = (name, ddl) => {
    if (!cols.includes(name)) {
      db.exec(`ALTER TABLE redeem_codes ADD COLUMN ${ddl}`);
      cols.push(name);
    }
  };
  add("token", "token TEXT");
  add("max_opens", "max_opens INTEGER NOT NULL DEFAULT 1");
  add("open_count", "open_count INTEGER NOT NULL DEFAULT 0");
  add("opened_at", "opened_at TEXT");
  add("used_at", "used_at TEXT");
  add("quiz_session_id", "quiz_session_id TEXT");
  add("claim_expires_at", "claim_expires_at TEXT");

  const missing = db
    .prepare(`SELECT id FROM redeem_codes WHERE token IS NULL OR token = ''`)
    .all();
  if (missing.length) {
    const upd = db.prepare(`UPDATE redeem_codes SET token = ? WHERE id = ?`);
    const tx = db.transaction((rows) => {
      for (const r of rows) {
        upd.run(crypto.randomBytes(18).toString("base64url"), r.id);
      }
    });
    tx(missing);
  }
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_redeem_token ON redeem_codes(token)`);
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_redeem_quiz_session ON redeem_codes(quiz_session_id) WHERE quiz_session_id IS NOT NULL`
  );
}

migrateRedeemSchema();

function getSetting(key) {
  const row = db.prepare(`SELECT value FROM app_settings WHERE key = ?`).get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value);
}

const SCRYPT_OPTS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), s, 64, SCRYPT_OPTS);
  return `scrypt:${s.toString("hex")}:${hash.toString("hex")}`;
}

function verifyPassword(password, stored) {
  if (!stored || !password) return false;
  const parts = String(stored).split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  let actual;
  try {
    actual = crypto.scryptSync(String(password), salt, 64, SCRYPT_OPTS);
  } catch (_) {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

function ensureAdminPassword() {
  const existing = getSetting("admin_password_hash");
  if (existing) return { generated: null, fromEnv: false };

  const envPw = process.env.ADMIN_PASSWORD;
  let password;
  let fromEnv = false;
  if (envPw && String(envPw).length >= 8 && envPw !== "change-me") {
    password = String(envPw);
    fromEnv = true;
  } else {
    password = crypto.randomBytes(18).toString("base64url");
  }
  setSetting("admin_password_hash", hashPassword(password));
  return { generated: fromEnv ? null : password, fromEnv };
}

function verifyAdminPassword(password) {
  const stored = getSetting("admin_password_hash");
  if (!stored) ensureAdminPassword();
  return verifyPassword(password, getSetting("admin_password_hash"));
}

function changeAdminPassword(currentPassword, newPassword) {
  if (!verifyAdminPassword(currentPassword)) {
    const err = new Error("当前密码不正确");
    err.status = 401;
    throw err;
  }
  const next = String(newPassword || "");
  if (next.length < 10) {
    const err = new Error("新密码至少 10 位");
    err.status = 400;
    throw err;
  }
  if (next.length > 200) {
    const err = new Error("新密码过长");
    err.status = 400;
    throw err;
  }
  setSetting("admin_password_hash", hashPassword(next));
  return true;
}

function normalizeCode(code) {
  return String(code || "").trim().toUpperCase();
}

function makeDeliveryToken() {
  return crypto.randomBytes(18).toString("base64url");
}

/** 领取后须在多久内完成测验（小时），默认 24 */
function claimTtlHours() {
  const n = Number(process.env.CLAIM_TTL_HOURS);
  return Number.isFinite(n) && n > 0 ? n : 24;
}

function createCode({ code, note = "", maxUses = 1, maxOpens = 1 }) {
  const c = normalizeCode(code);
  if (!c || c.length < 4) {
    const err = new Error("兑换码至少 4 位");
    err.status = 400;
    throw err;
  }
  const token = makeDeliveryToken();
  const opens = Math.max(1, Number(maxOpens) || 1);
  const info = db
    .prepare(
      `INSERT INTO redeem_codes (code, note, max_uses, token, max_opens, open_count)
       VALUES (?, ?, ?, ?, ?, 0)`
    )
    .run(c, note || "", Math.max(1, Number(maxUses) || 1), token, opens);
  return getCodeById(info.lastInsertRowid);
}

function getCodeById(id) {
  return db.prepare(`SELECT * FROM redeem_codes WHERE id = ?`).get(id);
}

function getCodeByText(code) {
  return db
    .prepare(`SELECT * FROM redeem_codes WHERE code = ?`)
    .get(normalizeCode(code));
}

function getCodeByToken(token) {
  const t = String(token || "").trim();
  if (!t) return null;
  return db.prepare(`SELECT * FROM redeem_codes WHERE token = ?`).get(t);
}

function getCodeByQuizSession(sessionId) {
  return db
    .prepare(`SELECT * FROM redeem_codes WHERE quiz_session_id = ?`)
    .get(sessionId);
}

function listCodes() {
  return db.prepare(`SELECT * FROM redeem_codes ORDER BY id DESC`).all();
}

function setCodeActive(id, active) {
  db.prepare(`UPDATE redeem_codes SET active = ? WHERE id = ?`).run(active ? 1 : 0, id);
  return getCodeById(id);
}

function isClaimExpired(row) {
  if (!row || !row.claim_expires_at) return false;
  // SQLite datetime('now') 为 UTC：YYYY-MM-DD HH:MM:SS
  const raw = String(row.claim_expires_at).trim().replace(" ", "T");
  const expMs = Date.parse(raw.endsWith("Z") ? raw : raw + "Z");
  if (!Number.isFinite(expMs)) return false;
  return Date.now() > expMs;
}

/**
 * 发货链接首次打开：原子核销、展示卡密，并创建一码一测会话。
 * 再次打开：不返回 code。
 */
function openDeliveryToken(token, { userAgent } = {}) {
  const t = String(token || "").trim();
  if (!t || t.length < 8 || t.length > 128) {
    return { status: "invalid" };
  }

  return db.transaction(() => {
    const row = db.prepare(`SELECT * FROM redeem_codes WHERE token = ?`).get(t);
    if (!row) return { status: "invalid" };
    if (!row.active) return { status: "disabled", id: row.id };

    const maxOpens = Math.max(1, Number(row.max_opens) || 1);

    if (row.open_count >= maxOpens) {
      const attempt = row.quiz_session_id
        ? db.prepare(`SELECT * FROM attempts WHERE session_id = ?`).get(row.quiz_session_id)
        : null;
      return {
        status: "already_opened",
        id: row.id,
        opened_at: row.opened_at,
        used_at: row.used_at,
        open_count: row.open_count,
        max_opens: maxOpens,
        submitted: Boolean(attempt && attempt.submitted_at),
        expired: isClaimExpired(row) && !(attempt && attempt.submitted_at),
      };
    }

    const sessionId = crypto.randomBytes(16).toString("hex");
    const ttlH = claimTtlHours();
    const info = db
      .prepare(
        `UPDATE redeem_codes
         SET open_count = open_count + 1,
             opened_at = COALESCE(opened_at, datetime('now')),
             used_at = datetime('now'),
             quiz_session_id = ?,
             claim_expires_at = datetime('now', ?)
         WHERE id = ? AND open_count < ?`
      )
      .run(sessionId, `+${ttlH} hours`, row.id, maxOpens);

    if (info.changes !== 1) {
      const again = db.prepare(`SELECT * FROM redeem_codes WHERE id = ?`).get(row.id);
      return {
        status: "already_opened",
        id: again.id,
        opened_at: again.opened_at,
        used_at: again.used_at,
        open_count: again.open_count,
        max_opens: maxOpens,
      };
    }

    db.prepare(
      `INSERT INTO attempts (session_id, code_id, code_text, user_agent) VALUES (?, ?, ?, ?)`
    ).run(sessionId, row.id, row.code, userAgent || null);

    // 一码一测：领取即占用测验名额（used_count），防止另开会话复测
    db.prepare(
      `UPDATE redeem_codes SET used_count = MIN(max_uses, used_count + 1) WHERE id = ?`
    ).run(row.id);

    const updated = db.prepare(`SELECT * FROM redeem_codes WHERE id = ?`).get(row.id);
    return {
      status: "ok",
      id: updated.id,
      code: updated.code,
      note: updated.note,
      opened_at: updated.opened_at,
      used_at: updated.used_at,
      open_count: updated.open_count,
      max_opens: maxOpens,
      sessionId,
      claimExpiresAt: updated.claim_expires_at,
      quizPath: `/?session=${sessionId}`,
    };
  })();
}

function validateCodeForUse(codeText) {
  if (!codeText) {
    const err = new Error("需要通过发货链接领取后才能测验");
    err.status = 400;
    throw err;
  }
  const row = getCodeByText(codeText);
  if (!row) {
    const err = new Error("兑换码无效");
    err.status = 400;
    throw err;
  }
  if (!row.active) {
    const err = new Error("兑换码已停用");
    err.status = 400;
    throw err;
  }
  if (row.used_count >= row.max_uses) {
    const err = new Error("兑换码已用完（一码一测）");
    err.status = 400;
    throw err;
  }
  if (row.open_count > 0 && row.quiz_session_id) {
    const err = new Error("请使用发货链接打开的测验会话，勿重复兑换");
    err.status = 400;
    throw err;
  }
  return { ok: true, codeRow: row };
}

function consumeCode(codeId) {
  db.prepare(
    `UPDATE redeem_codes SET used_count = used_count + 1 WHERE id = ? AND used_count < max_uses`
  ).run(codeId);
}

function createAttempt({ sessionId, codeRow, userAgent }) {
  db.prepare(
    `INSERT INTO attempts (session_id, code_id, code_text, user_agent) VALUES (?, ?, ?, ?)`
  ).run(
    sessionId,
    codeRow ? codeRow.id : null,
    codeRow ? codeRow.code : null,
    userAgent || null
  );
  return db.prepare(`SELECT * FROM attempts WHERE session_id = ?`).get(sessionId);
}

function getAttempt(sessionId) {
  return db.prepare(`SELECT * FROM attempts WHERE session_id = ?`).get(sessionId);
}

function createFreePlayAttempt({ userAgent } = {}) {
  const sessionId = crypto.randomBytes(16).toString("hex");
  db.prepare(
    `INSERT INTO attempts (session_id, code_id, code_text, user_agent) VALUES (?, NULL, ?, ?)`
  ).run(sessionId, "FREE", userAgent || null);
  return getAttempt(sessionId);
}

/**
 * 用领取会话继续测验：须未提交、未过期、且绑定该码。
 * 免费试玩会话（无 code_id）仅校验存在且未提交。
 */
function resumeClaimSession(sessionId) {
  const sid = String(sessionId || "").trim();
  if (!sid) {
    const err = new Error("缺少会话");
    err.status = 400;
    throw err;
  }
  const attempt = getAttempt(sid);
  if (!attempt) {
    const err = new Error("会话不存在或已失效");
    err.status = 404;
    throw err;
  }
  if (attempt.submitted_at) {
    const err = new Error(
      attempt.code_id
        ? "该兑换已完成测验，无法重测（一码一测）"
        : "该试玩会话已提交，请重新开始"
    );
    err.status = 400;
    throw err;
  }

  // 免费试玩：无兑换码绑定
  if (!attempt.code_id) {
    return { attempt, codeRow: null, freePlay: true };
  }

  const codeRow = getCodeById(attempt.code_id);
  if (!codeRow || codeRow.quiz_session_id !== sid) {
    const err = new Error("会话与兑换码不匹配");
    err.status = 400;
    throw err;
  }
  if (!codeRow.active) {
    const err = new Error("兑换码已停用");
    err.status = 400;
    throw err;
  }
  if (isClaimExpired(codeRow)) {
    const err = new Error("领取已过期，请联系商家重新发货");
    err.status = 400;
    throw err;
  }
  return { attempt, codeRow, freePlay: false };
}

function submitAttempt(sessionId, { resultTerm, answers, scores, consume }) {
  const attempt = getAttempt(sessionId);
  if (!attempt) {
    const err = new Error("会话不存在");
    err.status = 404;
    throw err;
  }
  if (attempt.submitted_at) {
    const err = new Error("该会话已提交");
    err.status = 400;
    throw err;
  }

  if (attempt.code_id) {
    const codeRow = getCodeById(attempt.code_id);
    if (codeRow && isClaimExpired(codeRow)) {
      const err = new Error("领取已过期，无法提交");
      err.status = 400;
      throw err;
    }
  }

  const tx = db.transaction(() => {
    // 领取时已占用 used_count；提交不再二次消耗，除非旧会话未走领取链路
    if (consume && attempt.code_id) {
      const row = getCodeById(attempt.code_id);
      if (row && row.used_count < row.max_uses && !row.quiz_session_id) {
        consumeCode(attempt.code_id);
      }
    }
    db.prepare(
      `UPDATE attempts SET result_term = ?, answers_json = ?, scores_json = ?, submitted_at = datetime('now') WHERE session_id = ?`
    ).run(resultTerm, JSON.stringify(answers), JSON.stringify(scores), sessionId);
  });
  tx();
  return getAttempt(sessionId);
}

function aggregateStats() {
  const total = db.prepare(`SELECT COUNT(*) AS c FROM attempts WHERE submitted_at IS NOT NULL`).get().c;
  const byTerm = db
    .prepare(
      `SELECT result_term AS term, COUNT(*) AS count FROM attempts WHERE submitted_at IS NOT NULL AND result_term IS NOT NULL GROUP BY result_term ORDER BY count DESC`
    )
    .all();
  const codes = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) AS active,
              SUM(used_count) AS redemptions,
              SUM(CASE WHEN open_count > 0 THEN 1 ELSE 0 END) AS opened
       FROM redeem_codes`
    )
    .get();
  const recent = db
    .prepare(
      `SELECT id, session_id, code_text, result_term, submitted_at FROM attempts WHERE submitted_at IS NOT NULL ORDER BY id DESC LIMIT 20`
    )
    .all();
  return { totalSubmissions: total, byTerm, codes, recent };
}

module.exports = {
  db,
  dbPath,
  dataDir,
  createCode,
  listCodes,
  setCodeActive,
  validateCodeForUse,
  createAttempt,
  getAttempt,
  submitAttempt,
  aggregateStats,
  normalizeCode,
  ensureAdminPassword,
  verifyAdminPassword,
  changeAdminPassword,
  getCodeByToken,
  getCodeByQuizSession,
  openDeliveryToken,
  resumeClaimSession,
  createFreePlayAttempt,
  claimTtlHours,
  makeDeliveryToken,
};
