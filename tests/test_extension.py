import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EXTENSION = ROOT / "extension"
VALID_LEVELS = {"limited", "moderate", "high", "critical"}


def load_json(path):
    with path.open(encoding="utf-8") as file:
        return json.load(file)


class ManifestTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = load_json(EXTENSION / "manifest.json")

    def test_manifest_uses_v3_and_has_release_identity(self):
        self.assertEqual(self.manifest["manifest_version"], 3)
        self.assertRegex(
            self.manifest["browser_specific_settings"]["gecko"]["id"],
            r"^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+$",
        )
        self.assertEqual(
            self.manifest["browser_specific_settings"]["gecko"]["strict_min_version"],
            "140.0",
        )

    def test_manifest_and_package_versions_agree(self):
        """AMO signs whatever the manifest declares, so the packaged version and
        the npm version must not drift apart."""
        package = json.loads(
            (ROOT / "package.json").read_text(encoding="utf-8")
        )

        self.assertRegex(self.manifest["version"], r"^\d+\.\d+\.\d+$")
        self.assertEqual(self.manifest["version"], package["version"])

    def test_manifest_declares_no_data_collection(self):
        permissions = self.manifest["browser_specific_settings"]["gecko"][
            "data_collection_permissions"
        ]
        self.assertEqual(permissions, {"required": ["none"]})
        self.assertEqual(
            self.manifest["browser_specific_settings"]["gecko_android"][
                "strict_min_version"
            ],
            "142.0",
        )

    def test_extension_requests_only_expected_permissions(self):
        self.assertEqual(
            set(self.manifest["permissions"]),
            {"management", "storage", "notifications"},
        )
        self.assertNotIn("host_permissions", self.manifest)
        self.assertNotIn("content_scripts", self.manifest)

    def test_manifest_references_existing_files(self):
        referenced = [
            *self.manifest["icons"].values(),
            *self.manifest["background"]["scripts"],
            self.manifest["action"]["default_popup"],
            self.manifest["options_ui"]["page"],
        ]
        referenced.extend(self.manifest["action"]["default_icon"].values())

        for relative_path in referenced:
            with self.subTest(path=relative_path):
                self.assertTrue((EXTENSION / relative_path).is_file())


class RuleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.permissions = load_json(EXTENSION / "rules" / "permissions.json")
        cls.combinations = load_json(EXTENSION / "rules" / "combinations.json")

    def test_permission_rules_are_explainable(self):
        self.assertGreater(len(self.permissions), 10)
        for permission, rule in self.permissions.items():
            with self.subTest(permission=permission):
                self.assertIn(rule["level"], VALID_LEVELS)
                self.assertGreater(len(rule["title"]), 3)
                self.assertGreater(len(rule["explanation"]), 15)

    def test_combination_rules_are_unique_and_valid(self):
        identifiers = [rule["id"] for rule in self.combinations]
        self.assertEqual(len(identifiers), len(set(identifiers)))

        for rule in self.combinations:
            with self.subTest(rule=rule["id"]):
                self.assertIn(rule["level"], VALID_LEVELS)
                self.assertGreaterEqual(len(rule["requires"]), 2)
                for requirement in rule["requires"]:
                    self.assertRegex(requirement, r"^(permission|host):[A-Za-z0-9_]+$")


class SourceSafetyTests(unittest.TestCase):
    def test_html_uses_packaged_scripts_only(self):
        for path in EXTENSION.rglob("*.html"):
            source = path.read_text(encoding="utf-8")
            with self.subTest(path=path):
                self.assertNotRegex(source, r"<script(?![^>]*\bsrc=)")
                for script_path in re.findall(r'<script\s+src="([^"]+)"', source):
                    resolved = (path.parent / script_path).resolve()
                    self.assertTrue(resolved.is_file())
                    self.assertTrue(resolved.is_relative_to(EXTENSION.resolve()))

    def test_javascript_does_not_contact_remote_servers(self):
        for path in EXTENSION.rglob("*.js"):
            source = path.read_text(encoding="utf-8")
            with self.subTest(path=path):
                self.assertNotRegex(
                    source,
                    r"""(?:fetch|WebSocket|EventSource)\s*\(\s*["']https?://""",
                )
                self.assertNotRegex(
                    source,
                    r"""\.open\s*\(\s*["'][A-Z]+\s*["']\s*,\s*["']https?://""",
                )
                self.assertNotIn("eval(", source)
                self.assertNotIn(".innerHTML", source)

    def test_network_calls_use_only_packaged_extension_urls(self):
        """A literal https:// regex misses a dynamically built remote URL, so
        every network-capable call site is checked against an allowlist of
        argument shapes instead."""
        allowed_argument = re.compile(
            r"""^\s*(?:browser\.runtime\.getURL\(|["'](?:/|\.{1,2}/)?[A-Za-z0-9._/-]*["']\s*\))"""
        )
        network_call = re.compile(r"\b(?:fetch|WebSocket|EventSource|XMLHttpRequest)\s*\(")

        for path in EXTENSION.rglob("*.js"):
            source = path.read_text(encoding="utf-8")
            for match in network_call.finditer(source):
                argument = source[match.end():match.end() + 120]
                with self.subTest(path=path, call=match.group(0)):
                    self.assertRegex(
                        argument,
                        allowed_argument,
                        f"{match.group(0)} must load a packaged extension URL",
                    )

    def test_source_never_mutates_other_extensions(self):
        """Extension Watchdog reads the management API but must never change
        another add-on's state. The management permission also allows enabling,
        disabling, and installing, so all of those are forbidden too."""
        forbidden = [
            "management.uninstall",
            "management.setEnabled",
            "management.install",
            "management.uninstallSelf",
        ]

        for path in EXTENSION.rglob("*.js"):
            source = path.read_text(encoding="utf-8")
            for api in forbidden:
                with self.subTest(path=path, api=api):
                    self.assertNotIn(api, source)

    def test_management_usage_is_limited_to_read_and_events(self):
        allowed = {
            "getAll",
            "onInstalled",
            "onUninstalled",
            "onEnabled",
            "onDisabled",
        }

        for path in EXTENSION.rglob("*.js"):
            source = path.read_text(encoding="utf-8")
            for member in re.findall(r"management\.([A-Za-z]+)", source):
                with self.subTest(path=path, member=member):
                    self.assertIn(member, allowed)

    def test_rules_are_loaded_from_packaged_urls(self):
        background = (EXTENSION / "background" / "background.js").read_text(
            encoding="utf-8"
        )
        self.assertIn('browser.runtime.getURL("rules/permissions.json")', background)
        self.assertIn('browser.runtime.getURL("rules/combinations.json")', background)

    def test_runtime_urls_reference_packaged_files(self):
        """Notification and rule assets can live outside the manifest, so verify
        literal runtime URLs too instead of discovering a broken path at runtime."""
        for path in EXTENSION.rglob("*.js"):
            source = path.read_text(encoding="utf-8")
            for relative_path in re.findall(
                r'browser\.runtime\.getURL\("([^"]+)"\)', source
            ):
                with self.subTest(path=path, asset=relative_path):
                    self.assertTrue((EXTENSION / relative_path).is_file())


if __name__ == "__main__":
    unittest.main()
