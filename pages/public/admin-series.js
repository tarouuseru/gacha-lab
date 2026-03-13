const apiBase = document.getElementById("apiBase");
const adminToken = document.getElementById("adminToken");
const seriesId = document.getElementById("seriesId");
const seriesSelect = document.getElementById("seriesSelect");
const seriesSearch = document.getElementById("seriesSearch");
const seriesStatusFilter = document.getElementById("seriesStatusFilter");
const statusEl = document.getElementById("status");
const output = document.getElementById("output");
const loadSeriesBtn = document.getElementById("loadSeriesBtn");
const reportStatus = document.getElementById("reportStatus");
const reportSearch = document.getElementById("reportSearch");
const reportReasonFilter = document.getElementById("reportReasonFilter");
const reportSeriesStatusFilter = document.getElementById("reportSeriesStatusFilter");
const reportSort = document.getElementById("reportSort");
const resolveNote = document.getElementById("resolveNote");
const loadReportsBtn = document.getElementById("loadReportsBtn");
const reportStatusText = document.getElementById("reportStatusText");
const reportList = document.getElementById("reportList");
const summaryTotalReports = document.getElementById("summaryTotalReports");
const summaryOpenReports = document.getElementById("summaryOpenReports");
const summarySuspendedSeries = document.getElementById("summarySuspendedSeries");
const summaryOpenRate = document.getElementById("summaryOpenRate");
const summaryLatestReport = document.getElementById("summaryLatestReport");
const summaryStatus = document.getElementById("summaryStatus");

const key = {
  apiBase: "admin_series_api_base",
  token: "admin_series_token",
  seriesSearch: "admin_series_search",
  seriesStatus: "admin_series_status_filter",
  resolveNote: "admin_series_resolve_note",
  reportSearch: "admin_report_search",
  reportReason: "admin_report_reason_filter",
  reportSeriesStatus: "admin_report_series_status_filter",
  reportSort: "admin_report_sort",
};

apiBase.value = localStorage.getItem(key.apiBase) || window.location.origin;
adminToken.value = localStorage.getItem(key.token) || "";
seriesSearch.value = localStorage.getItem(key.seriesSearch) || "";
seriesStatusFilter.value = localStorage.getItem(key.seriesStatus) || "";
resolveNote.value = localStorage.getItem(key.resolveNote) || "resolved from admin-series UI";
reportSearch.value = localStorage.getItem(key.reportSearch) || "";
reportReasonFilter.value = localStorage.getItem(key.reportReason) || "";
reportSeriesStatusFilter.value = localStorage.getItem(key.reportSeriesStatus) || "";
reportSort.value = localStorage.getItem(key.reportSort) || "created_desc";

let cachedSeries = [];
let cachedReports = [];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setSummaryValues({
  totalReports = "-",
  openReports = "-",
  suspendedSeries = "-",
  openRate = "-",
  latestReport = "-",
} = {}) {
  summaryTotalReports.textContent = String(totalReports);
  summaryOpenReports.textContent = String(openReports);
  summarySuspendedSeries.textContent = String(suspendedSeries);
  summaryOpenRate.textContent = String(openRate);
  summaryLatestReport.textContent = String(latestReport);
}

async function loadDashboardSummary() {
  const { base, token } = getAdminConfig();
  if (!base || !token) return;
  summaryStatus.textContent = "loading dashboard summary...";
  try {
    const [seriesRes, reportRes] = await Promise.all([
      fetch(`${base}/api/admin/series`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      }),
      fetch(`${base}/api/admin/reports`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      }),
    ]);
    if (!seriesRes.ok || !reportRes.ok) {
      summaryStatus.textContent = "dashboard summary failed";
      return;
    }
    const seriesData = await seriesRes.json().catch(() => ({}));
    const reportData = await reportRes.json().catch(() => ({}));
    const seriesItems = seriesData.items || [];
    const reportItems = reportData.items || [];

    const suspendedSeriesCount = seriesItems.filter(
      (item) => Boolean(item.suspended_at) || item.status === "suspended"
    ).length;
    const openReportCount = reportItems.filter((item) => item.status === "open").length;
    const openRate =
      reportItems.length > 0 ? `${Math.round((openReportCount / reportItems.length) * 100)}%` : "0%";
    const latestReportRow = [...reportItems]
      .filter((item) => item.created_at)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
    const latestReport = latestReportRow?.created_at
      ? new Date(latestReportRow.created_at).toLocaleString()
      : "-";

    setSummaryValues({
      totalReports: reportItems.length,
      openReports: openReportCount,
      suspendedSeries: suspendedSeriesCount,
      openRate,
      latestReport,
    });
    summaryStatus.textContent = "dashboard summary loaded";
  } catch (e) {
    summaryStatus.textContent = `dashboard summary failed: ${String(e)}`;
  }
}

function getAdminConfig() {
  const base = apiBase.value.trim().replace(/\/$/, "");
  const token = adminToken.value.trim();
  localStorage.setItem(key.apiBase, base);
  localStorage.setItem(key.token, token);
  return { base, token };
}

function populateReportReasonOptions(items) {
  const selected = reportReasonFilter.value || "";
  const reasons = [...new Set((items || []).map((item) => item.reason_code).filter(Boolean))].sort();
  reportReasonFilter.innerHTML = '<option value="">all</option>';
  reasons.forEach((reason) => {
    const option = document.createElement("option");
    option.value = reason;
    option.textContent = reason;
    reportReasonFilter.appendChild(option);
  });
  if (selected && reasons.includes(selected)) {
    reportReasonFilter.value = selected;
  } else {
    reportReasonFilter.value = "";
  }
}

