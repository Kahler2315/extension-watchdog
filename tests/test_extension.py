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

    def test_manifest_declares_no_data_collection(self):
        permissions = self.manifest["browser_specific_settings"]["gecko"][
            "data_collection_permissions"
        ]
        self.assertEqual(permissions, {"required": ["none"]})

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

    def test_rules_are_loaded_from_packaged_urls(self):
        background = (EXTENSION / "background" / "background.js").read_text(
            encoding="utf-8"
        )
        self.assertIn('browser.runtime.getURL("rules/permissions.json")', background)
        self.assertIn('browser.runtime.getURL("rules/combinations.json")', background)


if __name__ == "__main__":
    unittest.main()
