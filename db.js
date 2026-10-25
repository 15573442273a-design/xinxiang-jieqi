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

/**
 * 若库中尚无管理员哈希：用 ADMIN_PASSWORD 引导，否则生成强随机密码并写入。
 * @returns {{ generated: string|null, fromEnv: boolean }}
 */
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
  if (!stored) {
    ensureAdminPassword();
  }
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

function createCode({ code, note = "", maxUses = 1 }) {
  const c = normalizeCode(code);
  if (!c || c.length < 4) {
    const err = new Error("兑换码至少 4 位");
    err.status = 400;
    throw err;
  }
  const info = db
    .prepare(`INSERT INTO redeem_codes (code, note, max_uses) VALUES (?, ?, ?)`)
    .run(c, note || "", Math.max(1, Number(maxUses) || 1));
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

function listCodes() {
  return db.prepare(`SELECT * FROM redeem_codes ORDER BY id DESC`).all();
}

function setCodeActive(id, active) {
  db.prepare(`UPDATE redeem_codes SET active = ? WHERE id = ?`).run(active ? 1 : 0, id);
  return getCodeById(id);
}

function validateCodeForUse(codeText) {
  if (!codeText) return { ok: true, codeRow: null, optional: true };
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
    const err = new Error("兑换码已用完");
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

  const tx = db.transaction(() => {
    if (consume && attempt.code_id) consumeCode(attempt.code_id);
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
      `SELECT COUNT(*) AS total, SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) AS active, SUM(used_count) AS redemptions FROM redeem_codes`
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
};
