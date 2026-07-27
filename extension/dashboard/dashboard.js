const elements = {
  scanButton: document.querySelector("#scan-button"),
  addonsButton: document.querySelector("#addons-button"),
  exportButton: document.querySelector("#export-button"),
  reviewButton: document.querySelector("#review-button"),
  searchInput: document.querySelector("#search-input"),
  filterSelect: document.querySelector("#filter-select"),
  status: document.querySelector("#status-message"),
  extensionList: document.querySelector("#extension-list"),
  activityList: document.querySelector("#activity-list"),
  summaryTotal: document.querySelector("#summary-total"),
  summaryEnabled: document.querySelector("#summary-enabled"),
  summaryReview: document.querySelector("#summary-review"),
  summaryBroad: document.querySelector("#summary-broad"),
  summaryChanges: document.querySelector("#summary-changes"),
  summaryScanned: document.querySelector("#summary-scanned")
};

let state = {
  extensions: [],
  changes: [],
  scannedAt: null
};

function hasEveryWebsiteAccess(extension) {
  const hosts = new Set(extension.hostPermissions || []);
  return (
    hosts.has("<all_urls>") ||
    hosts.has("*://*/*") ||
    (hosts.has("http://*/*") && hosts.has("https://*/*"))
  );
}

function unreviewedChangesFor(extensionId) {
  return state.changes.filter((change) => {
    return change.extensionId === extensionId && !change.reviewed;
  });
}

function needsReview(extension) {
  return (
    ["critical", "high"].includes(extension.analysis.level) ||
    unreviewedChangesFor(extension.id).length > 0
  );
}

