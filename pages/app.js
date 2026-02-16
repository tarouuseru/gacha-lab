console.log("[GACHA-LAB] app.js version: 2026-02-02-1");

console.log("[GLAB] app.js build=2026-01-13T23:59Z PAYWALL_SETRESULT_REMOVED");
const config = window.APP_CONFIG;
const supabaseClient = window.supabase.createClient(
  config.SUPABASE_URL,
  config.SUPABASE_ANON_KEY
);
const SPIN_API_URL = `${config.API_BASE}/api/spin`;
const LAST_SPIN_URL = `${config.API_BASE}/api/last-spin`;
const TRACK_API_URL = "https://gacha-mvp.glab-74.workers.dev/api/track";
const STATE_KEY = "gacha_state_v1";

const spinButton = document.getElementById("spinButton");
const resultTitle = document.getElementById("resultTitle");
const resultText = document.getElementById("resultText");
const resultCta = document.getElementById("resultCta");
const authStatus = document.getElementById("authStatus");

const loginModal = document.getElementById("loginModal");
const paywallModal = document.getElementById("paywallModal");
const loginSuccessModal = document.getElementById("loginSuccessModal");
const loginSuccessButton = document.getElementById("loginSuccessButton");
const paywallTitle = paywallModal?.querySelector("h3");
const paywallBody = paywallModal?.querySelector("p");
const paywallCta = paywallModal?.querySelector(".modal-actions .btn");

const loadingMessages = ["……", "見てるよ", "あと少し", "ちょっと待って"];

function defaultState() {
  return {
    v: 1,
    guest_token: null,
    firstSpin: {
      done: false,
      status: null,
      result: null,
      at: null,
    },
    auth: {
      loggedIn: false,
      userId: null,
    },
    ui: {
      step: "INIT",
      lastError: null,
    },
  };
}

function loadState() {
  let state = defaultState();
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      state = { ...state, ...parsed };
      state.firstSpin = { ...state.firstSpin, ...(parsed.firstSpin || {}) };
      state.auth = { ...state.auth, ...(parsed.auth || {}) };
      state.ui = { ...state.ui, ...(parsed.ui || {}) };
    }
  } catch {
    state = defaultState();
  }

  const legacyToken = localStorage.getItem("guest_token");
  if (!state.guest_token && legacyToken) {
    state.guest_token = legacyToken;
  }

  const legacySpin = sessionStorage.getItem("lastSpin") || null;
  if (!state.firstSpin.done && (legacySpin || window.__LAST_SPIN)) {
    try {
      const parsed = legacySpin ? JSON.parse(legacySpin) : window.__LAST_SPIN;
        if (parsed?.result) {
          state.firstSpin = {
            done: true,
            status: state.firstSpin.status || null,
            result: parsed.result,
            at: parsed.saved_at || Date.now(),
          };
        }
    } catch {
      // ignore legacy parse errors
    }
    sessionStorage.removeItem("lastSpin");
    delete window.__LAST_SPIN;
  }

  return state;
}

function saveState(state) {
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
}

function renderState() {
  // Reserved for future UI sync based on state.
}

let gachaState = loadState();
saveState(gachaState);

function updateState(patchFn) {
  const next = patchFn({ ...gachaState });
  gachaState = next;
  saveState(gachaState);
  renderState();
  return gachaState;
}

function setAuthStatus(message) {
  if (authStatus) authStatus.textContent = message;
}

function openModal(modal) {
  modal.classList.add("active");
}

function openPaywallModal(reason) {
  if (paywallTitle && paywallBody) {
    if (reason === "win_locked") {
      paywallTitle.textContent = "当選は確定しています";
      paywallBody.textContent =
        "この当選は保留中です。\n続きを進めて、受け取りを完了してください。";
      if (paywallCta) paywallCta.textContent = "当選を確定する";
    } else {
      paywallTitle.textContent = "ここから先は、選ばれた人だけ";
      paywallBody.textContent =
        "さっきの結果の“続き”は、ここから進めます。\n次で、結果が確定します。";
      if (paywallCta) paywallCta.textContent = "もう1回、続きを見る";
    }
  }
  if (paywallCta) {
    paywallCta.onclick = () => {
      trackPaywallClick(reason);
      navigateToContinue();
    };
  }
  openModal(paywallModal);
}

