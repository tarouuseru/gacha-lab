const config = window.APP_CONFIG;
const supabaseClient = window.supabase.createClient(
  config.SUPABASE_URL,
  config.SUPABASE_ANON_KEY
);
const LAST_SPIN_URL = "/api/last-spin?t=" + Date.now();
const TRACK_API_URL = "/api/track";

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
  reason = (typeof reason === "string" && reason) ? reason : "unknown";
  if (typeof window.gtag === "function") window.gtag("event", "paywall_view", { reason });
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
  if (resultTitle) resultTitle.textContent = title;
  if (resultText) {
    resultText.textContent = body;
    if (body) {
      resultText.classList.add("result-body");
    } else {
      resultText.classList.remove("result-body");
    }
  }
  resultCta.innerHTML = cta || "";
}

function showResult(title, body, ctaHtml) {
  setResult({ title, body, cta: ctaHtml });
}

function winCtaLoggedIn() {
  return `<a class="btn" href="./me.html">案内を確認する</a>`;
}

function winCtaGuest() {
  return `<a class="btn" href="./login.html">案内を確認する</a>`;
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
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    fetch(TRACK_API_URL, {
      method: "POST",
      headers,
      credentials: "include",
      body: JSON.stringify({
        event_name: "paywall_cta_click",
        reason,
        ...(config.GACHA_ID ? { gacha_id: config.GACHA_ID } : {}),
      }),
    });
  } catch {
    // ignore tracking errors
  }
}

async function spin() {
  spinButton.disabled = true;
  closeModals();
  const loading = loadingMessages[Math.floor(Math.random() * loadingMessages.length)];
  setResult({ title: loading, body: "", cta: "" });

  const token = await getAccessToken();
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  if (window.gtag) window.gtag("event", "spin_1_click");
  const response = await fetch("/api/spin", {
    method: "POST",
    headers,
    credentials: "include",
    body: JSON.stringify(config.GACHA_ID ? { gacha_id: config.GACHA_ID } : {}),
  });

  if (!response.ok) {
    let responseJson = null;
    try {
      responseJson = await response.clone().json();
    } catch {
      responseJson = null;
    }

    const alreadySpun =
      response.status === 409 &&
      (responseJson?.code === "ALREADY_SPUN" ||
        responseJson?.status === "ALREADY_SPUN" ||
        responseJson?.error === "ALREADY_SPUN");
    if (alreadySpun && window.gtag) window.gtag("event", "spin_2_click");

    if (alreadySpun) {
      try {
        await restoreLastSpin();
      } catch {}
      spinButton.disabled = false;
      return;
    }
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
    spinButton.disabled = false;
    return;
  }

  const data = await response.json();
  if (data.status === "NEED_LOGIN_FREE") {
    openModal(loginModal);
    setResult({
      title: "この先は、続きになります",
      body: "さっきの続き、ちゃんと見せるね",
      cta: "",
    });
    spinButton.disabled = false;
    return;
  }

  if (data.status === "PAYWALL") {
    openPaywallModal("lose");
    setResult({
      title: "ここから先は、選んだ人だけ",
      body: "さっきの“続き”は残してある。\n次で、案内まで進める。",
      cta: "",
    });
    spinButton.disabled = false;
    return;
  }

  renderSpinResult(data, token);

  spinButton.disabled = false;
}

function renderSpinResult(data, token) {
  if (data.result === "WIN") {
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
        cta: `<a class="btn" href="./login.html">ログインして確認する</a>`,
      });
      openPaywallModal("win_locked");
    }
  } else {
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
        `<a class="btn cute" href="./login.html">続きを確認する</a>
         <div class="small">※ログイン後、もう一度だけ確認できます</div>`
      );
    }
  }
}

async function restoreLastSpin() {
  const token = await getAccessToken();
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const res = await fetch(LAST_SPIN_URL, {
      method: "GET",
      headers,
      credentials: "include",
    });
    if (!res.ok) return;
    const data = await res.json();
    if (!data?.exists) return;
    const createdAt0 = data.created_at ? new Date(data.created_at) : null;
    const ageSec0 = createdAt0 && !Number.isNaN(createdAt0.getTime()) ? Math.floor((Date.now() - createdAt0.getTime())/1000) : null;
    if (window.gtag) window.gtag("event", "restore_success", { result: data.result || null, age_sec: ageSec0, has_token: !!token });
    const createdAt = data.created_at ? new Date(data.created_at) : null;
    if (!createdAt || Number.isNaN(createdAt.getTime())) return;
    const ageMs = Date.now() - createdAt.getTime();
    if (ageMs > 48 * 60 * 60 * 1000) return;
    renderSpinResult(
      {
        result: data.result,
        redeem: data.redeem,
      },
      token
    );
    if (data.result === "LOSE") {
      openPaywallModal("lose");
    } else if (data.result === "WIN" && !token) {
      openPaywallModal("win_locked");
    }
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
});

document.querySelectorAll("[data-close]").forEach((button) => {
  button.addEventListener("click", closeModals);
});

updateAuthUI();
showLoginSuccessOnce();
restoreLastSpin();