function applyReportFilters(items) {
  const keyword = (reportSearch.value || "").trim().toLowerCase();
  const reason = (reportReasonFilter.value || "").trim().toLowerCase();
  const seriesStatus = (reportSeriesStatusFilter.value || "").trim().toLowerCase();
  return (items || []).filter((item) => {
    if (reason && String(item.reason_code || "").toLowerCase() !== reason) return false;
    if (seriesStatus && String(item.series_status || "").toLowerCase() !== seriesStatus) return false;
    if (!keyword) return true;
    const haystack = [
      item.id,
      item.series_id,
      item.series_slug,
      item.reason_code,
      item.detail,
      item.status,
      item.series_status,
    ]
      .map((value) => String(value || "").toLowerCase())
      .join(" ");
    return haystack.includes(keyword);
  });
}

function getSortableTime(item, mode) {
  if (mode.startsWith("resolved")) {
    return item.resolved_at ? new Date(item.resolved_at).getTime() : 0;
  }
  return item.created_at ? new Date(item.created_at).getTime() : 0;
}

function applyReportSort(items) {
  const mode = reportSort.value || "created_desc";
  const sorted = [...(items || [])];
  sorted.sort((a, b) => {
    const left = getSortableTime(a, mode);
    const right = getSortableTime(b, mode);
    return mode.endsWith("_asc") ? left - right : right - left;
  });
  return sorted;
}

function renderReports(items, { base, token } = {}) {
  reportList.innerHTML = "";
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
    const seriesStatus = item.series_status || "-";
    el.innerHTML = `
      <div><strong>${escapeHtml(item.reason_code || "-")}</strong> (${escapeHtml(item.status || "-")})</div>
      <div>${escapeHtml(item.detail || "(no detail)")}</div>
      <div class="meta">id=${escapeHtml(item.id)} / series=${escapeHtml(item.series_id)}</div>
      <div class="meta">series status: ${escapeHtml(seriesStatus)}</div>
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
          body: JSON.stringify({ note: String(resolveNote.value || "").trim() || null }),
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
}

function renderSeriesOptions(items) {
  const keyword = (seriesSearch.value || "").trim().toLowerCase();
  const statusKeyword = (seriesStatusFilter.value || "").trim().toLowerCase();
  const filtered = (items || []).filter((item) => {
    const effectiveStatus = (item.suspended_at ? "suspended" : item.status || "").toLowerCase();
    const statusMatch = !statusKeyword || effectiveStatus === statusKeyword;
    if (!statusMatch) return false;
    if (!keyword) return true;
    const title = String(item.title || "").toLowerCase();
    const slug = String(item.slug || "").toLowerCase();
    return title.includes(keyword) || slug.includes(keyword);
  });

  seriesSelect.innerHTML = '<option value="">(select series)</option>';
  filtered.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.id;
    const suspended = item.suspended_at ? "suspended" : item.status;
    option.textContent = `${item.title || item.slug || item.id} (${suspended})`;
    option.dataset.id = item.id;
    seriesSelect.appendChild(option);
  });
  statusEl.textContent = `series loaded: ${filtered.length}/${(items || []).length}`;
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
    cachedSeries = data.items || [];
    renderSeriesOptions(cachedSeries);
    await loadDashboardSummary();
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

seriesSearch.addEventListener("input", () => {
  localStorage.setItem(key.seriesSearch, seriesSearch.value || "");
  renderSeriesOptions(cachedSeries);
});

seriesStatusFilter.addEventListener("change", () => {
  localStorage.setItem(key.seriesStatus, seriesStatusFilter.value || "");
  renderSeriesOptions(cachedSeries);
});

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
    cachedReports = data.items || [];
    populateReportReasonOptions(cachedReports);
    const filteredItems = applyReportSort(applyReportFilters(cachedReports));
    renderReports(filteredItems, { base, token });
    await loadDashboardSummary();
  } catch (e) {
    reportStatusText.textContent = `request failed: ${String(e)}`;
  }
}

loadReportsBtn.addEventListener("click", loadReports);

resolveNote.addEventListener("input", () => {
  localStorage.setItem(key.resolveNote, resolveNote.value || "");
});

reportSearch.addEventListener("input", () => {
  localStorage.setItem(key.reportSearch, reportSearch.value || "");
  const { base, token } = getAdminConfig();
  renderReports(applyReportSort(applyReportFilters(cachedReports)), { base, token });
});

reportReasonFilter.addEventListener("change", () => {
  localStorage.setItem(key.reportReason, reportReasonFilter.value || "");
  const { base, token } = getAdminConfig();
  renderReports(applyReportSort(applyReportFilters(cachedReports)), { base, token });
});

reportSeriesStatusFilter.addEventListener("change", () => {
  localStorage.setItem(key.reportSeriesStatus, reportSeriesStatusFilter.value || "");
  const { base, token } = getAdminConfig();
  renderReports(applyReportSort(applyReportFilters(cachedReports)), { base, token });
});

reportSort.addEventListener("change", () => {
  localStorage.setItem(key.reportSort, reportSort.value || "created_desc");
  const { base, token } = getAdminConfig();
  renderReports(applyReportSort(applyReportFilters(cachedReports)), { base, token });
});

loadDashboardSummary();