function closeModals() {
  [loginModal, paywallModal, loginSuccessModal].forEach((modal) =>
    modal?.classList.remove("active")
  );
}

function setResult({ title, body, cta }) {
  window.__srSeq = (window.__srSeq || 0) + 1;
  const __srId = window.__srSeq;
  const __srTs = Date.now();
  console.log(`[SR#${__srId}] setResult ENTER @${__srTs}`, { title, body, cta });
  const __stack = new Error().stack || "";
  let __from = "unknown";
  if (__stack.includes("spin")) __from = "spin";
  else if (__stack.includes("restoreLastSpin")) __from = "restoreLastSpin";
  else if (__stack.includes("resetLastSpinUI")) __from = "resetLastSpinUI";
  console.log(`[SR#${__srId}] from=${__from}`);
  window.__lastResultShownAt = Date.now();
  console.log("[SR payload]", { title, body, cta });
  try {
    localStorage.setItem(
      "gl:lastSpinResult:v1",
      JSON.stringify({
        version: 1,
        title,
        body,
        cta,
        shownAt: Date.now(),
        guest_token: localStorage.getItem("guest_token") || null,
      })
    );
    console.log("[SR] saved to localStorage");
  } catch (e) {
    console.warn("[SR] save failed", e);
  }
  console.trace("[SR stack]");
  console.log("setResult DOM refs", {
    resultTitle: resultTitle ? `#${resultTitle.id}` : null,
    resultText: resultText ? `#${resultText.id}` : null,
    resultCta: resultCta ? `#${resultCta.id}` : null,
  });
  if (resultTitle) resultTitle.textContent = title;
  if (resultText) {
    resultText.textContent = body;
    if (body) {
      resultText.classList.add("result-body");
    } else {
      resultText.classList.remove("result-body");
    }
  }
  if (resultCta) {
    resultCta.innerHTML = cta || "";
  }
  const leftCard = document.querySelector(".card.hero");
  if (leftCard) {
    if (title !== "結果") {
      leftCard.style.visibility = "hidden";
      leftCard.style.pointerEvents = "none";
      const grid = leftCard.closest(".grid");
      if (grid) {
        grid.style.gridTemplateColumns = "1fr 1fr";
      }
      const container = leftCard.closest(".container, .main, .wrap");
      if (container) {
        container.style.display = "flex";
        container.style.justifyContent = "flex-end";
      }
    } else {
      leftCard.style.visibility = "";
      leftCard.style.pointerEvents = "";
    }
  }
  // ===== SAVE LAST SPIN RESULT =====
  try {
    localStorage.setItem(
      "gl:lastSpinResult:v1",
      JSON.stringify({
        version: 1,
        title,
        body,
        cta,
        shownAt: Date.now(),
        guest_token: localStorage.getItem("guest_token") || null,
      })
    );
  } catch (e) {
    console.warn("[SR] save failed", e);
  }
}

function showResult(title, body, ctaHtml) {
  setResult({ title, body, cta: ctaHtml });
}

function winCtaLoggedIn() {
  return `<a class="btn" href="./me.html">案内を確認する</a>`;
}

function winCtaGuest() {
  return `<a class="btn" href="./second.html">案内を確認する</a>`;
}

function navigateToContinue() {
  const run = async () => {
    let state = gachaState || loadState();
    if (!state.firstSpin.done) {
      await restoreFromServer();
      state = gachaState || loadState();
    }
    const didFirst = window.localStorage.getItem("did_first_spin") === "1";
    const canSecond = window.localStorage.getItem("can_second_spin") === "1";
    if (!didFirst && !state.firstSpin.done) {
      alert("先に1回回してください");
      return;
    }
    if (!canSecond) {
      window.location.href = "./login.html";
      return;
    }
    console.log("[spin] second spin start");
    spin({ mode: "second" });
  };
  void run();
}

async function getAccessToken() {
  const { data } = await supabaseClient.auth.getSession();
  return data?.session?.access_token || null;
}

async function updateAuthUI() {
  const token = await getAccessToken();
  updateState((state) => ({
    ...state,
    auth: {
      ...state.auth,
      loggedIn: Boolean(token),
    },
  }));
  if (token) {
    setAuthStatus("残り1回（ログイン特典）");
  } else {
    setAuthStatus("無料1回のみ");
  }
}

