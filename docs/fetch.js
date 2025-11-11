const DEFAULT_FEEDS = [
  "https://api.cryptojobslist.com/rss/Developer.xml",
  "https://api.cryptojobslist.com/rss/Solidity.xml",
  "https://api.cryptojobslist.com/rss/Rust.xml",
  "https://api.cryptojobslist.com/rss/Full%20Stack.xml",
];

const DEFAULT_KEYWORDS = [
  "remote",
  "solidity",
  "full stack",
  "full-stack",
  "contractor",
  "senior",
];

const STORAGE_KEYS = {
  settings: "jobjo-settings-v1",
  cache: "jobjo-cache-v1",
  statuses: "jobjo-statuses-v1",
};

const DEFAULT_SETTINGS = {
  feeds: [...DEFAULT_FEEDS],
  keywords: [...DEFAULT_KEYWORDS],
  useProxy: true,
  proxyPrefix: "https://cloudflare-cors-anywhere.corstsx.workers.dev",
  allowLocalCache: true,
};

const FILTER_SEQUENCE = ["new", "applied", "irrelevant", "all"];
const FILTER_DISPLAY_LABELS = {
  new: "New only",
  applied: "Applied only",
  irrelevant: "Irrelevant only",
  all: "All jobs",
};

const CONCURRENCY = 4;
const TIMEOUT_MS = 15000;
const RETRIES = 2;

const state = {
  jobs: [],
  filteredJobs: [],
  error: null,
  isLoading: false,
  lastUpdated: null,
  lastSource: "cache",
  search: "",
  settings: { ...DEFAULT_SETTINGS },
  statuses: {},
  activeJobKey: null,
  statusFilter: "new",
};

const dom = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  cacheDom();
  wireEvents();
  setStatus("Loading saved jobs…", "loading");
  try {
    const [settings, statuses] = await Promise.all([
      loadSettings(),
      loadStatuses(),
    ]);
    state.settings = settings;
    state.statuses = statuses;
  } catch (err) {
    console.error("Failed to load preferences", err);
  } finally {
    hydrateSettingsForm(state.settings);
    await restoreFromCache();
  }
}

function cacheDom() {
  dom.jobs = document.querySelector("#jobs");
  dom.status = document.querySelector("#statusMessage");
  dom.visibleTotal = document.querySelector("#visibleTotal");
  dom.refreshBtn = document.querySelector("#refreshBtn");
  dom.settingsBtn = document.querySelector("#openSettings");
  dom.settingsModal = document.querySelector("#settingsModal");
  dom.settingsForm = document.querySelector("#settingsForm");
  dom.closeSettings = document.querySelector("#closeSettings");
  dom.resetDefaults = document.querySelector("#resetDefaults");
  dom.lastUpdated = document.querySelector("#lastUpdated");
  dom.lastSource = document.querySelector("#lastSource");
  dom.searchInput = document.querySelector("#searchInput");
  dom.jobModal = document.querySelector("#jobModal");
  dom.jobModalContent = document.querySelector("#jobModalContent");
  dom.closeJobModal = document.querySelector("#closeJobModal");
  dom.filterWrapper = document.querySelector(".filter-wrapper");
  dom.filterBtn = document.querySelector("#filterBtn");
  dom.filterMenu = document.querySelector("#filterMenu");
  dom.filterLabel = document.querySelector("#filterBtnLabel");
}