function formatRelativeDate(value) {
  if (!value) {
    return "No scan yet";
  }

  const date = new Date(value);
  const elapsedSeconds = Math.round((Date.now() - date.getTime()) / 1000);

  if (elapsedSeconds < 10) {
    return "Scanned just now";
  }
  if (elapsedSeconds < 60) {
    return `Scanned ${elapsedSeconds} seconds ago`;
  }
  if (elapsedSeconds < 3600) {
    const minutes = Math.floor(elapsedSeconds / 60);
    return `Scanned ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }

  return `Scanned ${date.toLocaleString()}`;
}

function setStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle("error", isError);
}

function createElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

function renderSummary() {
  const enabledCount = state.extensions.filter((extension) => extension.enabled).length;
  const reviewCount = state.extensions.filter(needsReview).length;
  const broadCount = state.extensions.filter(hasEveryWebsiteAccess).length;
  const unreviewedCount = state.changes.filter((change) => !change.reviewed).length;

  elements.summaryTotal.textContent = String(state.extensions.length);
  elements.summaryEnabled.textContent = `${enabledCount} enabled`;
  elements.summaryReview.textContent = String(reviewCount);
  elements.summaryBroad.textContent = String(broadCount);
  elements.summaryChanges.textContent = String(unreviewedCount);
  elements.summaryScanned.textContent = formatRelativeDate(state.scannedAt);
  elements.reviewButton.disabled = unreviewedCount === 0;
}

function createIcon(extension) {
  const wrapper = createElement(
    "div",
    "extension-icon",
    extension.name.slice(0, 1).toUpperCase()
  );

  if (extension.iconUrl) {
    const image = document.createElement("img");
    image.alt = "";
    image.addEventListener("load", () => wrapper.replaceChildren(image), {
      once: true
    });
    image.addEventListener("error", () => image.remove(), { once: true });
    image.src = extension.iconUrl;
  }

  return wrapper;
}

function createFinding(finding) {
  const item = createElement("div", `finding ${finding.level}`);
  item.append(
    createElement("strong", null, finding.title),
    createElement("p", null, finding.explanation)
  );
  return item;
}

function permissionTitles(extension) {
  const titles = extension.analysis.findings
    .filter((finding) => finding.source === "permission" || finding.source === "host")
    .map((finding) => finding.title);

  return [...new Set(titles)].slice(0, 4);
}

function createExtensionCard(extension) {
  const card = createElement("article", "extension-card");
  card.dataset.extensionId = extension.id;

  const main = createElement("div", "extension-main");
  const identity = createElement("div");
  const titleRow = createElement("div", "extension-title-row");
  titleRow.append(
    createElement("span", "extension-title", extension.name),
    createElement("span", "version", `v${extension.version}`)
  );

  if (!extension.enabled) {
    titleRow.append(createElement("span", "disabled-badge", "Disabled"));
  }

  if (unreviewedChangesFor(extension.id).length > 0) {
    titleRow.append(createElement("span", "changed-badge", "Changed"));
  }

  identity.append(
    titleRow,
    createElement("p", "extension-summary", extension.analysis.summary)
  );

  const riskBadge = createElement(
    "span",
    `risk-badge risk-${extension.analysis.level}`,
    extension.analysis.level
  );
  main.append(createIcon(extension), identity, riskBadge);
  card.append(main);

  const chips = createElement("div", "capability-row");
  const titles = permissionTitles(extension);
  if (titles.length === 0) {
    titles.push("No recognized broad capabilities");
  }
  for (const title of titles) {
    chips.append(createElement("span", "capability-chip", title));
  }
  card.append(chips);

  const details = createElement("details", "extension-details");
  const summary = createElement(
    "summary",
    null,
    `Review ${extension.analysis.findings.length} finding${
      extension.analysis.findings.length === 1 ? "" : "s"
    }`
  );
  const findingList = createElement("div", "finding-list");

  if (extension.analysis.findings.length === 0) {
    findingList.append(
      createFinding({
        level: "limited",
        title: "No broad capabilities recognized",
        explanation:
          "This does not prove the extension is safe. It means Watchdog did not identify a powerful permission in the current rule set."
      })
    );
  } else {
    for (const finding of extension.analysis.findings) {
      findingList.append(createFinding(finding));
    }
  }

  const rawValues = [
    ...extension.permissions.map((permission) => `permission: ${permission}`),
    ...extension.hostPermissions.map((host) => `host: ${host}`)
  ];
  const rawAccess = createElement(
    "p",
    "raw-access",
    rawValues.length > 0 ? rawValues.join(" · ") : "No declared API or host permissions."
  );

  details.append(summary, findingList, rawAccess);
  card.append(details);
  return card;
}

function filteredExtensions() {
  const search = elements.searchInput.value.trim().toLocaleLowerCase();
  const filter = elements.filterSelect.value;

  return state.extensions.filter((extension) => {
    const matchesSearch =
      !search ||
      extension.name.toLocaleLowerCase().includes(search) ||
      extension.description.toLocaleLowerCase().includes(search) ||
      extension.id.toLocaleLowerCase().includes(search);

    if (!matchesSearch) {
      return false;
    }

    switch (filter) {
      case "review":
        return needsReview(extension);
      case "changed":
        return unreviewedChangesFor(extension.id).length > 0;
      case "broad":
        return hasEveryWebsiteAccess(extension);
      case "disabled":
        return !extension.enabled;
      default:
        return true;
    }
  });
}

function renderExtensions() {
  elements.extensionList.replaceChildren();
  const extensions = filteredExtensions();

  if (extensions.length === 0) {
    elements.extensionList.append(
      createElement("div", "empty-state", "No extensions match this view.")
    );
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const extension of extensions) {
    fragment.append(createExtensionCard(extension));
  }
  elements.extensionList.append(fragment);
}

function renderActivity() {
  elements.activityList.replaceChildren();

  if (state.changes.length === 0) {
    elements.activityList.append(
      createElement(
        "div",
        "empty-state",
        "No changes recorded yet. This scan is now your local baseline."
      )
    );
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const change of state.changes.slice(0, 25)) {
    const item = createElement(
      "article",
      `activity-item${change.reviewed ? "" : " unreviewed"}`
    );
    const dot = createElement("span", "activity-dot");
    dot.setAttribute("aria-hidden", "true");

    const copy = createElement("div");
    copy.append(
      createElement("p", "activity-title", change.title),
      createElement("p", "activity-time", new Date(change.occurredAt).toLocaleString())
    );
    if (change.details?.length) {
      copy.append(createElement("p", "activity-details", change.details.join(" · ")));
    }
    item.append(dot, copy);
    fragment.append(item);
  }

  elements.activityList.append(fragment);
}

function render() {
  renderSummary();
  renderExtensions();
  renderActivity();
}

async function loadState() {
  try {
    state = await browser.runtime.sendMessage({ type: "get-state" });
    render();
    setStatus(formatRelativeDate(state.scannedAt));
  } catch (error) {
    console.error(error);
    setStatus(`Unable to read extension metadata: ${error.message}`, true);
  }
}

async function runScan() {
  elements.scanButton.disabled = true;
  elements.scanButton.textContent = "Scanning…";
  setStatus("Comparing installed extensions with the local baseline…");

  try {
    state = await browser.runtime.sendMessage({ type: "scan" });
    render();
    setStatus(
      state.baselineCreated
        ? "Baseline created. Future scans will highlight changes."
        : formatRelativeDate(state.scannedAt)
    );
  } catch (error) {
    console.error(error);
    setStatus(`Scan failed: ${error.message}`, true);
  } finally {
    elements.scanButton.disabled = false;
    elements.scanButton.textContent = "Scan now";
  }
}

async function markReviewed() {
  const unreviewedIds = state.changes
    .filter((change) => !change.reviewed)
    .map((change) => change.id);

  if (unreviewedIds.length === 0) {
    return;
  }

  try {
    state.changes = await browser.runtime.sendMessage({
      type: "review-changes",
      changeIds: unreviewedIds
    });
    render();
    setStatus("Recent changes marked as reviewed.");
  } catch (error) {
    console.error(error);
    setStatus(`Could not update the review state: ${error.message}`, true);
  }
}

function exportReport() {
  const report = {
    generatedAt: new Date().toISOString(),
    product: "Extension Watchdog",
    version: browser.runtime.getManifest().version,
    privacy: "Generated locally. No report data was transmitted.",
    ...state
  };
  const blob = new Blob([JSON.stringify(report, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `extension-watchdog-report-${new Date()
    .toISOString()
    .slice(0, 10)}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setStatus("Local JSON report exported.");
}

elements.scanButton.addEventListener("click", runScan);
elements.addonsButton.addEventListener("click", () => {
  browser.runtime.sendMessage({ type: "open-addons-manager" });
});
elements.exportButton.addEventListener("click", exportReport);
elements.reviewButton.addEventListener("click", markReviewed);
elements.searchInput.addEventListener("input", renderExtensions);
elements.filterSelect.addEventListener("change", renderExtensions);

loadState();
