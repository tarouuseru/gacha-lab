const apiBase = document.getElementById("apiBase");
const adminToken = document.getElementById("adminToken");
const seriesId = document.getElementById("seriesId");
const seriesSelect = document.getElementById("seriesSelect");
const statusEl = document.getElementById("status");
const output = document.getElementById("output");
const loadSeriesBtn = document.getElementById("loadSeriesBtn");
const reportStatus = document.getElementById("reportStatus");
const loadReportsBtn = document.getElementById("loadReportsBtn");
const reportStatusText = document.getElementById("reportStatusText");
const reportList = document.getElementById("reportList");

const key = {
  apiBase: "admin_series_api_base",
  token: "admin_series_token",
};

apiBase.value = localStorage.getItem(key.apiBase) || window.location.origin;
adminToken.value = localStorage.getItem(key.token) || "";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getAdminConfig() {
  const base = apiBase.value.trim().replace(/\/$/, "");
  const token = adminToken.value.trim();
  localStorage.setItem(key.apiBase, base);
  localStorage.setItem(key.token, token);
  return { base, token };
}

function renderSeriesOptions(items) {
  seriesSelect.innerHTML = '<option value="">(select series)</option>';
  (items || []).forEach((item) => {
    const option = document.createElement("option");
    option.value = item.id;
    const suspended = item.suspended_at ? "suspended" : item.status;
    option.textContent = `${item.title || item.slug || item.id} (${suspended})`;
    option.dataset.id = item.id;
    seriesSelect.appendChild(option);
  });
}

async function loadSeries() {
  const { base, token } = getAdminConfig();
  if (!base || !token) {
    statusEl.textContent = "API_BASE / TOKEN が必要です";
    return;
  }
  statusEl.textContent = "loading series...";
  try {
    const res = await fetch(`${base}/api/admin/series`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      statusEl.textContent = `failed: ${res.status}`;
      output.textContent = JSON.stringify(data);
      return;
    }
    renderSeriesOptions(data.items || []);
    statusEl.textContent = `series loaded: ${(data.items || []).length}`;
  } catch (e) {
    statusEl.textContent = "request failed";
    output.textContent = String(e);
  }
}

seriesSelect.addEventListener("change", () => {
  if (seriesSelect.value) {
    seriesId.value = seriesSelect.value;
  }
});

loadSeriesBtn.addEventListener("click", loadSeries);

document.getElementById("suspendBtn").addEventListener("click", async () => {
  const { base, token } = getAdminConfig();
  const id = seriesId.value.trim();

  if (!base || !token || !id) {
    statusEl.textContent = "API_BASE / TOKEN / Series ID が必要です";
    return;
  }

  statusEl.textContent = "suspending...";
  try {
    const res = await fetch(`${base}/api/admin/series/${encodeURIComponent(id)}/suspend`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      statusEl.textContent = `failed: ${res.status}`;
      output.textContent = JSON.stringify(data);
      return;
    }
    statusEl.textContent = "suspended";
    output.textContent = JSON.stringify(data);
  } catch (e) {
    statusEl.textContent = "request failed";
    output.textContent = String(e);
  }
});

document.getElementById("unsuspendBtn").addEventListener("click", async () => {
  const { base, token } = getAdminConfig();
  const id = seriesId.value.trim();

  if (!base || !token || !id) {
    statusEl.textContent = "API_BASE / TOKEN / Series ID が必要です";
    return;
  }

  statusEl.textContent = "unsuspending...";
  try {
    const res = await fetch(`${base}/api/admin/series/${encodeURIComponent(id)}/unsuspend`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      statusEl.textContent = `failed: ${res.status}`;
      output.textContent = JSON.stringify(data);
      return;
    }
    statusEl.textContent = "unsuspended";
    output.textContent = JSON.stringify(data);
  } catch (e) {
    statusEl.textContent = "request failed";
    output.textContent = String(e);
  }
});

async function loadReports() {
  const { base, token } = getAdminConfig();
  const status = reportStatus.value;
  if (!base || !token) {
    reportStatusText.textContent = "API_BASE / TOKEN が必要です";
    return;
  }
  reportStatusText.textContent = "loading reports...";
  reportList.innerHTML = "";
  try {
    const query = status ? `?status=${encodeURIComponent(status)}` : "";
    const res = await fetch(`${base}/api/admin/reports${query}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      reportStatusText.textContent = `failed: ${res.status}`;
      return;
    }
    const items = data.items || [];
    reportStatusText.textContent = `${items.length} reports`;
    if (!items.length) {
      reportList.innerHTML = '<div class="small">reports not found</div>';
      return;
    }
    items.forEach((item) => {
      const el = document.createElement("div");
      el.className = "report-item";
      const createdAt = item.created_at ? new Date(item.created_at).toLocaleString() : "-";
      const resolvedAt = item.resolved_at ? new Date(item.resolved_at).toLocaleString() : "-";
      const isOpen = item.status === "open";
      const publicUrl = item.series_slug ? `${base}/s/${item.series_slug}` : null;
      el.innerHTML = `
        <div><strong>${escapeHtml(item.reason_code || "-")}</strong> (${escapeHtml(item.status || "-")})</div>
        <div>${escapeHtml(item.detail || "(no detail)")}</div>
        <div class="meta">id=${escapeHtml(item.id)} / series=${escapeHtml(item.series_id)}</div>
        ${
          publicUrl
            ? `<div class="meta">public: <a href="${escapeHtml(publicUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(publicUrl)}</a></div>`
            : ""
        }
        <div class="meta">created=${escapeHtml(createdAt)} / resolved=${escapeHtml(resolvedAt)}</div>
        <div class="modal-actions">
          ${
            isOpen
              ? '<button class="btn" type="button" data-action="resolve">Resolve</button>'
              : '<span class="small">already resolved</span>'
          }
        </div>
      `;
      if (isOpen) {
        el.querySelector('[data-action="resolve"]')?.addEventListener("click", async () => {
          reportStatusText.textContent = `resolving ${item.id}...`;
          const resolveRes = await fetch(`${base}/api/admin/reports/${encodeURIComponent(item.id)}/resolve`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ note: "resolved from admin-series UI" }),
          });
          if (!resolveRes.ok) {
            const err = await resolveRes.json().catch(() => ({}));
            reportStatusText.textContent = `resolve failed: ${resolveRes.status} ${err.error || ""}`.trim();
            return;
          }
          reportStatusText.textContent = `resolved: ${item.id}`;
          await loadReports();
        });
      }
      reportList.appendChild(el);
    });
  } catch (e) {
    reportStatusText.textContent = `request failed: ${String(e)}`;
  }
}

loadReportsBtn.addEventListener("click", loadReports);
