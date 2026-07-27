const STORAGE_KEYS = {
  snapshot: "extensionSnapshot",
  changes: "changeHistory",
  scannedAt: "lastScannedAt"
};

const LEVEL_ORDER = {
  limited: 0,
  moderate: 1,
  high: 2,
  critical: 3
};

const MAX_CHANGE_HISTORY = 200;
let scanChain = Promise.resolve();
let ruleCache;

async function loadRules() {
  if (!ruleCache) {
    ruleCache = Promise.all([
      fetch(browser.runtime.getURL("rules/permissions.json")).then((response) => {
        if (!response.ok) {
          throw new Error(`Unable to load permission rules: ${response.status}`);
        }
        return response.json();
      }),
      fetch(browser.runtime.getURL("rules/combinations.json")).then((response) => {
        if (!response.ok) {
          throw new Error(`Unable to load combination rules: ${response.status}`);
        }
        return response.json();
      })
    ]).then(([permissions, combinations]) => ({ permissions, combinations }));
  }

  return ruleCache;
}

function sortedUnique(values = []) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function hasAllSitesAccess(hostPermissions) {
  const hosts = new Set(hostPermissions);
  return (
    hosts.has("<all_urls>") ||
    hosts.has("*://*/*") ||
    (hosts.has("http://*/*") && hosts.has("https://*/*"))
  );
}

function hasBroadHostAccess(hostPermissions) {
  return hostPermissions.some((host) => {
    return (
      host === "<all_urls>" ||
      host === "*://*/*" ||
      host.includes("://*.") ||
      host.startsWith("*://")
    );
  });
}

function chooseIcon(icons = []) {
  return [...icons]
    .filter((icon) => icon && icon.url)
    .sort((left, right) => (right.size || 0) - (left.size || 0))[0]?.url || null;
}

function normalizeExtension(info) {
  return {
    id: info.id,
    name: info.name || "Unnamed extension",
    shortName: info.shortName || "",
    description: info.description || "",
    version: info.version || "unknown",
    enabled: Boolean(info.enabled),
    disabledReason: info.disabledReason || null,
    installType: info.installType || "unknown",
    mayDisable: info.mayDisable !== false,
    homepageUrl: info.homepageUrl || null,
    updateUrl: info.updateUrl || null,
    iconUrl: chooseIcon(info.icons),
    permissions: sortedUnique(info.permissions),
    hostPermissions: sortedUnique(info.hostPermissions)
  };
}

function requirementMatches(requirement, extension) {
  const [kind, value] = requirement.split(":", 2);

  if (kind === "permission") {
    return extension.permissions.includes(value);
  }

  if (kind === "host" && value === "all_sites") {
    return hasAllSitesAccess(extension.hostPermissions);
  }

  if (kind === "host" && value === "broad") {
    return hasBroadHostAccess(extension.hostPermissions);
  }

  return false;
}

function analyzeExtension(extension, rules) {
  const findings = [];

  for (const permission of extension.permissions) {
    const rule = rules.permissions[permission];
    if (rule) {
      findings.push({
        id: `permission:${permission}`,
        source: "permission",
        subject: permission,
        ...rule
      });
    }
  }

  if (hasAllSitesAccess(extension.hostPermissions)) {
    findings.push({
      id: "host:all-sites",
      source: "host",
      subject: "<all_urls>",
      level: "high",
      title: "Accesses every website",
      explanation: "Can read or change data on nearly every website, depending on the extension's behavior."
    });
  } else if (hasBroadHostAccess(extension.hostPermissions)) {
    findings.push({
      id: "host:broad",
      source: "host",
      subject: "broad host access",
      level: "moderate",
      title: "Accesses broad groups of websites",
      explanation: "Can interact with multiple websites covered by wildcard host permissions."
    });
  }

  if (extension.installType === "sideload") {
    findings.push({
      id: "install:sideload",
      source: "installation",
      subject: "sideload",
      level: "high",
      title: "Installed by other software",
      explanation: "Firefox reports that another application placed this extension on the computer."
    });
  }

  if (extension.disabledReason === "permissions_increase") {
    findings.push({
      id: "state:permissions-increase",
      source: "state",
      subject: "permissions increase",
      level: "critical",
      title: "Disabled after requesting more access",
      explanation: "Firefox disabled this extension because an update requested additional permissions."
    });
  }

  for (const combination of rules.combinations) {
    if (combination.requires.every((requirement) => requirementMatches(requirement, extension))) {
      findings.push({
        ...combination,
        source: "combination",
        subject: combination.requires.join(" + ")
      });
    }
  }

  findings.sort((left, right) => {
    return (
      LEVEL_ORDER[right.level] - LEVEL_ORDER[left.level] ||
      left.title.localeCompare(right.title)
    );
  });

  const level = findings.reduce((highest, finding) => {
    return LEVEL_ORDER[finding.level] > LEVEL_ORDER[highest] ? finding.level : highest;
  }, "limited");

  return {
    level,
    findings,
    summary: summarizeAnalysis(level, findings)
  };
}