function highlightSpinButton() {
  if (!spinButton) return;
  spinButton.classList.add("pulse");
  setTimeout(() => spinButton.classList.remove("pulse"), 1200);
}

function scrollToSpinButton() {
  spinButton?.scrollIntoView({ behavior: "smooth", block: "center" });
  highlightSpinButton();
}

function showLoginSuccessOnce() {
  const flag = window.localStorage.getItem("login_success");
  if (!flag || !loginSuccessModal) return;
  window.localStorage.removeItem("login_success");
  loginSuccessModal.classList.add("active");

  const closeAndScroll = () => {
    loginSuccessModal.classList.remove("active");
    scrollToSpinButton();
  };

  loginSuccessButton?.addEventListener("click", closeAndScroll, { once: true });
  setTimeout(closeAndScroll, 1100);
}

async function trackPaywallClick(reason) {
  const token = await getAccessToken();
  const guestToken = window.localStorage.getItem("guest_token");
  const headers = {
    "Content-Type": "application/json",
    ...(guestToken ? { "X-Guest-Token": guestToken } : {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    fetch(TRACK_API_URL, {
      method: "POST",
      headers,
      credentials: "include",
      body: JSON.stringify({
        event_name: "paywall_cta_click",
        reason,
        gacha_id: window.APP_CONFIG.GACHA_ID,
      }),
    });
  } catch {
    // ignore tracking errors
  }
}

async function spin(options = { mode: "first" }) {
  const mode = options?.mode || "first";
  if (spinButton) spinButton.disabled = true;
  closeModals();
  const loading = loadingMessages[Math.floor(Math.random() * loadingMessages.length)];
  setResult({ title: loading, body: "", cta: "" });

  const token = await getAccessToken();
  if (mode === "second" && !token) {
    setResult({
      title: "エラー",
      body: "ログインが必要です。",
      cta: "",
    });
    if (spinButton) spinButton.disabled = false;
    return;
  }
  const guestToken = window.localStorage.getItem("guest_token");
  const headers = {
    "Content-Type": "application/json",
    ...(guestToken ? { "X-Guest-Token": guestToken } : {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  console.log("[spin] guest_token (localStorage)", guestToken);
  console.log("[spin] request headers", headers);
  console.log("[spin] gacha_id", window.APP_CONFIG.GACHA_ID);

  const response = await fetch(SPIN_API_URL, {
    method: "POST",
    headers,
    credentials: "include",
    body: JSON.stringify({ gacha_id: window.APP_CONFIG.GACHA_ID }),
  });

  if (!response.ok) {
    let errorMessage = "通信に失敗しました。もう一度お試しください";
    let errorDetail = "";
    try {
      const errorText = await response.text();
      errorDetail = errorText ? `(${errorText})` : "";
      console.error("spin error response:", errorText);
    } catch {
      // ignore parse errors
    }
    setResult({
      title: "エラー",
      body: errorMessage,
      cta: `<button class="btn" data-action="spin-again">もう一度回す</button>${
        errorDetail ? `\n<div class="small">${errorDetail}</div>` : ""
      }`,
    });
    if (spinButton) spinButton.disabled = false;
    return;
  }

  const data = await response.json();
  console.log("[spin] raw response", data);
  console.log("[spin] status", data?.status);
  console.log("[spin] result fields", {
    resultTitle: data?.resultTitle,
    resultText: data?.resultText,
    resultImage: data?.resultImage,
    result: data?.result,
    prize: data?.prize,
  });
  console.log("[spin] api result", data);
  if (data?.guest_token) {
    window.localStorage.setItem("guest_token", data.guest_token);
    updateState((state) => ({ ...state, guest_token: data.guest_token }));
  }
  const freeResultNeedLogin = data.status === "FREE_RESULT_NEED_LOGIN";
  if (data.status === "NEED_LOGIN_FREE") {
    console.log("[BRANCH] NEED_LOGIN_FREE -> setResult", {
      status: data.status,
      result: data.result,
    });
    setResult({
      title: "この先は、続きになります",
      body: "さっきの続き、ちゃんと見せるね",
      cta: `<button class="btn" data-action="open-login">続きへ進む</button>
      <div class="small">ログインが必要です</div>`,
    });
    if (spinButton) spinButton.disabled = false;
    return;
  }

  if (data.status === "PAYWALL") {
    if (mode === "first") openPaywallModal("lose");
    if (spinButton) spinButton.disabled = false;
    return;
  }

  if (mode === "first" && (data.result === "WIN" || data.result === "LOSE")) {
    window.localStorage.setItem("did_first_spin", "1");
    console.log("[spin] did_first_spin saved");
    sessionStorage.setItem("HAS_SPUN_ONCE", "1");
    const spinResult = {
      result: data.result,
      redeem: data.redeem || null,
      saved_at: Date.now(),
    };
    sessionStorage.setItem("lastSpin", JSON.stringify(spinResult));
    window.__LAST_SPIN = spinResult;
    updateState((state) => ({
      ...state,
      firstSpin: {
        done: true,
        status: data.status || null,
        result: data.result,
        at: spinResult.saved_at,
      },
      ui: {
        ...state.ui,
        step: data.status === "FREE_RESULT_NEED_LOGIN" ? "NEED_LOGIN" : "SHOW_RESULT",
      },
    }));
  }
  if (mode === "second" && (data.result === "WIN" || data.result === "LOSE")) {
    window.localStorage.removeItem("can_second_spin");
  }
  const normalized = normalizeSpinPayload(data);
  renderSpinResult(normalized, token, mode);
  if (freeResultNeedLogin && mode === "first" && resultCta) {
    resultCta.innerHTML = `<button class="btn" data-action="open-login">続きへ進む</button>
      <div class="small">ログインが必要です</div>`;
  }

  if (spinButton) spinButton.disabled = false;
}

function renderSpinResult(data, token, mode = "first") {
  if (data?.resultTitle || data?.resultText || data?.resultImage) {
    setResult({
      title: data.resultTitle || "結果",
      body: data.resultText || "",
      cta: "",
    });
    return;
  }
  if (data.result === "WIN") {
    if (mode === "second") {
      const redeemCode = data.redeem?.code
        ? `\n\nおめでとうございます。\n今回の当選コードはこちらです。\n【${data.redeem.code}】`
        : "";
      setResult({
        title: "……",
        body: `今回は、ちゃんと選んだよ${redeemCode}`,
        cta: "",
      });
      return;
    }
    if (token) {
      const redeemCode = data.redeem?.code
        ? `\n\nおめでとうございます。\n今回の当選コードはこちらです。\n【${data.redeem.code}】`
        : "";
      setResult({
        title: "……",
        body: `今回は、ちゃんと選んだよ\n続きは、ログイン後に案内するね${redeemCode}`,
        cta: winCtaLoggedIn(),
      });
    } else {
      setResult({
        title: "当たりは確定しています",
        body: "この当選は保留中です。\nログインすると、当選内容を確認できます。",
        cta: `<a class="btn" href="./second.html">ログインして確認する</a>`,
      });
    }
  } else {
    if (mode === "second") {
      showResult("今回はここまで", "結果はここで確定しました。", "");
      return;
    }
    if (token) {
      showResult(
        "惜しい。",
        "正直、少し迷った\n今回はここまでだけど、\nこのまま終わるのは、ちょっとだけ惜しいかも",
        `<button class="btn cute" data-action="spin-again">もう一度回す</button>
         <div class="small">※残り1回で結果が確定します</div>`
      );
    } else {
      showResult(
        "惜しい。",
        "正直、少し迷った\n今回はここまでだけど、\nこのまま終わるのは、ちょっとだけ惜しいかも",
        `<a class="btn cute" href="./second.html">もう一回、続きを見る</a>
         <div class="small">※ログイン後、もう一度だけ確認できます</div>`
      );
    }
  }
}

function normalizeSpinPayload(data) {
  const normalized = { ...data };
  if (data?.result && typeof data.result === "object") {
    if (data.result.title) normalized.resultTitle = data.result.title;
    if (data.result.text) normalized.resultText = data.result.text;
    if (data.result.image) normalized.resultImage = data.result.image;
    if (data.result.result) normalized.result = data.result.result;
    if (data.result.win !== undefined && !normalized.result) {
      normalized.result = data.result.win ? "WIN" : "LOSE";
    }
  }
  return normalized;
}

async function restoreFromServer() {
  const token = await getAccessToken();
  const state = gachaState || loadState();
  const guestToken = state.guest_token || localStorage.getItem("guest_token");
  const headers = guestToken ? { "X-Guest-Token": guestToken } : {};
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const res = await fetch(LAST_SPIN_URL, {
      method: "GET",
      headers,
      credentials: "include",
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.exists) return null;
    const createdAt = data.created_at ? new Date(data.created_at) : null;
    if (!createdAt || Number.isNaN(createdAt.getTime())) return null;
    const ageMs = Date.now() - createdAt.getTime();
    if (ageMs > 5 * 60 * 1000) return null;

    updateState((prev) => ({
      ...prev,
      guest_token: prev.guest_token || guestToken,
      firstSpin: {
        done: true,
        status: prev.firstSpin.status || null,
        result: data.result,
        at: createdAt.getTime(),
      },
      ui: {
        ...prev.ui,
        step: prev.auth.loggedIn ? "SECOND_READY" : "NEED_LOGIN",
      },
    }));

    return {
      result: data.result,
      redeem: data.redeem,
      created_at: data.created_at,
    };
  } catch {
    return null;
  }
}

async function restoreLastSpin() {
  if (window.location.pathname.endsWith("/second.html")) {
    return;
  }
  let restored = false;
  window.__uiSeq = window.__uiSeq || 0;
  window.__rlSeq = window.__rlSeq || 0;
  const resetLastSpinUI = () => {
    window.__uiSeq += 1;
    const __uiId = window.__uiSeq;
    const __uiTs = Date.now();
    console.log(`[UI#${__uiId}] resetLastSpinUI ENTER @${__uiTs}`);
    console.trace("[UI] resetLastSpinUI stack");
    setResult({
      title: "結果",
      body: "まだ回していません。",
      cta: "",
    });
    if (spinButton) spinButton.disabled = false;
  };
  window.__rlSeq += 1;
  const __rlId = window.__rlSeq;
  const __rlTs = Date.now();
  console.log(`[RL#${__rlId}] restoreLastSpin ENTER @${__rlTs}`);
  const token = await getAccessToken();
  const guestToken = window.localStorage.getItem("guest_token");
  const headers = guestToken ? { "X-Guest-Token": guestToken } : {};
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const cached = sessionStorage.getItem("lastSpin");
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        const savedAt = Number(parsed.saved_at || 0);
        if (savedAt && Date.now() - savedAt <= 5 * 60 * 1000) {
          renderSpinResult(
            {
              result: parsed.result,
              redeem: parsed.redeem || null,
            },
            token
          );
          restored = true;
          if (parsed.result === "LOSE") {
            openPaywallModal("lose");
          } else if (parsed.result === "WIN" && !token) {
            openPaywallModal("win_locked");
          }
          return;
        }
        sessionStorage.removeItem("lastSpin");
      } catch {
        sessionStorage.removeItem("lastSpin");
      }
    }

    const serverSpin = await restoreFromServer();
    if (!serverSpin) return;
    renderSpinResult(
      {
        result: serverSpin.result,
        redeem: serverSpin.redeem,
      },
      token
    );
    restored = true;
  } catch {
    // ignore restore errors
  } finally {
    const __rlTsDone = Date.now();
    console.log(`[RL#${__rlId}] restoreLastSpin FINALLY @${__rlTsDone}`, {
      restored,
    });
    if (!restored) {
      const lastShown = window.__lastResultShownAt || 0;
      if (Date.now() - lastShown >= 3000) {
        resetLastSpinUI();
      }
    }
  }
}

spinButton?.addEventListener("click", spin);

resultCta?.addEventListener("click", (event) => {
  const target = event.target;
  if (target && target.matches("[data-action='spin-again']")) {
    spin();
  }
  if (target && target.matches("[data-action='open-login']")) {
    window.location.href = "./login.html";
  }
  const link = target?.closest?.("a");
  if (link && link.getAttribute("href")?.includes("second.html")) {
    event.preventDefault();
    navigateToContinue();
  }
});

document.querySelectorAll("[data-close]").forEach((button) => {
  button.addEventListener("click", closeModals);
});

updateAuthUI();
const forceRestore = new URL(location.href).searchParams.get("restore") === "1";
if (forceRestore) {
  restoreLastSpin();
  const url = new URL(location.href);
  url.searchParams.delete("restore");
  history.replaceState({}, "", url.toString());
}
if (!window.location.pathname.endsWith("/second.html")) {
  restoreLastSpin();
}