function wireEvents() {
  dom.refreshBtn?.addEventListener("click", () => refreshFeeds(true));
  dom.settingsBtn?.addEventListener("click", () => toggleSettings(true));
  dom.closeSettings?.addEventListener("click", () => toggleSettings(false));
  dom.settingsModal?.addEventListener("click", (evt) => {
    if (evt.target === dom.settingsModal) toggleSettings(false);
  });
  dom.resetDefaults?.addEventListener("click", () => {
    state.settings = { ...DEFAULT_SETTINGS };
    hydrateSettingsForm(state.settings);
  });
  dom.settingsForm?.addEventListener("submit", async (evt) => {
    evt.preventDefault();
    const formData = new FormData(dom.settingsForm);
    const feedsInput = (formData.get("feeds") || "").toString();
    const keywordsInput = (formData.get("keywords") || "").toString();
    const proxyPrefix = (formData.get("proxyPrefix") || "").toString().trim();
    const useProxy = formData.get("useProxy") === "on";
    const allowLocalCache = formData.get("allowLocalCache") === "on";
    const feeds = feedsInput
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const keywords = keywordsInput
      .split(",")
      .map((word) => word.trim())
      .filter(Boolean);
    state.settings = {
      feeds: feeds.length ? feeds : [...DEFAULT_FEEDS],
      keywords,
      useProxy,
      proxyPrefix: proxyPrefix || DEFAULT_SETTINGS.proxyPrefix,
      allowLocalCache,
    };
    await saveSettings(state.settings);
    toggleSettings(false);
    refreshFeeds(true);
  });
  dom.searchInput?.addEventListener("input", (evt) => {
    state.search = evt.target.value || "";
    applyFilters();
  });
  dom.filterBtn?.addEventListener("click", toggleFilterMenu);
  dom.filterMenu?.addEventListener("click", (evt) => {
    const option = evt.target.closest("button[data-filter]");
    if (!option) return;
    setStatusFilter(option.dataset.filter);
  });
  document.addEventListener("click", (evt) => {
    if (!dom.filterWrapper) return;
    if (dom.filterWrapper.contains(evt.target)) return;
    if (dom.filterMenu?.dataset.state === "open") {
      closeFilterMenu();
    }
  });
  dom.jobs?.addEventListener("click", handleJobClick);
  dom.jobs?.addEventListener("contextmenu", handleStatusContextMenu);
  dom.closeJobModal?.addEventListener("click", closeJobDetails);
  dom.jobModal?.addEventListener("click", (evt) => {
    if (evt.target === dom.jobModal) {
      closeJobDetails();
    }
  });
  dom.jobModalContent?.addEventListener("click", (evt) => {
    const tabBtn = evt.target.closest(".job-tab-btn");
    if (!tabBtn) return;
    const tabsRoot = tabBtn.closest(".job-modal-tabs");
    if (!tabsRoot) return;
    const panels = tabsRoot.querySelectorAll(".job-tab-panel");
    const buttons = tabsRoot.querySelectorAll(".job-tab-btn");
    buttons.forEach((btn) => {
      const isActive = btn === tabBtn;
      btn.classList.toggle("is-active", isActive);
      btn.setAttribute("aria-selected", isActive.toString());
    });
    panels.forEach((panel) => {
      panel.classList.toggle("is-active", panel.id === tabBtn.dataset.tab);
    });
  });
  document.addEventListener("keydown", (evt) => {
    if (evt.key === "Escape") {
      closeJobDetails();
      toggleSettings(false);
      closeFilterMenu();
    }
  });
}

function hydrateSettingsForm(settings) {
  if (!dom.settingsForm) return;
  dom.settingsForm.elements.feeds.value = (settings.feeds || []).join("\n");
  dom.settingsForm.elements.keywords.value = (settings.keywords || []).join(
    ", "
  );
  if (dom.settingsForm.elements.proxyPrefix) {
    dom.settingsForm.elements.proxyPrefix.value = settings.proxyPrefix || "";
  }
  if (dom.settingsForm.elements.useProxy) {
    dom.settingsForm.elements.useProxy.checked = Boolean(settings.useProxy);
  }
  if (dom.settingsForm.elements.allowLocalCache) {
    dom.settingsForm.elements.allowLocalCache.checked = Boolean(
      settings.allowLocalCache
    );
  }
}

function toggleSettings(open) {
  if (!dom.settingsModal) return;
  dom.settingsModal.dataset.state = open ? "open" : "hidden";
}

async function restoreFromCache() {
  const cache = await loadCache();
  if (!cache) {
    state.jobs = [];
    state.filteredJobs = [];
    renderJobs([]);
    updateStatusCounts();
    updateFilterButton();
    setStatus("No cached jobs yet. Hit refresh to fetch the latest.");
    return;
  }
  state.jobs = cache.items || [];
  state.lastUpdated = cache.savedAt || null;
  state.lastSource = cache.source || "cache";
  applyFilters();
  updateLastUpdated();
  updateFilterButton();
  updateStatusCounts();
  setStatus(`${state.jobs.length}.`);
}

