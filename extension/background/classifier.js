// Pure classification helpers. This file is loaded as the first background
// script, so these declarations are visible to background.js through the shared
// background scope. Keeping them free of browser APIs lets the test suite load
// the file directly and assert on classification behaviour.

const LEVEL_ORDER = {
  limited: 0,
  moderate: 1,
  high: 2,
  critical: 3
};

// Firefox does not emit a management event when a user grants or revokes an
// optional permission, so a stored snapshot can drift. Snapshots older than this
// are refreshed the next time the popup or dashboard asks for state.
const SNAPSHOT_MAX_AGE_MS = 5 * 60 * 1000;

// Schemes whose wildcard host covers ordinary web browsing. Firefox expands the
// "*" scheme to http, https, ws and wss.
const WEB_MATCH_SCHEMES = new Set(["*", "http", "https", "ws", "wss"]);

// Remaining schemes Firefox accepts in a match pattern. A wildcard host on one
// of these is still broad, but it is not access to every website.
const OTHER_MATCH_SCHEMES = new Set(["file", "ftp", "data"]);

// Splits a WebExtension match pattern into its parts, or returns null when the
// pattern is not one Extension Watchdog can reason about. Parsing structurally
// avoids the false negatives that string-shape checks produce, such as treating
// "https://*/*" as a narrow permission because it does not start with "*://".
function parseMatchPattern(pattern) {
  if (typeof pattern !== "string") {
    return null;
  }

  if (pattern === "<all_urls>") {
    return { scheme: "*", host: "*", path: "/*", allUrls: true };
  }

  const separator = pattern.indexOf("://");
  if (separator < 1) {
    return null;
  }

  const scheme = pattern.slice(0, separator).toLowerCase();
  if (!WEB_MATCH_SCHEMES.has(scheme) && !OTHER_MATCH_SCHEMES.has(scheme)) {
    return null;
  }

  const remainder = pattern.slice(separator + 3);
  const pathStart = remainder.indexOf("/");
  if (pathStart < 0) {
    // Firefox requires an explicit path component in a match pattern.
    return null;
  }

  const host = remainder.slice(0, pathStart).toLowerCase();
  const path = remainder.slice(pathStart);

  if (scheme === "file") {
    return host === "" ? { scheme, host, path, allUrls: false } : null;
  }

  if (host === "") {
    return null;
  }

  // A wildcard is only legal as the whole host or as the leading label.
  if (host !== "*" && host.includes("*") && !host.startsWith("*.")) {
    return null;
  }

  if (host.startsWith("*.") && host.slice(2).includes("*")) {
    return null;
  }

  return { scheme, host, path, allUrls: false };
}

// "all_sites" means every ordinary website, "broad" means many sites but not
// all, "narrow" means one specific host, and "unknown" means the pattern could
// not be parsed and therefore needs a human to look at it.
function classifyHostPermission(pattern) {
  const parsed = parseMatchPattern(pattern);
  if (!parsed) {
    return "unknown";
  }

  if (parsed.allUrls) {
    return "all_sites";
  }

  if (parsed.scheme === "file") {
    return "broad";
  }

  if (parsed.host === "*") {
    // A wildcard host is every host, even when the scheme is specific.
    return WEB_MATCH_SCHEMES.has(parsed.scheme) ? "all_sites" : "broad";
  }

  if (parsed.host.startsWith("*.")) {
    return "broad";
  }

  return "narrow";
}

function hasAllSitesAccess(hostPermissions = []) {
  return hostPermissions.some(
    (pattern) => classifyHostPermission(pattern) === "all_sites"
  );
}

function hasBroadHostAccess(hostPermissions = []) {
  return hostPermissions.some((pattern) => {
    const classification = classifyHostPermission(pattern);
    return classification === "all_sites" || classification === "broad";
  });
}

function getUnknownHostPermissions(hostPermissions = []) {
  return hostPermissions.filter(
    (pattern) => classifyHostPermission(pattern) === "unknown"
  );
}

