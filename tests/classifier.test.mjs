// Regression coverage for the risk classifier in
// extension/background/classifier.js. The file is a plain background script
// rather than a module, so it is evaluated in a fresh context and its function
// declarations are read off that context's global object.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

const extensionDir = new URL("../extension/", import.meta.url);

function loadClassifier() {
  const source = readFileSync(
    fileURLToPath(new URL("background/classifier.js", extensionDir)),
    "utf8"
  );
  const context = {};
  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

function loadJson(relativePath) {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(relativePath, extensionDir)), "utf8")
  );
}

const classifier = loadClassifier();
const rules = {
  permissions: loadJson("rules/permissions.json"),
  combinations: loadJson("rules/combinations.json")
};

function makeExtension(overrides = {}) {
  return {
    id: "test@example.com",
    name: "Test extension",
    permissions: [],
    hostPermissions: [],
    installType: "normal",
    disabledReason: null,
    ...overrides
  };
}

test("wildcard host patterns are broad even when the scheme is specific", () => {
  // The original string-shape check missed these because they neither equal
  // "*://*/*" nor start with "*://".
  for (const pattern of ["https://*/*", "http://*/*", "ws://*/*", "wss://*/*"]) {
    assert.equal(
      classifier.classifyHostPermission(pattern),
      "all_sites",
      `${pattern} should cover every site`
    );
    assert.equal(classifier.hasAllSitesAccess([pattern]), true, pattern);
    assert.equal(classifier.hasBroadHostAccess([pattern]), true, pattern);
  }
});

test("explicit all-sites patterns stay all-sites", () => {
  for (const pattern of ["<all_urls>", "*://*/*"]) {
    assert.equal(classifier.classifyHostPermission(pattern), "all_sites", pattern);
    assert.equal(classifier.hasAllSitesAccess([pattern]), true, pattern);
  }

  assert.equal(
    classifier.hasAllSitesAccess(["http://*/*", "https://*/*"]),
    true,
    "the http plus https pair still counts as all sites"
  );
});

test("wildcard subdomain patterns are broad but not all sites", () => {
  for (const pattern of [
    "https://*.example.com/*",
    "*://*.example.co.uk/*",
    "http://*.internal.test/path"
  ]) {
    assert.equal(classifier.classifyHostPermission(pattern), "broad", pattern);
    assert.equal(classifier.hasBroadHostAccess([pattern]), true, pattern);
    assert.equal(classifier.hasAllSitesAccess([pattern]), false, pattern);
  }
});

test("exact hosts and narrow paths are not escalated", () => {
  for (const pattern of [
    "https://example.com/*",
    "https://example.com/only/this/path",
    "http://sub.example.com/*",
    // A wildcard scheme on a single host is still a single host. The previous
    // startsWith("*://") check escalated this incorrectly.
    "*://example.com/*"
  ]) {
    assert.equal(classifier.classifyHostPermission(pattern), "narrow", pattern);
    assert.equal(classifier.hasBroadHostAccess([pattern]), false, pattern);
    assert.equal(classifier.hasAllSitesAccess([pattern]), false, pattern);
  }
});

test("local file access is treated as broad", () => {
  assert.equal(classifier.classifyHostPermission("file:///*"), "broad");
  assert.equal(classifier.hasBroadHostAccess(["file:///*"]), true);
  assert.equal(classifier.hasAllSitesAccess(["file:///*"]), false);
});

test("unparseable host patterns are surfaced rather than ignored", () => {
  for (const pattern of [
    "not-a-pattern",
    "https://example.com",
    "https://*example.com/*",
    "https://ex*ample.com/*",
    "javascript://*/*",
    ""
  ]) {
    assert.equal(
      classifier.classifyHostPermission(pattern),
      "unknown",
      `${pattern} should not be silently classified`
    );
  }

  assert.deepEqual(
    classifier.getUnknownHostPermissions(["https://example.com/*", "bogus"]),
    ["bogus"]
  );
});

test("an https wildcard host produces the all-sites finding", () => {
  const analysis = classifier.analyzeExtension(
    makeExtension({ hostPermissions: ["https://*/*"] }),
    rules
  );

  assert.equal(analysis.level, "high");
  assert.ok(
    analysis.findings.some((finding) => finding.id === "host:all-sites"),
    "expected the all-sites finding"
  );
  assert.notEqual(analysis.summary, "No broad capabilities recognized");
});

test("combination rules fire for scheme-specific wildcard hosts", () => {
  const analysis = classifier.analyzeExtension(
    makeExtension({
      permissions: ["cookies"],
      hostPermissions: ["https://*/*"]
    }),
    rules
  );

  assert.equal(analysis.level, "critical");
  assert.ok(
    analysis.findings.some((finding) => finding.id === "all-sites-and-cookies"),
    "expected the broad website and cookie access combination"
  );
});

test("unknown permissions produce an explicit review finding", () => {
  const analysis = classifier.analyzeExtension(
    makeExtension({ permissions: ["someFutureCapability"] }),
    rules
  );

  const finding = analysis.findings.find(
    (candidate) => candidate.subject === "someFutureCapability"
  );

  assert.ok(finding, "an unrecognized permission must still create a finding");
  assert.match(finding.title, /manual review required/);
  assert.equal(finding.level, "moderate");
});

test("an extension of only unknown permissions cannot look limited", () => {
  const analysis = classifier.analyzeExtension(
    makeExtension({ permissions: ["mysteryOne", "mysteryTwo"] }),
    rules
  );

  assert.notEqual(analysis.level, "limited");
  assert.notEqual(analysis.summary, "No broad capabilities recognized");
  assert.equal(analysis.findings.length, 2);
});

