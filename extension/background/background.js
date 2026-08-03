const STORAGE_KEYS = {
  snapshot: "extensionSnapshot",
  changes: "changeHistory",
  scannedAt: "lastScannedAt"
};

// LEVEL_ORDER, the host-permission classifier, analyzeExtension and
// isSnapshotFresh come from background/classifier.js, which the manifest loads
// first.

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
      : `${first.title}. Open Permission Hound to review it.`;

  await browser.notifications.create("extension-watchdog-change", {
    type: "basic",
    title: "Extension access changed",
    message,
    iconUrl: browser.runtime.getURL("icons/permission-hound-96.png")
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

  // Optional permission and host-access grants do not raise a management event,
  // so a stored snapshot is only trusted inside a bounded freshness window.
  // Refreshing here rather than polling keeps scanning tied to real user
  // interaction.
  if (
    !stored[STORAGE_KEYS.snapshot] ||
    !isSnapshotFresh(stored[STORAGE_KEYS.scannedAt])
  ) {
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
