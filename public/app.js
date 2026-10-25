/**
 * 心象节气 — 前端（对接本地 API）
 */
(function () {
  "use strict";

  const els = {
    landing: document.getElementById("screen-landing"),
    quiz: document.getElementById("screen-quiz"),
    analyzing: document.getElementById("screen-analyzing"),
    result: document.getElementById("screen-result"),
    btnStart: document.getElementById("btn-start"),
    btnBack: document.getElementById("btn-back"),
    btnCopy: document.getElementById("btn-copy"),
    btnRetry: document.getElementById("btn-retry"),
    questionText: document.getElementById("question-text"),
    options: document.getElementById("options"),
    progressBar: document.getElementById("progress-bar"),
    progressCurrent: document.getElementById("progress-current"),
    progressTotal: document.getElementById("progress-total"),
    moodLabel: document.getElementById("mood-label"),
    resultSeason: document.getElementById("result-season"),
    resultTitle: document.getElementById("result-title"),
    resultMeaning: document.getElementById("result-meaning"),
    resultPoem: document.getElementById("result-poem"),
    resultStrengths: document.getElementById("result-strengths"),
    resultBlind: document.getElementById("result-blind"),
    shareLine: document.getElementById("share-line"),
    copyToast: document.getElementById("copy-toast"),
  };

  let questions = [];
  let index = 0;
  let answers = [];
  let sessionId = null;
  let lastResult = null;

  function ensureGateUI() {
    if (document.getElementById("redeem-gate")) {
      if (!document.getElementById("code-input")) {
        const wrap = document.getElementById("redeem-gate");
        const hint = document.getElementById("gate-hint");
        const inputHtml =
          '<label class="code-label" for="code-input">兑换码 / 卡密（可选）</label>' +
          '<input type="text" id="code-input" class="code-input" placeholder="有卡密可在此输入，没有直接点开始" autocomplete="off" />';
        wrap.insertAdjacentHTML("afterbegin", inputHtml);
        if (hint) hint.textContent = "当前可直接开测（临时免码）。若有卡密也可输入。";
      }
      return;
    }
    const btn = els.btnStart;
    const wrap = document.createElement("div");
    wrap.className = "code-wrap";
    wrap.id = "redeem-gate";
    wrap.innerHTML =
      '<p class="code-hint" id="gate-hint">当前可直接开测（临时免码）。若有卡密也可输入。</p>' +
      '<label class="code-label" for="code-input">兑换码 / 卡密（可选）</label>' +
      '<input type="text" id="code-input" class="code-input" placeholder="有卡密可在此输入，没有直接点开始" autocomplete="off" />' +
      '<p class="code-hint" id="gate-session" hidden></p>';
    btn.parentNode.insertBefore(wrap, btn);
  }

  function readQuery() {
    const q = new URLSearchParams(location.search);
    return {
      session: (q.get("session") || "").trim(),
      code: (q.get("code") || "").trim(),
    };
  }

  // inject deep block container in result if missing
  function ensureDeepBlock() {
    if (document.getElementById("result-deep")) return;
    const poem = els.resultPoem;
    const deep = document.createElement("p");
    deep.className = "result-deep";
    deep.id = "result-deep";
    poem.parentNode.insertBefore(deep, poem.nextSibling);
  }

  async function api(path, options) {
    const res = await fetch(path, {
      headers: { "Content-Type": "application/json", ...(options && options.headers) },
      ...options,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "请求失败");
    return data;
  }

  function showScreen(name) {
    const map = {
      landing: els.landing,
      quiz: els.quiz,
      analyzing: els.analyzing,
      result: els.result,
    };
    Object.values(map).forEach((el) => {
      el.hidden = true;
      el.classList.remove("is-active");
    });
    const target = map[name];
    target.hidden = false;
    void target.offsetWidth;
    target.classList.add("is-active");
  }

  function renderQuestion() {
    const item = questions[index];
    els.questionText.textContent = item.q;
    els.progressCurrent.textContent = String(index + 1);
    els.progressTotal.textContent = String(questions.length);
    const pct = Math.round((index / questions.length) * 100);
    els.progressBar.style.width = pct + "%";
    els.progressBar.setAttribute("aria-valuenow", String(pct));
    els.moodLabel.textContent = item.moodLabel || "";
    els.quiz.setAttribute("data-mood", item.mood || "spring");

    els.options.innerHTML = "";
    item.options.forEach((opt, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "option";
      btn.setAttribute("role", "option");
      btn.textContent = opt.text;
      if (answers[index] === opt.id) btn.classList.add("is-selected");
      btn.addEventListener("click", () => selectOption(opt.id));
      els.options.appendChild(btn);
      btn.style.opacity = "0";
      btn.style.transform = "translateY(8px)";
      requestAnimationFrame(() => {
        setTimeout(() => {
          btn.style.transition =
            "opacity 0.35s ease, transform 0.35s ease, border-color 0.2s, background 0.2s, box-shadow 0.2s";
          btn.style.opacity = "1";
          btn.style.transform = "translateY(0)";
        }, 40 * i);
      });
    });
    els.btnBack.hidden = index === 0;
  }

  function selectOption(optionId) {
    answers[index] = optionId;
    Array.from(els.options.children).forEach((child) => {
      const opt = questions[index].options.find((o) => o.id === optionId);
      child.classList.toggle("is-selected", child.textContent === (opt && opt.text));
    });
    setTimeout(() => {
      if (index < questions.length - 1) {
        index += 1;
        renderQuestion();
      } else {
        finishQuiz();
      }
    }, 220);
  }

  async function finishQuiz() {
    showScreen("analyzing");
    try {
      const data = await api("/api/quiz/submit", {
        method: "POST",
        body: JSON.stringify({ sessionId, answers }),
      });
      lastResult = data.result;
      setTimeout(() => {
        renderResult(data.result);
        showScreen("result");
        els.progressBar.style.width = "100%";
      }, 900);
    } catch (e) {
      els.analyzing.querySelector(".analyzing-text").textContent =
        "提交失败：" + (e.message || "请确认已启动服务");
    }
  }

  function renderResult(r) {
    els.result.setAttribute("data-group", r.group || "");
    els.resultSeason.textContent = r.seasonLabel || "";
    els.resultTitle.textContent = r.name || "";
    els.resultMeaning.textContent = r.meaning || "";
    els.resultPoem.textContent = r.poem || "";

    const flavor = document.getElementById("result-flavor");
    if (flavor) {
      if (r.flavorTag) {
        flavor.hidden = false;
        flavor.textContent = r.flavorTag;
      } else {
        flavor.hidden = true;
      }
    }
    const culture = document.getElementById("result-culture");
    const ph = document.getElementById("result-phenology");
    const ri = document.getElementById("result-ritual");
    if (culture && ph && ri) {
      if (r.phenology || r.ritual) {
        culture.hidden = false;
        ph.textContent = r.phenology || "";
        ri.textContent = r.ritual || "";
      } else {
        culture.hidden = true;
      }
    }

    const deepEl = document.getElementById("result-deep");
    if (deepEl) {
      // 保留段落换行
      deepEl.textContent = "";
      const parts = String(r.deep || "").split(/\n\n+/);
      parts.forEach((para) => {
        if (!para.trim()) return;
        const p = document.createElement("p");
        p.textContent = para.trim();
        deepEl.appendChild(p);
      });
    }

    els.resultBlind.textContent = r.blind || "";
    els.shareLine.textContent = r.share || "";
    els.resultStrengths.innerHTML = "";
    (r.strengths || []).forEach((s) => {
      const li = document.createElement("li");
      li.textContent = s;
      els.resultStrengths.appendChild(li);
    });
    els.copyToast.hidden = true;
  }

  function resetQuiz() {
    index = 0;
    answers = [];
    lastResult = null;
    questions = [];
    sessionId = null;
    localStorage.removeItem("xinxiang-claim-session");
    const t = els.analyzing.querySelector(".analyzing-text");
    if (t) t.textContent = "正在对照二十四候…";
    showScreen("landing");
    const gate = document.getElementById("gate-session");
    if (gate) {
      gate.hidden = false;
      gate.textContent = "可直接再测一次（临时免码）。若使用卡密，同一码仍不可重复开测。";
    }
  }

  async function copyShare() {
    if (!lastResult) return;
    const text = lastResult.share + "\n（娱乐向自我探索 · 非医学诊断）";
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      els.copyToast.hidden = false;
      setTimeout(() => {
        els.copyToast.hidden = true;
      }, 2000);
    } catch (_) {
      els.copyToast.textContent = "复制失败，请长按分享文案手动复制";
      els.copyToast.hidden = false;
    }
  }

  els.btnStart.addEventListener("click", async () => {
    ensureGateUI();
    const q = readQuery();
    const codeInput = document.getElementById("code-input");
    const codeTyped = (codeInput && codeInput.value ? codeInput.value : "").trim();
    let sid = sessionId || q.session || localStorage.getItem("xinxiang-claim-session") || "";
    const code = codeTyped || q.code || "";
    els.btnStart.disabled = true;
    els.btnStart.textContent = "入候中…";
    try {
      if (!sid && code) {
        const claimed = await api("/api/quiz/claim", {
          method: "POST",
          body: JSON.stringify({ code }),
        });
        sid = claimed.sessionId;
        sessionId = sid;
        localStorage.setItem("xinxiang-claim-session", sid);
        const gate = document.getElementById("gate-session");
        if (gate) {
          gate.hidden = false;
          gate.textContent = "兑换成功，可开始测验（一码一测）。";
        }
      }
      // 无会话且无卡密：走免码试玩（服务端创建 FREE 会话）
      const data = await api("/api/quiz/start", {
        method: "POST",
        body: JSON.stringify(sid ? { sessionId: sid } : {}),
      });
      sessionId = data.sessionId;
      if (data.freePlay) {
        localStorage.removeItem("xinxiang-claim-session");
      } else {
        localStorage.setItem("xinxiang-claim-session", sessionId);
      }
      questions = data.questions;
      answers = Array(questions.length).fill(null);
      index = 0;
      showScreen("quiz");
      renderQuestion();
    } catch (e) {
      alert(e.message || "无法开始测验");
      localStorage.removeItem("xinxiang-claim-session");
      sessionId = null;
    } finally {
      els.btnStart.disabled = false;
      els.btnStart.textContent = "开始入候";
    }
  });

  els.btnBack.addEventListener("click", () => {
    if (index > 0) {
      index -= 1;
      renderQuestion();
    }
  });

  els.btnRetry.addEventListener("click", resetQuiz);
  els.btnCopy.addEventListener("click", copyShare);

  ensureGateUI();
  ensureDeepBlock();

  const bootQ = readQuery();
  if (bootQ.session) {
    sessionId = bootQ.session;
    localStorage.setItem("xinxiang-claim-session", sessionId);
    const gate = document.getElementById("gate-session");
    if (gate) {
      gate.hidden = false;
      gate.textContent = "已检测到领取会话，可直接开始测验（一码一测，提交后不可重测）。";
    }
    const hint = document.getElementById("gate-hint");
    if (hint) hint.hidden = true;
  } else if (bootQ.code) {
    const gate = document.getElementById("gate-session");
    if (gate) {
      gate.hidden = false;
      gate.textContent = "检测到 ?code= 参数。正式开测请使用发货链接 /redeem/… 领取会话。卡密：" + bootQ.code;
    }
  }

  showScreen("landing");
})();