test("known permissions keep their curated severity", () => {
  const analysis = classifier.analyzeExtension(
    makeExtension({ permissions: ["storage", "notifications"] }),
    rules
  );

  assert.equal(analysis.level, "limited");
  for (const finding of analysis.findings) {
    assert.doesNotMatch(finding.title, /manual review required/);
  }
});

test("every catalogued permission resolves to a reviewed rule", () => {
  // Guards against a rules file edit that drops a permission back into the
  // unknown path without anyone noticing.
  for (const permission of Object.keys(rules.permissions)) {
    const analysis = classifier.analyzeExtension(
      makeExtension({ permissions: [permission] }),
      rules
    );
    assert.equal(analysis.findings.length, 1, permission);
    assert.doesNotMatch(analysis.findings[0].title, /manual review required/, permission);
  }
});

test("a host pattern reported as an api permission is still classified", () => {
  // Defensive: Firefox reports the two lists separately, but a stray host
  // pattern must not be reported as an unknown API capability.
  const analysis = classifier.analyzeExtension(
    makeExtension({ permissions: ["<all_urls>"] }),
    rules
  );

  assert.ok(analysis.findings.some((finding) => finding.id === "host:all-sites"));
  assert.ok(
    !analysis.findings.some((finding) => /manual review required/.test(finding.title)),
    "a host pattern is not an unknown API permission"
  );
});

// The permission names Firefox documents for manifest.json. A name here with no
// rule falls through to the unknown-capability fallback, which is safe but
// generic, so this list is what "reviewed catalog" actually means.
const DOCUMENTED_FIREFOX_PERMISSIONS = [
  "activeTab", "alarms", "background", "bookmarks", "browserSettings",
  "browsingData", "captivePortal", "clipboardRead", "clipboardWrite",
  "contentSettings", "contextMenus", "contextualIdentities", "cookies",
  "debugger", "declarativeNetRequest", "declarativeNetRequestFeedback",
  "declarativeNetRequestWithHostAccess", "devtools", "dns", "downloads",
  "downloads.open", "find", "geolocation", "history", "identity", "idle",
  "management", "menus", "menus.overrideContext", "nativeMessaging",
  "notifications", "pageCapture", "pkcs11", "privacy", "proxy", "publicSuffix",
  "scripting", "search", "sessions", "storage", "tabGroups", "tabHide", "tabs",
  "theme", "topSites", "unlimitedStorage", "userScripts", "webNavigation",
  "webRequest", "webRequestAuthProvider", "webRequestBlocking",
  "webRequestFilterResponse", "webRequestFilterResponse.serviceWorkerScript"
];

test("every documented Firefox permission has a reviewed rule", () => {
  const missing = DOCUMENTED_FIREFOX_PERMISSIONS.filter(
    (permission) => !Object.hasOwn(rules.permissions, permission)
  );

  assert.deepEqual(
    missing,
    [],
    `documented permissions with no reviewed rule: ${missing.join(", ")}`
  );
});

test("an unknown capability lands in the review queue", () => {
  // The classifier calling something "manual review required" while the
  // dashboard review queue ignores it is the contradiction this guards.
  const analysis = classifier.analyzeExtension(
    makeExtension({ permissions: ["someFutureCapability"] }),
    rules
  );

  assert.equal(analysis.level, "moderate");
  assert.equal(
    analysis.requiresReview,
    true,
    "a moderate finding that demands review must still reach the queue"
  );
});

test("an unrecognized host pattern lands in the review queue", () => {
  const analysis = classifier.analyzeExtension(
    makeExtension({ hostPermissions: ["not-a-pattern"] }),
    rules
  );

  assert.equal(analysis.requiresReview, true);
});

test("high and critical ratings still require review", () => {
  for (const permission of ["cookies", "nativeMessaging"]) {
    const analysis = classifier.analyzeExtension(
      makeExtension({ permissions: [permission] }),
      rules
    );
    assert.equal(analysis.requiresReview, true, permission);
  }
});

test("ordinary limited extensions do not require review", () => {
  const analysis = classifier.analyzeExtension(
    makeExtension({ permissions: ["storage", "notifications", "alarms"] }),
    rules
  );

  assert.equal(analysis.level, "limited");
  assert.equal(analysis.requiresReview, false);
});

test("snapshot freshness is bounded and rejects future timestamps", () => {
  const now = Date.parse("2026-07-30T12:00:00.000Z");
  const freshWindow = 5 * 60 * 1000;

  const oneMinuteAgo = new Date(now - 60 * 1000).toISOString();
  assert.equal(classifier.isSnapshotFresh(oneMinuteAgo, now), true);

  const tenMinutesAgo = new Date(now - 10 * 60 * 1000).toISOString();
  assert.equal(classifier.isSnapshotFresh(tenMinutesAgo, now), false);

  const exactlyAtLimit = new Date(now - freshWindow).toISOString();
  assert.equal(classifier.isSnapshotFresh(exactlyAtLimit, now), false);

  const future = new Date(now + 60 * 1000).toISOString();
  assert.equal(
    classifier.isSnapshotFresh(future, now),
    false,
    "a timestamp from the future means the clock moved"
  );

  for (const value of [null, undefined, "", "not-a-date", 12345]) {
    assert.equal(classifier.isSnapshotFresh(value, now), false, String(value));
  }
});