async function refreshFeeds(manual = false) {
  if (state.isLoading) return;
  if (!state.settings.feeds?.length) {
    setStatus("Add at least one RSS feed in Settings.", "error");
    return;
  }
  state.isLoading = true;
  dom.refreshBtn?.classList.add("is-busy");
  setStatus(manual ? "Refreshing feeds…" : "Checking feeds…", "loading");
  try {
    const result = await collectJobs({
      feeds: state.settings.feeds,
      keywords: state.settings.keywords,
      useProxy: state.settings.useProxy,
      proxyPrefix: state.settings.proxyPrefix,
      allowLocalCache: state.settings.allowLocalCache,
    });
    state.jobs = result.items;
    state.lastUpdated = result.savedAt;
    state.lastSource = result.source || "network";
    await saveCache(result);
    applyFilters();
    updateLastUpdated();
    updateFilterButton();
    updateStatusCounts();
    if (result.warnings?.length) {
      setStatus(
        `Fetched ${state.jobs.length} jobs with ${result.warnings.length} warning(s).`,
        "warn"
      );
      console.warn("Feed warnings:", result.warnings);
    } else {
      setStatus(`Fetched ${state.jobs.length} jobs just now.`);
    }
  } catch (err) {
    console.error(err);
    state.error = err;
    setStatus(err.message || "Failed to fetch feeds.", "error");
    if (manual) {
      alert(
        `Unable to refresh feeds.\nReason: ${
          err.message || "Unknown error"
        }\nShowing cached jobs from ${
          state.lastUpdated ? formatDate(state.lastUpdated) : "cache"
        }.`
      );
    }
  } finally {
    state.isLoading = false;
    dom.refreshBtn?.classList.remove("is-busy");
  }
}

function renderJobs(jobs = state.filteredJobs || state.jobs) {
  if (!dom.jobs) return;
  if (!jobs.length) {
    dom.jobs.innerHTML = ``;
    updateVisibleTotal(0);
    return;
  }
  dom.jobs.innerHTML = jobs.map((job) => jobCard(job)).join("");
  updateVisibleTotal(jobs.length);
}

function jobCard(job) {
  const key = jobKey(job);
  const encodedKey = encodeURIComponent(key);
  const status = getJobStatus(key);
  const tags = deriveTags(job);

  // Always render the status pill, its content and class will be determined by 'status'
  const statusPill = `
    <button
      type="button"
      class="status-pill status-pill--${status}"
      data-role="status-pill"
      data-key="${encodedKey}"
      title="Left click toggles New/Applied. Right click marks Irrelevant."
    >
      ${statusLabel(status)}
    </button>
  `;

  return `
    <article
      class="job-card"
      data-job-key="${encodedKey}"
      style="width:100%;box-sizing:border-box;"
    >
      <div
        class="job-card__row"
        style="display:flex;align-items:center;gap:.5rem;white-space:nowrap;overflow:hidden;justify-content:space-between;"
      >
        <div style="display:flex;align-items:center;gap:.5rem;min-width:0;flex:1 1 auto;">
          ${statusPill.replace(
            'class="status-pill',
            'class="status-pill" style="flex:0 0 auto;white-space:nowrap;"'
          )}
          <span
            data-action="details"
            data-key="${encodedKey}"
            style="display:inline-block;min-width:0;flex:1 1 auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;font-size:clamp(12px,1.6vw,16px);line-height:1;"
            title="${escapeHtml(job.title)}"
          >
            ${escapeHtml(job.title)}
          </span>
        </div>

        <span class="link-icon" style="flex:0 0 auto;white-space:nowrap;">
          <a class="glow-link" href="${
            job.url
          }" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding-left:.25rem;">⬈</a>
        </span>
      </div>

      <div class="job-card__tags" style="margin-top:.5rem;display:flex;gap:.375rem;flex-wrap:nowrap;overflow:hidden;">
        ${
          tags.length
            ? tags
                .map(
                  (tag) =>
                    `<span class="tag" style="flex:0 0 auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(
                      tag
                    )}</span>`
                )
                .join("")
            : `<span class="tag tag--muted" style="flex:0 0 auto;">general</span>`
        }
      </div>
    </article>
  `;
}
function setStatus(message, variant = "idle") {
  if (!dom.status) return;
  dom.status.dataset.state = variant;
  dom.status.textContent = message;
}

