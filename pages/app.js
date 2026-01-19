console.log("[GLAB] app.js build=2026-01-13T23:59Z PAYWALL_SETRESULT_REMOVED");
const config = window.APP_CONFIG;
const supabaseClient = window.supabase.createClient(
  config.SUPABASE_URL,
  config.SUPABASE_ANON_KEY
);
const SPIN_API_URL = `${config.API_BASE}/api/spin`;
const LAST_SPIN_URL = `${config.API_BASE}/api/last-spin`;
const TRACK_API_URL = "https://gacha-mvp.glab-74.workers.dev/api/track";

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
  const didFirst = window.localStorage.getItem("did_first_spin") === "1";
  const canSecond = window.localStorage.getItem("can_second_spin") === "1";
  if (!didFirst) {
    alert("先に1回回してください");
    return;
  }
  if (!canSecond) {
    window.location.href = "./login.html";
    return;
  }
  console.log("[spin] second spin start");
  spin({ mode: "second" });
}

async function getAccessToken() {
  const { data } = await supabaseClient.auth.getSession();
  return data?.session?.access_token || null;
}

async function updateAuthUI() {
  const token = await getAccessToken();
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
  console.log("[spin] api result", data);
  if (data?.guest_token) {
    window.localStorage.setItem("guest_token", data.guest_token);
  }
  if (data.status === "NEED_LOGIN_FREE") {
    if (mode === "first") openModal(loginModal);
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
    const lastSpin = {
      result: data.result,
      redeem: data.redeem || null,
      saved_at: Date.now(),
    };
    sessionStorage.setItem("lastSpin", JSON.stringify(lastSpin));
  }
  if (mode === "second" && (data.result === "WIN" || data.result === "LOSE")) {
    window.localStorage.removeItem("can_second_spin");
  }
  renderSpinResult(data, token, mode);

  if (spinButton) spinButton.disabled = false;
}

function renderSpinResult(data, token, mode = "first") {
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

async function restoreLastSpin() {
  if (window.location.pathname.endsWith("/second.html")) {
    return;
  }
  const token = await getAccessToken();
  const guestToken = window.localStorage.getItem("guest_token");
  const headers = guestToken ? { "X-Guest-Token": guestToken } : {};
  if (token) headers.Authorization = `Bearer ${token}`;

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

  try {
    const res = await fetch(LAST_SPIN_URL, {
      method: "GET",
      headers,
      credentials: "include",
    });
    if (!res.ok) return;
    const data = await res.json();
    if (!data?.exists) return;
    const createdAt = data.created_at ? new Date(data.created_at) : null;
    if (!createdAt || Number.isNaN(createdAt.getTime())) return;
    const ageMs = Date.now() - createdAt.getTime();
    if (ageMs > 5 * 60 * 1000) return;
    renderSpinResult(
      {
        result: data.result,
        redeem: data.redeem,
      },
      token
    );
  } catch {
    // ignore restore errors
  }
}

spinButton?.addEventListener("click", spin);

resultCta?.addEventListener("click", (event) => {
  const target = event.target;
  if (target && target.matches("[data-action='spin-again']")) {
    spin();
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
if (!window.location.pathname.endsWith("/second.html")) {
  restoreLastSpin();
}
