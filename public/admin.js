(function () {
  const TOKEN_KEY = "xinxiang-admin-token";
  let token = localStorage.getItem(TOKEN_KEY) || "";

  const loginPanel = document.getElementById("login-panel");
  const dash = document.getElementById("dash");
  const loginErr = document.getElementById("login-err");

  async function api(path, options = {}) {
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    if (token) headers.Authorization = "Bearer " + token;
    const res = await fetch(path, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "请求失败");
    return data;
  }

  function showDash(yes) {
    loginPanel.hidden = yes;
    dash.hidden = !yes;
  }

  async function refresh() {
    const [codesData, stats] = await Promise.all([
      api("/api/admin/codes"),
      api("/api/admin/stats"),
    ]);
    const s = document.getElementById("stats");
    s.innerHTML = `
      <div class="stat"><b>${stats.totalSubmissions}</b><span>已提交测验</span></div>
      <div class="stat"><b>${stats.codes.total || 0}</b><span>兑换码总数</span></div>
      <div class="stat"><b>${stats.codes.active || 0}</b><span>启用中</span></div>
      <div class="stat"><b>${stats.codes.redemptions || 0}</b><span>累计核销次数</span></div>
    `;
    const tbody = document.getElementById("codes-body");
    tbody.innerHTML = "";
    codesData.codes.forEach((c) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><code>${c.code}</code></td>
        <td>${escapeHtml(c.note || "")}</td>
        <td>${c.used_count} / ${c.max_uses}</td>
        <td>${c.active ? "启用" : "停用"}</td>
        <td></td>
      `;
      const btn = document.createElement("button");
      btn.className = "ghost";
      btn.textContent = c.active ? "停用" : "启用";
      btn.style.marginTop = "0";
      btn.style.padding = "0.25rem 0.7rem";
      btn.style.fontSize = "0.8rem";
      btn.onclick = async () => {
        await api("/api/admin/codes/" + c.id, {
          method: "PATCH",
          body: JSON.stringify({ active: !c.active }),
        });
        refresh();
      };
      tr.lastElementChild.appendChild(btn);
      tbody.appendChild(tr);
    });

    const ul = document.getElementById("term-stats");
    ul.innerHTML = "";
    (stats.byTerm || []).forEach((row) => {
      const li = document.createElement("li");
      li.textContent = `${row.term || "?"} ：${row.count}`;
      ul.appendChild(li);
    });
    if (!(stats.byTerm || []).length) {
      ul.innerHTML = "<li>暂无数据</li>";
    }

    const recent = document.getElementById("recent");
    recent.innerHTML = "";
    (stats.recent || []).forEach((r) => {
      const li = document.createElement("li");
      li.textContent = `#${r.id} ${r.result_term || "-"} · 码:${r.code_text || "无"} · ${r.submitted_at}`;
      recent.appendChild(li);
    });
    if (!(stats.recent || []).length) recent.innerHTML = "<li>暂无提交</li>";
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  document.getElementById("btn-login").onclick = async () => {
    loginErr.hidden = true;
    try {
      const data = await api("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ password: document.getElementById("password").value }),
      });
      token = data.token;
      localStorage.setItem(TOKEN_KEY, token);
      showDash(true);
      await refresh();
    } catch (e) {
      loginErr.textContent = e.message;
      loginErr.hidden = false;
    }
  };

  document.getElementById("btn-pw").onclick = async () => {
    const err = document.getElementById("pw-err");
    const ok = document.getElementById("pw-ok");
    err.hidden = true;
    ok.hidden = true;
    const currentPassword = document.getElementById("pw-current").value;
    const newPassword = document.getElementById("pw-new").value;
    const new2 = document.getElementById("pw-new2").value;
    if (newPassword !== new2) {
      err.textContent = "两次新密码不一致";
      err.hidden = false;
      return;
    }
    try {
      const data = await api("/api/admin/password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      ok.textContent = data.message || "已更新";
      ok.hidden = false;
      token = "";
      localStorage.removeItem(TOKEN_KEY);
      document.getElementById("pw-current").value = "";
      document.getElementById("pw-new").value = "";
      document.getElementById("pw-new2").value = "";
      setTimeout(() => showDash(false), 800);
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
    }
  };

  document.getElementById("btn-create").onclick = async () => {
    const out = document.getElementById("created-out");
    try {
      const data = await api("/api/admin/codes", {
        method: "POST",
        body: JSON.stringify({
          code: document.getElementById("code-prefix").value.trim() || undefined,
          count: Number(document.getElementById("code-count").value) || 1,
          maxUses: Number(document.getElementById("code-uses").value) || 1,
          note: document.getElementById("code-note").value.trim(),
        }),
      });
      out.hidden = false;
      out.textContent = data.codes.map((c) => c.code).join("\n");
      await refresh();
    } catch (e) {
      out.hidden = false;
      out.textContent = e.message;
    }
  };

  document.getElementById("btn-refresh").onclick = () => refresh().catch(alert);
  document.getElementById("btn-logout").onclick = () => {
    token = "";
    localStorage.removeItem(TOKEN_KEY);
    showDash(false);
  };

  if (token) {
    showDash(true);
    refresh().catch(() => {
      token = "";
      localStorage.removeItem(TOKEN_KEY);
      showDash(false);
    });
  }
})();
