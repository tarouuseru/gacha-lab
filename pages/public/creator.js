const config = window.APP_CONFIG || {};
const API_BASE = (config.API_BASE || "").replace(/\/$/, "");
const supabaseClient = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);

const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const authStatus = document.getElementById("authStatus");
const acceptTermsBtn = document.getElementById("acceptTermsBtn");
const termsStatus = document.getElementById("termsStatus");
const billingStatus = document.getElementById("billingStatus");
const startCheckoutBtn = document.getElementById("startCheckoutBtn");
const openPortalBtn = document.getElementById("openPortalBtn");

const seriesTitle = document.getElementById("seriesTitle");
const seriesDescription = document.getElementById("seriesDescription");
const seriesPurchaseUrl = document.getElementById("seriesPurchaseUrl");
const createSeriesBtn = document.getElementById("createSeriesBtn");
const reloadSeriesBtn = document.getElementById("reloadSeriesBtn");
const seriesStatus = document.getElementById("seriesStatus");
const seriesList = document.getElementById("seriesList");

const targetSeries = document.getElementById("targetSeries");
const prizeName = document.getElementById("prizeName");
const prizeImage = document.getElementById("prizeImage");
const prizeStock = document.getElementById("prizeStock");
const prizeWeight = document.getElementById("prizeWeight");
const addPrizeBtn = document.getElementById("addPrizeBtn");
const loadPrizesBtn = document.getElementById("loadPrizesBtn");
const prizeStatus = document.getElementById("prizeStatus");
const prizeList = document.getElementById("prizeList");
const showAddModeBtn = document.getElementById("showAddModeBtn");
const showListModeBtn = document.getElementById("showListModeBtn");
const prizeAddForm = document.getElementById("prizeAddForm");
const prizeListPanel = document.getElementById("prizeListPanel");

let currentSeries = [];

function setText(el, text) {
  if (el) el.textContent = text;
}

function setPrizeMode(mode) {
  const isAdd = mode === "add";
  if (prizeAddForm) prizeAddForm.style.display = isAdd ? "" : "none";
  if (prizeListPanel) prizeListPanel.style.display = isAdd ? "none" : "";
  if (showAddModeBtn) showAddModeBtn.classList.toggle("secondary", !isAdd);
  if (showListModeBtn) showListModeBtn.classList.toggle("secondary", isAdd);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function getAccessToken() {
  const { data } = await supabaseClient.auth.getSession();
  return data?.session?.access_token || null;
}

async function authedFetch(path, options = {}) {
  const token = await getAccessToken();
  if (!token) {
    throw new Error("UNAUTHORIZED");
  }
  return fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
}

async function fetchSubscriptionStatus() {
  const res = await authedFetch("/api/billing/subscription", { method: "GET" });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "SUBSCRIPTION_FETCH_FAILED");
  }
  return data;
}

async function refreshBillingStatus() {
  const { data } = await supabaseClient.auth.getSession();
  if (!data?.session) {
    setText(billingStatus, "未ログイン");
    if (startCheckoutBtn) startCheckoutBtn.disabled = true;
    if (openPortalBtn) openPortalBtn.disabled = true;
    return;
  }

  try {
    const sub = await fetchSubscriptionStatus();
    const active = sub.status === "active";
    setText(
      billingStatus,
      `status: ${sub.status || "inactive"} / plan: ${sub.plan_code || "creator_monthly"}`
    );
    if (startCheckoutBtn) startCheckoutBtn.disabled = active;
    if (openPortalBtn) openPortalBtn.disabled = !sub.stripe_customer_id;
  } catch (error) {
    setText(billingStatus, "契約状態の取得に失敗しました");
    if (startCheckoutBtn) startCheckoutBtn.disabled = true;
    if (openPortalBtn) openPortalBtn.disabled = true;
  }
}

async function startCheckout() {
  setText(billingStatus, "Checkout作成中...");
  try {
    const res = await authedFetch("/api/billing/checkout-session", { method: "POST", body: "{}" });
    const data = await res.json();
    if (!res.ok || !data?.url) {
      setText(billingStatus, `Checkout失敗: ${data?.error || res.status}`);
      return;
    }
    location.href = data.url;
  } catch {
    setText(billingStatus, "Checkout失敗");
  }
}

async function openPortal() {
  setText(billingStatus, "Portal作成中...");
  try {
    const res = await authedFetch("/api/billing/customer-portal", { method: "POST", body: "{}" });
    const data = await res.json();
    if (!res.ok || !data?.url) {
      setText(billingStatus, `Portal失敗: ${data?.error || res.status}`);
      return;
    }
    location.href = data.url;
  } catch {
    setText(billingStatus, "Portal失敗");
  }
}

