# 心象节气 · 二十四候测验

娱乐向人格洞察小站：用**二十四节气**对照内在气候。淡绿色季节视觉 + Express / SQLite 后端（兑换码、提交统计、可改后台密码）。

> **声明**：仅供娱乐与自我反思，**不构成**心理或医学评估、诊断或治疗建议。

## 快速启动

```bash
cd psych-quiz
npm install
npm start
```

默认地址：

- 测验：http://127.0.0.1:3780/
- 管理后台：http://127.0.0.1:3780/admin.html

### 管理员密码

- 密码以 **scrypt 哈希**存在 SQLite（`app_settings.admin_password_hash`），**不会**明文写入仓库。
- **首次启动**：
  1. 若设置了环境变量 `ADMIN_PASSWORD`（且不是占位符 `change-me`、长度 ≥ 8），则用它引导写入库；
  2. 否则**自动生成强随机密码**，并在控制台打印一次（请立即保存）。
- 登录后台后可在「修改密码」中更换（至少 10 位）；改密后需重新登录。
- 切勿把真实密码提交到 Git。可用 `.env`（已 gitignore）本地配置。

```bash
ADMIN_PASSWORD='你的强密码至少八位' npm start
```

### 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `PORT` | `3780` | 监听端口（Render / Railway 会注入） |
| `ADMIN_PASSWORD` | （无则随机生成） | 仅首次引导写入 DB 的明文；之后以库内哈希为准 |
| `DB_PATH` | `data/quiz.sqlite` | SQLite 文件路径 |
| `DATA_DIR` | `data/` | 数据目录；若不可写会回退 `/tmp/xinxiang-jieqi-data` |

**免费档注意**：Render / Railway 免费实例磁盘多为**临时**的，重启可能丢库。`render.yaml` 默认 `DB_PATH=/tmp/xinxiang-quiz.sqlite`。若要持久化，请挂载磁盘或外置数据库。

## 功能

- **14 题单选** → **24 种节气结果**（加权计分）
- 结果含：节气名、短义、诗意短章、**物候 / 习俗意象**、**深度解读**（含物候映照）
- **路径差异**：同一主节气，因选项指纹不同，会看到不同的「路径细读」、邻候气息标签，以及第三序位余音——不是只看最终节气名
- 三项光亮、温柔盲点、分享句
- 兑换码（可选）核销；后台批量发码、启用/停用、统计

## 免费公网部署（推荐 Render Free）

本项目需要 Node，不能只用静态 Pages。

### Render（免信用卡的免费 Web 常见选项）

1. 把本目录推到 **GitHub** 仓库（不要包含 `.env` / sqlite / 密码）。
2. 打开 [Render Dashboard](https://dashboard.render.com/) → New → Blueprint 或 Web Service，连该仓库。
3. 也可使用仓库内 `render.yaml`（已含 `ADMIN_PASSWORD` 自动生成、`DB_PATH=/tmp/...`）。
4. 部署完成后打开 `https://<服务名>.onrender.com/`；后台 `/admin.html`。
5. 到 Render 的 Environment 查看生成的 `ADMIN_PASSWORD`，**首次启动会写入 DB**；之后改密请用后台，或以清空 DB 重新引导。

> 免费实例会休眠，冷启动较慢；SQLite 在 `/tmp` 上重启可能重置——属免费档限制。

### Railway

可用 `railway.json` + `Dockerfile` / Nixpacks。Railway 现今多需登录与额度确认；若要求绑卡，请改用 Render Free。部署时同样设置 `ADMIN_PASSWORD`，勿把密钥写进代码。

### 本地临时公网（开发）

可用 Cloudflare Tunnel / ngrok 指向本机 `PORT`，域名会变且依赖本机开机。

## API 摘要

- `GET /api/questions` — 题目（无权重）
- `POST /api/quiz/start` — `{ code? }` → `sessionId`
- `POST /api/quiz/submit` — `{ sessionId, answers }` → 个性化深度结果
- `POST /api/admin/login` — `{ password }` → `token`
- `POST /api/admin/password` — `{ currentPassword, newPassword }`（需登录）
- `GET/POST /api/admin/codes`、`PATCH /api/admin/codes/:id`、`GET /api/admin/stats`

## 目录

```
psych-quiz/
├── server.js
├── db.js
├── lib/questions.js | score.js | terms.js | path-text.js
├── public/
├── render.yaml | railway.json | Procfile | Dockerfile
└── README.md
```

## 小红书一码一测发货链接

1. 登录 `/admin.html`，生成兑换码。
2. 复制「发货链接」：`https://xinxiang-jieqi.onrender.com/redeem/<token>`（URL 中是不透明 token，不是卡密明文）。
3. 填入小红书自动发货模板（平台只发链接即可）。
4. 买家**第一次**打开链接：展示卡密，并绑定一次测验会话（`/?session=...`）。
5. **第二次及以后**打开：只显示「已失效/已领取」，不再展示卡密。
6. 首页需持有领取会话才能开测；提交后同一码不可重测。领取后默认 24 小时内须完成（`CLAIM_TTL_HOURS`）。

环境变量：`PUBLIC_BASE_URL`（后台复制链接用的公网域名）、`CLAIM_TTL_HOURS`。