function summarizeAnalysis(level, findings) {
  const combinations = findings.filter((finding) => finding.source === "combination");
  if (combinations.length > 0) {
    return combinations[0].title;
  }

  const mostImportant = findings[0];
  if (mostImportant) {
    return mostImportant.title;
  }

  if (level === "limited") {
    return "No broad capabilities recognized";
  }

  return "Review its capabilities";
}

function arrayDifference(nextValues, previousValues) {
  const previousSet = new Set(previousValues);
  return nextValues.filter((value) => !previousSet.has(value));
}

function createChange(extension, type, title, details = []) {
  return {
    id: crypto.randomUUID(),
    extensionId: extension.id,
    extensionName: extension.name,
    type,
    title,
    details,
    occurredAt: new Date().toISOString(),
    reviewed: false
  };
}

function compareSnapshots(previousSnapshot, currentSnapshot) {
  const previousById = new Map(previousSnapshot.map((extension) => [extension.id, extension]));
  const currentById = new Map(currentSnapshot.map((extension) => [extension.id, extension]));
  const changes = [];

  for (const extension of currentSnapshot) {
    const previous = previousById.get(extension.id);

    if (!previous) {
      changes.push(
        createChange(
          extension,
          "installed",
          `${extension.name} was installed`,
          [`Version ${extension.version}`, `Installation type: ${extension.installType}`]
        )
      );
      continue;
    }

    const addedPermissions = arrayDifference(extension.permissions, previous.permissions);
    const removedPermissions = arrayDifference(previous.permissions, extension.permissions);
    const addedHosts = arrayDifference(extension.hostPermissions, previous.hostPermissions);
    const removedHosts = arrayDifference(previous.hostPermissions, extension.hostPermissions);

    if (addedPermissions.length > 0) {
      changes.push(
        createChange(
          extension,
          "permissions_added",
          `${extension.name} gained new permissions`,
          addedPermissions
        )
      );
    }

    if (addedHosts.length > 0) {
      changes.push(
        createChange(
          extension,
          "host_access_added",
          `${extension.name} gained website access`,
          addedHosts
        )
      );
    }

    if (removedPermissions.length > 0 || removedHosts.length > 0) {
      changes.push(
        createChange(
          extension,
          "access_removed",
          `${extension.name} reduced its access`,
          [...removedPermissions, ...removedHosts]
        )
      );
    }

    if (extension.version !== previous.version) {
      changes.push(
        createChange(
          extension,
          "version_changed",
          `${extension.name} updated`,
          [`${previous.version} → ${extension.version}`]
        )
      );
    }

    if (extension.enabled !== previous.enabled) {
      changes.push(
        createChange(
          extension,
          extension.enabled ? "enabled" : "disabled",
          `${extension.name} was ${extension.enabled ? "enabled" : "disabled"}`
        )
      );
    }
  }

  for (const extension of previousSnapshot) {
    if (!currentById.has(extension.id)) {
      changes.push(
        createChange(extension, "removed", `${extension.name} was removed`, [
          `Last observed version: ${extension.version}`
        ])
      );
    }
  }

  return changes;
}

async function notifyAboutChanges(changes) {
  const importantChanges = changes.filter((change) => {
    return ["permissions_added", "host_access_added", "installed"].includes(change.type);
  });

  if (importantChanges.length === 0) {
    return;
  }

  const first = importantChanges[0];
  const additionalCount = importantChanges.length - 1;
  const message =
    additionalCount > 0
      ? `${first.title}. ${additionalCount} more change${additionalCount === 1 ? "" : "s"} need review.`
      : `${first.title}. Open Extension Watchdog to review it.`;

  await browser.notifications.create("extension-watchdog-change", {
    type: "basic",
    title: "Extension access changed",
    message,
    iconUrl: browser.runtime.getURL("icons/watchdog-96.svg")
  });
}

