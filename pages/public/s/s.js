const config = window.APP_CONFIG || {};
const API_BASE = (config.API_BASE || "").replace(/\/$/, "");
const slugFromPath = location.pathname.split("/").filter(Boolean).slice(-1)[0];
const slugFromQuery = new URLSearchParams(location.search).get("slug");
const slug = slugFromQuery || (slugFromPath === "index.html" ? "" : slugFromPath);

const titleEl = document.getElementById("title");
const descEl = document.getElementById("description");
const prizesEl = document.getElementById("prizes");
const resultEl = document.getElementById("result");
const disclaimerEl = document.getElementById("disclaimer");
const spinBtn = document.getElementById("spinButton");

function showStockOut(message = "在庫切れです") {
  resultEl.textContent = message;
  spinBtn.disabled = true;
}

function showError(message) {
  titleEl.textContent = message;
  spinBtn.disabled = true;
}

async function loadSeries() {
  if (!slug) {
    showError("slug がありません");
    return;
  }
  const res = await fetch(`${API_BASE}/api/public/series/${encodeURIComponent(slug)}`);
  if (!res.ok) {
    showError("このシリーズは公開されていません");
    return;
  }
  const data = await res.json();
  titleEl.textContent = data.title;
  descEl.textContent = data.description || "";
  disclaimerEl.textContent = data.disclaimer || "";
  prizesEl.innerHTML = "";
  (data.prizes || []).forEach((prize) => {
    const div = document.createElement("div");
    div.className = "prize-item";
    div.innerHTML = `${prize.image_url ? `<img src="${prize.image_url}" alt="${prize.name}" />` : ""}<div>${prize.name}</div>`;
    prizesEl.appendChild(div);
  });
  if (!data.prizes || data.prizes.length === 0) {
    showStockOut("現在、抽選可能な景品がありません");
  }
}

async function spin() {
  if (!slug) return;
  resultEl.textContent = "抽選中...";
  spinBtn.disabled = true;
  const res = await fetch(`${API_BASE}/api/public/series/${encodeURIComponent(slug)}/spin`, { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = data.code || data.error || "";
    if (code === "NO_AVAILABLE_PRIZES" || code === "CONCURRENT_STOCK_EMPTY" || code === "OUT_OF_STOCK") {
      showStockOut("在庫切れです");
      await loadSeries();
      return;
    }
    resultEl.textContent = "エラーが発生しました";
    spinBtn.disabled = false;
    return;
  }
  resultEl.textContent = `当選: ${data.prize?.name || "-"}`;
  await loadSeries();
  spinBtn.disabled = false;
}

spinBtn.addEventListener("click", spin);
loadSeries();