function updateLastUpdated() {
  if (!dom.lastUpdated) return;
  if (!state.lastUpdated) {
    dom.lastUpdated.textContent = "Never";
  } else {
    const relative = formatRelativeTime(state.lastUpdated);
    dom.lastUpdated.textContent = `${relative} (${formatDate(
      state.lastUpdated
    )})`;
  }
  const sourceLabel = formatSourceLabel(state.lastSource);
  if (dom.lastSource) {
    dom.lastSource.textContent = state.lastUpdated ? sourceLabel : "—";
  }
  console.log(`Source: ${sourceLabel}`);
  if (dom.refreshBtn) {
    const lastSyncLabel = state.lastUpdated
      ? formatDate(state.lastUpdated)
      : "Never";
    dom.refreshBtn.title = `Last sync: ${lastSyncLabel}`;
  }
}

function formatSourceLabel(source) {
  if (!source) return "—";
  switch (source) {
    case "proxy":
      return "via proxy";
    case "network":
      return "via feed";
    case "local-cache":
      return "via local cache";
    default:
      return source;
  }
}

function formatDate(date) {
  if (!date) return "Unknown";
  try {
    const dt = new Date(date);
    return dt.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "Unknown";
  }
}

function formatRelativeTime(date) {
  try {
    const dt = new Date(date);
    const diff = dt.getTime() - Date.now();
    const minutes = Math.round(diff / (1000 * 60));
    const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
    if (Math.abs(minutes) < 60) return rtf.format(minutes, "minute");
    const hours = Math.round(minutes / 60);
    if (Math.abs(hours) < 24) return rtf.format(hours, "hour");
    const days = Math.round(hours / 24);
    return rtf.format(days, "day");
  } catch {
    return "";
  }
}