async function performScan({ notify = false } = {}) {
  const [rules, extensionInfos, stored] = await Promise.all([
    loadRules(),
    browser.management.getAll(),
    browser.storage.local.get([
      STORAGE_KEYS.snapshot,
      STORAGE_KEYS.changes
    ])
  ]);

  const currentSnapshot = extensionInfos
    .filter((info) => info.type === "extension" && info.id !== browser.runtime.id)
    .map(normalizeExtension)
    .map((extension) => ({
      ...extension,
      analysis: analyzeExtension(extension, rules)
    }))
    .sort((left, right) => {
      return (
        LEVEL_ORDER[right.analysis.level] - LEVEL_ORDER[left.analysis.level] ||
        left.name.localeCompare(right.name)
      );
    });

  const isFirstScan = !Array.isArray(stored[STORAGE_KEYS.snapshot]);
  const previousSnapshot = stored[STORAGE_KEYS.snapshot] || [];
  const newChanges = isFirstScan ? [] : compareSnapshots(previousSnapshot, currentSnapshot);
  const existingChanges = stored[STORAGE_KEYS.changes] || [];
  const changeHistory = [...newChanges, ...existingChanges].slice(0, MAX_CHANGE_HISTORY);
  const scannedAt = new Date().toISOString();

  await browser.storage.local.set({
    [STORAGE_KEYS.snapshot]: currentSnapshot,
    [STORAGE_KEYS.changes]: changeHistory,
    [STORAGE_KEYS.scannedAt]: scannedAt
  });

  if (notify && newChanges.length > 0) {
    await notifyAboutChanges(newChanges);
  }

  return {
    extensions: currentSnapshot,
    changes: changeHistory,
    scannedAt,
    baselineCreated: isFirstScan
  };
}

function queueScan(options) {
  scanChain = scanChain.then(
    () => performScan(options),
    () => performScan(options)
  );
  return scanChain;
}

async function getState() {
  const stored = await browser.storage.local.get([
    STORAGE_KEYS.snapshot,
    STORAGE_KEYS.changes,
    STORAGE_KEYS.scannedAt
  ]);

  if (!stored[STORAGE_KEYS.snapshot]) {
    return queueScan();
  }

  return {
    extensions: stored[STORAGE_KEYS.snapshot] || [],
    changes: stored[STORAGE_KEYS.changes] || [],
    scannedAt: stored[STORAGE_KEYS.scannedAt] || null,
    baselineCreated: false
  };
}

async function markChangesReviewed(changeIds) {
  const stored = await browser.storage.local.get(STORAGE_KEYS.changes);
  const ids = new Set(changeIds || []);
  const changes = (stored[STORAGE_KEYS.changes] || []).map((change) => {
    if (ids.size === 0 || ids.has(change.id)) {
      return { ...change, reviewed: true };
    }
    return change;
  });

  await browser.storage.local.set({ [STORAGE_KEYS.changes]: changes });
  return changes;
}

browser.runtime.onMessage.addListener((message) => {
  if (!message || typeof message.type !== "string") {
    return undefined;
  }

  switch (message.type) {
    case "get-state":
      return getState();
    case "scan":
      return queueScan();
    case "review-changes":
      return markChangesReviewed(message.changeIds);
    case "open-addons-manager":
      return browser.tabs.create({ url: "about:addons" });
    default:
      return undefined;
  }
});

browser.runtime.onInstalled.addListener(() => {
  queueScan().catch(console.error);
});

browser.runtime.onStartup.addListener(() => {
  queueScan({ notify: true }).catch(console.error);
});

for (const event of [
  browser.management.onInstalled,
  browser.management.onUninstalled,
  browser.management.onEnabled,
  browser.management.onDisabled
]) {
  event.addListener(() => {
    queueScan({ notify: true }).catch(console.error);
  });
}

browser.notifications.onClicked.addListener((notificationId) => {
  if (notificationId === "extension-watchdog-change") {
    browser.runtime.openOptionsPage();
    browser.notifications.clear(notificationId);
  }
});