async function refreshAuthStatus() {
  const { data } = await supabaseClient.auth.getSession();
  if (!data?.session) {
    setText(authStatus, "未ログイン");
    setText(termsStatus, "ログイン後に規約同意状態を確認できます");
    return;
  }
  setText(authStatus, `ログイン中: ${data.session.user.email || data.session.user.id}`);
  try {
    const meRes = await authedFetch("/api/creator/me", { method: "GET" });
    const me = await meRes.json();
    if (meRes.ok) {
      if (me.terms_accepted_at) {
        setText(termsStatus, `同意済み: ${new Date(me.terms_accepted_at).toLocaleString()}`);
      } else {
        setText(termsStatus, "未同意");
      }
    }
  } catch (error) {
    setText(termsStatus, "規約状態の取得に失敗しました");
  }
}

function renderSeries() {
  const previous = targetSeries.value;
  seriesList.innerHTML = "";
  targetSeries.innerHTML = "";
  if (!currentSeries.length) {
    seriesList.innerHTML = '<div class="small">シリーズなし</div>';
    return;
  }

  currentSeries.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = `${item.title} (${item.status})`;
    targetSeries.appendChild(option);

    const card = document.createElement("div");
    card.className = "series-card";
    const publicUrl = `${API_BASE}/s/${item.slug}`;
    card.innerHTML = `
      <strong>${escapeHtml(item.title)}</strong>
      <div class="small">status: ${item.status}</div>
      <div class="small">${escapeHtml(item.description || "")}</div>
      <div class="mono">${publicUrl}</div>
      <div class="inline">
        <input data-field="title" value="${escapeHtml(item.title)}" />
        <input data-field="purchase_url" value="${escapeHtml(item.purchase_url || "")}" />
      </div>
      <textarea data-field="description">${escapeHtml(item.description || "")}</textarea>
      <div class="actions">
        <button class="btn secondary" data-action="save" data-id="${item.id}">save</button>
        <button class="btn secondary" data-action="draft" data-id="${item.id}">draft</button>
        <button class="btn" data-action="publish" data-id="${item.id}">publish</button>
        <button class="btn secondary" data-action="copy" data-url="${publicUrl}">URL copy</button>
      </div>
    `;

    card.querySelector('[data-action="save"]').addEventListener("click", async () => {
      const payload = {
        title: card.querySelector('[data-field="title"]').value.trim(),
        description: card.querySelector('[data-field="description"]').value.trim(),
        purchase_url: card.querySelector('[data-field="purchase_url"]').value.trim(),
      };
      await updateSeries(item.id, payload, "シリーズ保存");
    });
    card.querySelector('[data-action="draft"]').addEventListener("click", () => updateSeriesStatus(item.id, "draft"));
    card.querySelector('[data-action="publish"]').addEventListener("click", () => updateSeriesStatus(item.id, "published"));
    card.querySelector('[data-action="copy"]').addEventListener("click", async (event) => {
      await navigator.clipboard.writeText(event.currentTarget.dataset.url);
      setText(seriesStatus, "公開URLをコピーしました");
    });

    seriesList.appendChild(card);
  });

  if (previous && currentSeries.some((item) => item.id === previous)) {
    targetSeries.value = previous;
  }
}

async function loadSeries() {
  try {
    const res = await authedFetch("/api/creator/series", { method: "GET" });
    const data = await res.json();
    if (!res.ok) {
      setText(seriesStatus, `読み込み失敗: ${data.code || data.error || res.status}`);
      return;
    }
    currentSeries = data.items || [];
    renderSeries();
    setText(seriesStatus, `シリーズ ${currentSeries.length} 件`);
    if (targetSeries.value) {
      await loadPrizes();
    }
  } catch (error) {
    setText(seriesStatus, "シリーズ取得に失敗しました");
  }
}