// Firefox reports API permissions and host permissions separately, but older
// add-ons and future API changes can put a host pattern in either list. Sorting
// by shape keeps a stray "<all_urls>" from being reported as an unknown API.
function isHostPattern(value) {
  return value === "<all_urls>" || (typeof value === "string" && value.includes("://"));
}

function requirementMatches(requirement, extension) {
  const [kind, value] = requirement.split(":", 2);

  if (kind === "permission") {
    return extension.permissions.includes(value);
  }

  if (kind === "host" && value === "all_sites") {
    return hasAllSitesAccess(collectHostPermissions(extension));
  }

  if (kind === "host" && value === "broad") {
    return hasBroadHostAccess(collectHostPermissions(extension));
  }

  return false;
}

function collectHostPermissions(extension) {
  return [
    ...(extension.hostPermissions || []),
    ...(extension.permissions || []).filter(isHostPattern)
  ];
}

function analyzeExtension(extension, rules) {
  const findings = [];
  const hostPermissions = collectHostPermissions(extension);
  const apiPermissions = (extension.permissions || []).filter(
    (permission) => !isHostPattern(permission)
  );

  for (const permission of apiPermissions) {
    const rule = rules.permissions[permission];

    if (rule) {
      findings.push({
        id: `permission:${permission}`,
        source: "permission",
        subject: permission,
        ...rule
      });
      continue;
    }

    // Absence from the rules file means the capability has not been reviewed,
    // not that it is harmless. Fail towards review rather than towards silence.
    findings.push({
      id: `permission:${permission}`,
      source: "permission",
      subject: permission,
      level: "moderate",
      // Carries its own review flag rather than relying on the level. A
      // moderate rating alone does not reach the dashboard review queue, which
      // would contradict the title of this finding.
      requiresReview: true,
      title: "Unknown Firefox capability: manual review required",
      explanation: `Extension Watchdog does not have a reviewed description for the "${permission}" permission. Check what this capability allows before treating the extension as low risk.`
    });
  }

  if (hasAllSitesAccess(hostPermissions)) {
    findings.push({
      id: "host:all-sites",
      source: "host",
      subject: "<all_urls>",
      level: "high",
      title: "Accesses every website",
      explanation: "Can read or change data on nearly every website, depending on the extension's behavior."
    });
  } else if (hasBroadHostAccess(hostPermissions)) {
    findings.push({
      id: "host:broad",
      source: "host",
      subject: "broad host access",
      level: "moderate",
      title: "Accesses broad groups of websites",
      explanation: "Can interact with multiple websites covered by wildcard host permissions."
    });
  }

  const unknownHosts = getUnknownHostPermissions(hostPermissions);
  if (unknownHosts.length > 0) {
    findings.push({
      id: "host:unknown",
      source: "host",
      subject: unknownHosts.join(", "),
      level: "moderate",
      requiresReview: true,
      title: "Unrecognized website access pattern: manual review required",
      explanation: "Firefox reported a host permission that Extension Watchdog could not interpret, so the amount of website access it grants is unclear."
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
    requiresReview: analysisRequiresReview(level, findings),
    summary: summarizeAnalysis(level, findings)
  };
}

// The single source of truth for whether an extension belongs in the review
// queue. A high or critical rating qualifies, and so does any finding that
// explicitly asks for review even when its own level is lower.
function analysisRequiresReview(level, findings) {
  return (
    ["critical", "high"].includes(level) ||
    findings.some((finding) => finding.requiresReview === true)
  );
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

// A snapshot recorded in the future means the system clock moved, so it is
// treated as stale rather than trusted.
function isSnapshotFresh(scannedAt, now = Date.now(), maxAgeMs = SNAPSHOT_MAX_AGE_MS) {
  if (typeof scannedAt !== "string") {
    return false;
  }

  const scannedTime = Date.parse(scannedAt);
  if (Number.isNaN(scannedTime)) {
    return false;
  }

  const age = now - scannedTime;
  return age >= 0 && age < maxAgeMs;
}