function escapeHtml(value) {
  if (!value) return "";
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function loadSettings() {
  try {
    const raw = await readStorage(STORAGE_KEYS.settings);
    if (!raw) {
      return { ...DEFAULT_SETTINGS };
    }
    const parsed = JSON.parse(raw);
    return {
      feeds: parsed.feeds?.length ? parsed.feeds : [...DEFAULT_FEEDS],
      keywords: parsed.keywords || [],
      useProxy:
        typeof parsed.useProxy === "boolean"
          ? parsed.useProxy
          : DEFAULT_SETTINGS.useProxy,
      proxyPrefix: parsed.proxyPrefix || DEFAULT_SETTINGS.proxyPrefix,
      allowLocalCache:
        typeof parsed.allowLocalCache === "boolean"
          ? parsed.allowLocalCache
          : DEFAULT_SETTINGS.allowLocalCache,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings) {
  return writeStorage(STORAGE_KEYS.settings, JSON.stringify(settings));
}

async function loadCache() {
  try {
    const raw = await readStorage(STORAGE_KEYS.cache);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveCache(payload) {
  return writeStorage(
    STORAGE_KEYS.cache,
    JSON.stringify({ ...payload, savedAt: payload.savedAt })
  );
}

async function collectJobs({
  feeds,
  keywords,
  useProxy,
  proxyPrefix,
  allowLocalCache,
}) {
  const warnings = [];
  const feedsResult = await mapWithConcurrency(
    feeds,
    CONCURRENCY,
    async (url) => {
      try {
        const { xml, source } = await fetchFeedXml(url, {
          useProxy,
          proxyPrefix,
          allowLocalCache,
        });
        return { url, items: normalizeFeed(xml), source };
      } catch (err) {
        warnings.push({ url, message: err.message || "Unable to fetch." });
        return { url, items: [], source: "error" };
      }
    }
  );
  const flatten = feedsResult.flatMap((entry) => entry.items);
  if (!flatten.length && warnings.length === feeds.length) {
    const error = new Error(
      "All feeds failed to load. Check URLs or CORS access."
    );
    error.details = warnings;
    throw error;
  }
  const filtered = keywords?.length
    ? flatten.filter((item) => matchKeywords(item, keywords))
    : flatten;
  const unique = dedupe(filtered).sort(
    (a, b) => new Date(b.published) - new Date(a.published)
  );
  const enriched = unique.map((item) => ({
    title: item.title,
    url: item.link,
    published: item.published,
    summary: item.summary,
    ...parseJobHtml(item.summary),
  }));
  const savedAt = new Date().toISOString();
  const source = deriveAggregateSource(feedsResult);
  return {
    savedAt,
    count: enriched.length,
    items: enriched,
    feeds: feedsResult.map((entry) => ({
      url: entry.url,
      fetchedAt: savedAt,
      source: entry.source,
      count: entry.items.length,
    })),
    warnings,
    source,
  };
}

function buildFeedUrl(url, { useProxy, proxyPrefix }) {
  if (!useProxy) return url;
  const prefix = (proxyPrefix || "").trim();
  if (!prefix) return url;
  if (prefix.endsWith("/")) return `${prefix}?${url}`;
  return `${prefix}/?${url}`;
}

async function fetchFeedXml(url, options) {
  try {
    const target = buildFeedUrl(url, options);
    const xml = await fetchWithRetry(target);
    return { xml, source: options.useProxy ? "proxy" : "network" };
  } catch (err) {
    if (options.allowLocalCache) {
      const fallback = await fetchLocalCache(url);
      if (fallback) {
        return { xml: fallback, source: "local-cache" };
      }
    }
    throw err;
  }
}

async function fetchLocalCache(url) {
  try {
    const hash = await sha1Hex(url);
    if (!hash) return null;
    const localUrl = `cache/${hash}.xml`;
    debugger;
    const res = await fetch(localUrl);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function sha1Hex(input) {
  if (!crypto?.subtle) {
    return null;
  }
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-1", data);
  const bytes = Array.from(new Uint8Array(hashBuffer));
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function deriveAggregateSource(feeds) {
  if (!feeds?.length) return "cache";
  if (feeds.every((f) => f.source === "local-cache")) return "local-cache";
  if (feeds.some((f) => f.source === "proxy")) return "proxy";
  return "network";
}

function handleJobClick(evt) {
  const pill = evt.target.closest(".status-pill");
  if (pill) {
    evt.preventDefault();
    const key = decodeURIComponent(pill.dataset.key || "");
    if (!key) return;
    cycleStatusByClick(key);
    return;
  }
  const actionEl = evt.target.closest("[data-action]");
  if (!actionEl) return;
  const key = decodeURIComponent(actionEl.dataset.key || "");
  if (!key) return;
  const job = findJobByKey(key);
  if (!job) return;
  if (actionEl.dataset.action === "details") {
    openJobDetails(job);
  }
}

function handleStatusContextMenu(evt) {
  const pill = evt.target.closest(".status-pill");
  if (!pill) return;
  evt.preventDefault();
  const key = decodeURIComponent(pill.dataset.key || "");
  if (!key) return;
  setJobStatus(key, "irrelevant");
}

function jobKey(job) {
  return (job.url || job.guid || job.title || "").trim();
}

function getJobStatus(key) {
  return state.statuses?.[key] || "new";
}

function setJobStatus(key, status) {
  state.statuses = { ...state.statuses, [key]: status };
  saveStatuses(state.statuses);
  applyFilters();
}

function cycleStatusByClick(key) {
  const current = getJobStatus(key);
  if (current === "new") {
    setJobStatus(key, "applied");
  } else if (current === "applied") {
    setJobStatus(key, "new");
  } else if (current === "irrelevant") {
    setJobStatus(key, "new");
  } else {
    setJobStatus(key, "new");
  }
}

function openJobDetails(job) {
  if (!dom.jobModal || !dom.jobModalContent) return;
  state.activeJobKey = jobKey(job);
  dom.jobModalContent.innerHTML = jobDetailsMarkup(job);
  dom.jobModal.dataset.state = "open";
}

function closeJobDetails() {
  if (!dom.jobModal) return;
  dom.jobModal.dataset.state = "hidden";
  state.activeJobKey = null;
}

function jobDetailsMarkup(job) {
  const responsibilities = job.responsibilities
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");
  const requirements = job.requirements
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");
  const summary = job.summary ? htmlToText(job.summary) : "";
  const tags = deriveTags(job);

  const slugify = (value) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "tab";

  const sections = [];
  if (tags.length) {
    const tagsMarkup = tags
      .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
      .join("");
    sections.push({
      title: "Tags",
      content: `<div class="job-modal-tags">${tagsMarkup}</div>`,
    });
  }
  if (summary) {
    sections.push({
      title: "Summary",
      content: `<p>${escapeHtml(summary)}</p>`,
    });
  }
  if (job.overview) {
    sections.push({
      title: "Overview",
      content: `<p>${escapeHtml(job.overview)}</p>`,
    });
  }
  if (responsibilities) {
    sections.push({
      title: "Responsibilities",
      content: `<ul>${responsibilities}</ul>`,
    });
  }
  if (requirements) {
    sections.push({
      title: "Requirements",
      content: `<ul>${requirements}</ul>`,
    });
  }

  const tabsMarkup = sections.length
    ? (() => {
        const nav = sections
          .map((section, index) => {
            const slug = `${slugify(section.title)}-${index}`;
            return `<button type="button" role="tab" id="${slug}-tab" class="job-tab-btn${
              index === 0 ? " is-active" : ""
            }" data-tab="${slug}-panel" aria-controls="${slug}-panel" aria-selected="${
              index === 0
            }">${escapeHtml(section.title)}</button>`;
          })
          .join("");
        const panels = sections
          .map((section, index) => {
            const slug = `${slugify(section.title)}-${index}`;
            return `<section id="${slug}-panel" role="tabpanel" aria-labelledby="${slug}-tab" class="job-tab-panel${
              index === 0 ? " is-active" : ""
            }">${section.content}</section>`;
          })
          .join("");
        return `
          <div class="job-modal-tabs">
            <div class="job-tabs__nav" role="tablist">
              ${nav}
            </div>
            ${panels}
          </div>
        `;
      })()
    : "";

  return `
    <header>
      <h2>
      ${
        job.url
          ? `<a class="glow-link" href="${
              job.url
            }" target="_blank" rel="noopener noreferrer">${escapeHtml(
              job.title
            )}</a>`
          : ""
      }
      </h2>
    </header>
    ${tabsMarkup}
  `;
}

function htmlToText(html) {
  if (!html) return "";
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent?.trim() || "";
}

async function loadStatuses() {
  try {
    const raw = await readStorage(STORAGE_KEYS.statuses);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveStatuses(statuses) {
  return writeStorage(STORAGE_KEYS.statuses, JSON.stringify(statuses));
}

function findJobByKey(key) {
  return state.jobs.find((job) => jobKey(job) === key);
}

function deriveTags(job) {
  const tags = [];
  const hay = `${job.title} ${job.summary || ""}`.toLowerCase();
  const keywords = state.settings.keywords?.length
    ? state.settings.keywords
    : DEFAULT_KEYWORDS;
  keywords.forEach((kw) => {
    if (hay.includes(kw.toLowerCase())) tags.push(kw);
  });
  if (job.url) {
    try {
      const host = new URL(job.url).host.replace(/^www\./, "");
      tags.push(host);
    } catch {}
  }
  return Array.from(new Set(tags)).slice(0, 3);
}

function applyFilters() {
  if (!state.jobs?.length) {
    state.filteredJobs = [];
    renderJobs([]);
    updateStatusCounts();
    updateFilterButton();
    return;
  }
  const term = state.search.trim().toLowerCase();
  state.filteredJobs = state.jobs.filter((job) => {
    const matchesTerm = term
      ? (
          [
            job.title,
            job.overview,
            job.summary,
            job.responsibilities?.join(" "),
            job.requirements?.join(" "),
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase() || ""
        ).includes(term)
      : true;
    const status = getJobStatus(jobKey(job));
    const matchesStatus =
      state.statusFilter === "all" ? true : status === state.statusFilter;
    return matchesTerm && matchesStatus;
  });
  renderJobs();
  updateStatusCounts();
  updateFilterButton();
}

function setStatusFilter(filter) {
  if (!FILTER_SEQUENCE.includes(filter)) return;
  state.statusFilter = filter;
  closeFilterMenu();
  applyFilters();
}

function toggleFilterMenu() {
  if (!dom.filterMenu) return;
  const isOpen = dom.filterMenu.dataset.state === "open";
  dom.filterMenu.dataset.state = isOpen ? "hidden" : "open";
}

function closeFilterMenu() {
  if (!dom.filterMenu) return;
  dom.filterMenu.dataset.state = "hidden";
}

function updateFilterButton() {
  if (!dom.filterBtn) return;
  const label =
    state.statusFilter === "all"
      ? "All jobs"
      : `${statusLabel(state.statusFilter)} only`;
  if (dom.filterLabel) {
    dom.filterLabel.textContent = label;
  } else {
    dom.filterBtn.textContent = label;
  }
  dom.filterBtn.dataset.filter = state.statusFilter;
  if (dom.filterMenu) {
    Array.from(dom.filterMenu.querySelectorAll("button[data-filter]")).forEach(
      (btn) => {
        btn.classList.toggle(
          "is-active",
          btn.dataset.filter === state.statusFilter
        );
      }
    );
  }
}

function updateStatusCounts() {
  const totals = collectStatusTotals();
  updateFilterMenuCounts(totals);
  return totals;
}

function collectStatusTotals() {
  const totals = { new: 0, applied: 0, irrelevant: 0 };
  state.jobs.forEach((job) => {
    const status = getJobStatus(jobKey(job));
    if (status === "applied") totals.applied += 1;
    else if (status === "irrelevant") totals.irrelevant += 1;
    else totals.new += 1;
  });
  return totals;
}

function updateFilterMenuCounts(totals) {
  if (!dom.filterMenu) return;
  const totalJobs = totals.new + totals.applied + totals.irrelevant;
  Array.from(dom.filterMenu.querySelectorAll("button[data-filter]")).forEach(
    (btn) => {
      const filter = btn.dataset.filter;
      btn.textContent = buildFilterOptionLabel(filter, totals, totalJobs);
    }
  );
}

function buildFilterOptionLabel(filter, totals, total) {
  const baseLabel = FILTER_DISPLAY_LABELS[filter] || "All jobs";
  const count = filter === "all" ? total : totals[filter] ?? 0;
  return `${baseLabel} (${count})`;
}

function updateVisibleTotal(count = state.filteredJobs?.length || 0) {
  if (dom.visibleTotal) {
    if (!count) {
      dom.visibleTotal.textContent = "No jobs match current filters";
    } else {
      const label = `${count}/`;
      dom.visibleTotal.textContent = label;
    }
  }
}

function statusLabel(status) {
  switch (status) {
    case "applied":
      return "✓";
    case "irrelevant":
      return "x";
    case "all":
      return "All";
    default:
      return "+";
  }
}

function readStorage(key) {
  return deferIO(() => localStorage.getItem(key));
}

function writeStorage(key, value) {
  return deferIO(() => {
    localStorage.setItem(key, value);
    return true;
  });
}

function deferIO(fn) {
  return new Promise((resolve) => {
    const runner = () => {
      try {
        resolve(fn());
      } catch (err) {
        console.error(err);
        resolve(null);
      }
    };
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      window.requestIdleCallback(runner);
    } else {
      setTimeout(runner, 0);
    }
  });
}

async function mapWithConcurrency(list, limit, fn) {
  if (!list?.length) return [];
  const results = new Array(list.length);
  let index = 0;
  const workerCount = Math.min(limit, list.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (index < list.length) {
      const current = index++;
      try {
        results[current] = await fn(list[current], current);
      } catch (err) {
        throw err;
      }
    }
  });
  await Promise.all(workers);
  return results;
}

async function fetchWithRetry(url) {
  let lastErr;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        method: "POST",
        headers: {
          "x-cors-headers": JSON.stringify({
            // allows to send forbidden headers
            // https://developer.mozilla.org/en-US/docs/Glossary/Forbidden_header_name
            cookies: "x=123",
          }),
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const text = await res.text();
      return text;
    } catch (err) {
      lastErr = err;
      await delay(600 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(lastErr?.message || "Unable to fetch feeds.");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeFeed(xml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) return [];
  const rssItems = Array.from(doc.querySelectorAll("rss channel item"));
  if (rssItems.length) {
    return rssItems.map((item) => ({
      title: textContent(item.querySelector("title")),
      link: textContent(item.querySelector("link")),
      guid:
        textContent(item.querySelector("guid")) ||
        textContent(item.querySelector("link")),
      published: isoDate(
        textContent(item.querySelector("pubDate")) ||
          textContent(item.querySelector("dc\\:date"))
      ),
      summary:
        textContent(item.querySelector("description")) ||
        textContent(item.querySelector("content\\:encoded")),
    }));
  }
  const atomEntries = Array.from(doc.querySelectorAll("feed entry"));
  if (atomEntries.length) {
    return atomEntries.map((entry) => ({
      title: textContent(entry.querySelector("title")),
      link:
        entry.querySelector("link")?.getAttribute("href") ||
        textContent(entry.querySelector("id")),
      guid:
        textContent(entry.querySelector("id")) ||
        textContent(entry.querySelector("link")),
      published: isoDate(
        textContent(entry.querySelector("published")) ||
          textContent(entry.querySelector("updated"))
      ),
      summary:
        textContent(entry.querySelector("summary")) ||
        textContent(entry.querySelector("content")),
    }));
  }
  return [];
}

function isoDate(value) {
  if (!value) return new Date().toISOString();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}

function textContent(node) {
  if (!node) return "";
  return node.textContent?.trim() || "";
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = (item.guid || item.link || item.title || "").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function matchKeywords(item, keywords) {
  if (!keywords?.length) return true;
  const haystack = `${item.title} ${item.summary}`.toLowerCase();
  return keywords.some((kw) => haystack.includes(kw.toLowerCase()));
}

function parseJobHtml(html) {
  if (!html) {
    return {
      overview: null,
      responsibilities: [],
      requirements: [],
      apply_url: null,
    };
  }
  const parser = new DOMParser();
  const doc = parser.parseFromString(html.replace(/\\n/g, "\n"), "text/html");
  const overview = findOverview(doc);
  const responsibilities = findListAfterKeywords(doc, [
    "responsibilities",
    "what you'll do",
    "what you will do",
  ]);
  const requirements = findListAfterKeywords(doc, [
    "requirements",
    "qualifications",
    "what we're looking for",
  ]);
  const applyAnchor = Array.from(doc.querySelectorAll("a")).find(
    (a) =>
      /apply/i.test(a.textContent || "") ||
      /cryptojobslist\.com\/jobs/.test(a.href)
  );
  return {
    overview,
    responsibilities,
    requirements,
    apply_url: applyAnchor?.href || null,
  };
}

function findOverview(doc) {
  const paragraphs = Array.from(doc.querySelectorAll("p"))
    .map((p) => p.textContent.trim())
    .filter(Boolean);
  const longForm = paragraphs.find((text) => text.length > 120);
  return longForm || paragraphs[0] || null;
}

function findListAfterKeywords(doc, keywords) {
  const nodes = Array.from(doc.querySelectorAll("h2, h3, h4, strong, p"));
  for (const keyword of keywords) {
    const match = nodes.find((node) =>
      (node.textContent || "").toLowerCase().includes(keyword.toLowerCase())
    );
    if (!match) continue;
    let next = match.nextElementSibling;
    while (next && !["UL", "OL"].includes(next.tagName)) {
      next = next.nextElementSibling;
    }
    if (next && ["UL", "OL"].includes(next.tagName)) {
      const items = Array.from(next.querySelectorAll("li"))
        .map((li) => li.textContent.trim())
        .filter(Boolean);
      if (items.length) return dedupeStrings(items);
    }
  }
  return [];
}

function dedupeStrings(items) {
  return Array.from(new Set(items));
}