async function createSeries() {
  setText(seriesStatus, "作成中...");
  try {
    const res = await authedFetch("/api/creator/series", {
      method: "POST",
      body: JSON.stringify({
        title: seriesTitle.value.trim(),
        description: seriesDescription.value.trim(),
        purchase_url: seriesPurchaseUrl.value.trim(),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setText(seriesStatus, `作成失敗: ${data.code || data.error || res.status}`);
      return;
    }
    setText(seriesStatus, `作成完了: ${data.slug}`);
    await loadSeries();
  } catch {
    setText(seriesStatus, "作成失敗");
  }
}

async function updateSeriesStatus(seriesId, status) {
  return updateSeries(seriesId, { status }, `${status} に更新中...`);
}

async function updateSeries(seriesId, payload, pendingMessage = "更新中...") {
  setText(seriesStatus, pendingMessage);
  try {
    const res = await authedFetch(`/api/creator/series/${seriesId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      setText(seriesStatus, `更新失敗: ${data.code || data.error || res.status}`);
      return;
    }
    setText(seriesStatus, `更新完了: ${data.status}`);
    await loadSeries();
  } catch {
    setText(seriesStatus, "更新失敗");
  }
}

async function addPrize() {
  const seriesId = targetSeries.value;
  if (!seriesId) {
    setText(prizeStatus, "シリーズを選択してください");
    return;
  }
  setText(prizeStatus, "景品追加中...");
  try {
    const res = await authedFetch(`/api/creator/series/${seriesId}/prizes`, {
      method: "POST",
      body: JSON.stringify({
        name: prizeName.value.trim(),
        image_url: prizeImage.value.trim(),
        stock: Number(prizeStock.value || 0),
        weight: Number(prizeWeight.value || 1),
        is_active: true,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setText(prizeStatus, `追加失敗: ${data.code || data.error || res.status}`);
      return;
    }
    setText(prizeStatus, `追加完了: ${data.name}`);
    setPrizeMode("list");
    await loadPrizes();
  } catch {
    setText(prizeStatus, "追加失敗");
  }
}

function renderPrizes(items) {
  prizeList.innerHTML = "";
  if (!items.length) {
    prizeList.innerHTML = '<div class="small">景品なし</div>';
    return;
  }
  items.forEach((item) => {
    const card = document.createElement("div");
    card.className = "prize-card";
    card.innerHTML = `
      <div><strong>${escapeHtml(item.name)}</strong></div>
      <div class="inline">
        <input data-field="name" value="${escapeHtml(item.name)}" />
        <input data-field="image_url" value="${escapeHtml(item.image_url || "")}" />
        <input data-field="stock" type="number" min="0" value="${Number(item.stock || 0)}" />
        <input data-field="weight" type="number" min="1" value="${Number(item.weight || 1)}" />
      </div>
      <div class="small">active=${item.is_active}</div>
      <div class="actions">
        <button class="btn secondary" data-action="save">save</button>
        <button class="btn secondary" data-action="deactivate">無効化</button>
        <button class="btn secondary" data-action="activate">有効化</button>
      </div>
    `;
    card.querySelector('[data-action="save"]').addEventListener("click", () => {
      const payload = {
        name: card.querySelector('[data-field="name"]').value.trim(),
        image_url: card.querySelector('[data-field="image_url"]').value.trim(),
        stock: Number(card.querySelector('[data-field="stock"]').value || 0),
        weight: Number(card.querySelector('[data-field="weight"]').value || 1),
      };
      patchPrize(item.id, payload);
    });
    card.querySelector('[data-action="deactivate"]').addEventListener("click", () => patchPrize(item.id, { is_active: false }));
    card.querySelector('[data-action="activate"]').addEventListener("click", () => patchPrize(item.id, { is_active: true }));
    prizeList.appendChild(card);
  });
}

async function loadPrizes({ silent = false } = {}) {
  const seriesId = targetSeries.value;
  if (!seriesId) {
    setText(prizeStatus, "シリーズを選択してください");
    return;
  }
  setPrizeMode("list");
  if (!silent) setText(prizeStatus, "読み込み中...");
  try {
    const res = await authedFetch(`/api/creator/series/${seriesId}/prizes`, { method: "GET" });
    const data = await res.json();
    if (!res.ok) {
      setText(prizeStatus, `読み込み失敗: ${data.error || res.status}`);
      return;
    }
    renderPrizes(data.items || []);
    setText(prizeStatus, `${(data.items || []).length} 件`);
  } catch {
    setText(prizeStatus, "読み込み失敗");
  }
}

async function patchPrize(prizeId, payload) {
  try {
    const res = await authedFetch(`/api/creator/prizes/${prizeId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      setText(prizeStatus, `更新失敗: ${data.code || data.error || res.status}`);
      return;
    }
    setText(prizeStatus, `更新完了: ${data.name || prizeId}`);
    await loadPrizes();
  } catch {
    setText(prizeStatus, "更新失敗");
  }
}

loginBtn.addEventListener("click", async () => {
  const redirectTo = `${location.origin}/creator-callback.html`;
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo },
  });
  if (error) setText(authStatus, `ログイン失敗: ${error.message}`);
});

logoutBtn.addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
  await refreshAuthStatus();
  await refreshBillingStatus();
});

acceptTermsBtn.addEventListener("click", async () => {
  try {
    const res = await authedFetch("/api/creator/terms/accept", { method: "POST", body: "{}" });
    const data = await res.json();
    if (!res.ok) {
      setText(termsStatus, `同意失敗: ${data.error || res.status}`);
      return;
    }
    setText(termsStatus, `同意済み: ${new Date(data.terms_accepted_at).toLocaleString()}`);
  } catch {
    setText(termsStatus, "同意失敗");
  }
});

createSeriesBtn.addEventListener("click", createSeries);
reloadSeriesBtn.addEventListener("click", loadSeries);
addPrizeBtn.addEventListener("click", addPrize);
loadPrizesBtn.addEventListener("click", loadPrizes);
targetSeries.addEventListener("change", loadPrizes);
showAddModeBtn.addEventListener("click", () => setPrizeMode("add"));
showListModeBtn.addEventListener("click", () => loadPrizes());
if (startCheckoutBtn) startCheckoutBtn.addEventListener("click", startCheckout);
if (openPortalBtn) openPortalBtn.addEventListener("click", openPortal);

document.addEventListener("DOMContentLoaded", async () => {
  setPrizeMode("add");
  await refreshAuthStatus();
  await refreshBillingStatus();
  await loadSeries();
});
