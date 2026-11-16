import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "release"))
import build_release as br  # noqa: E402

SCRIPT = """// ==UserScript==
// @name        demo
// @updateURL   https://old.example/demo.user.js
// @downloadURL https://old.example/demo.user.js
// @version     1.2
// ==/UserScript==

console.log('x');
"""


class BuildReleaseTest(unittest.TestCase):
    def test_urls_are_rewritten_to_base(self):
        user_js, meta_js, meta = br.build_script(SCRIPT, "demo.user.js", "https://h.example/userscripts")
        self.assertNotIn("old.example", user_js)
        self.assertIn("// @updateURL   https://h.example/userscripts/demo.meta.js", user_js)
        self.assertIn("// @downloadURL https://h.example/userscripts/demo.user.js", user_js)
        self.assertIn("console.log('x');", user_js)
        self.assertNotIn("console.log", meta_js)
        self.assertEqual(meta["version"], "1.2")

    def test_missing_header_is_an_error(self):
        with self.assertRaises(ValueError):
            br.build_script("console.log(1)\n", "x.user.js", "https://h.example")

    def test_real_scripts_build(self):
        files = br.build("https://h.example/userscripts")
        self.assertIn("index.html", files)
        self.assertIn("main_order_tax_cancellations_eval.user.js", files)
        self.assertIn("main_order_tax_cancellations_eval.meta.js", files)
        for name, content in files.items():
            if name.endswith(".js"):
                self.assertNotIn("raw.githubusercontent.com/hutauf/VineTaxTools", content.split("==/UserScript==")[0])

    def test_changed_script_needs_new_version(self):
        built, _, _ = br.build_script(SCRIPT, "demo.user.js", "https://h.example")
        files = {"demo.user.js": built}
        same = br.check_published(files, "https://h.example", fetcher=lambda url: built)
        self.assertEqual(same, [])
        nothing = br.check_published(files, "https://h.example", fetcher=lambda url: None)
        self.assertEqual(nothing, [])
        changed = br.check_published(files, "https://h.example", fetcher=lambda url: built.replace("'x'", "'y'"))
        self.assertEqual(len(changed), 1)
        self.assertIn("@version", changed[0])
        bumped = br.check_published(
            files, "https://h.example",
            fetcher=lambda url: built.replace("'x'", "'y'").replace("1.2", "1.1"),
        )
        self.assertEqual(bumped, [])

    def test_dev_build_points_hosted_backend_at_dev_api(self):
        dev = "https://dev.example:8443/vine-api/data_operations"
        prod_files = br.build("https://h.example/userscripts")
        dev_files = br.build("https://dev.example:8443/userscripts", backend_url=dev)
        name = "main_order_tax_cancellations_eval.user.js"
        self.assertIn("const VTT_HOSTED_BACKEND_URL = 'https://hutauf.org/vine-api/data_operations';", prod_files[name])
        self.assertIn(f"const VTT_HOSTED_BACKEND_URL = '{dev}';", dev_files[name])
        self.assertNotIn("hutauf.org/vine-api", dev_files[name])
        self.assertRegex(dev_files[name], r"(?m)^// @connect\s+dev\.example$")
        self.assertNotRegex(prod_files[name], r"(?m)^// @connect\s+dev\.")

    def test_backend_url_line_must_be_unique(self):
        with self.assertRaises(ValueError):
            br.set_backend_url("// ==UserScript==\n// ==/UserScript==\n", "x.user.js", "https://d.example/api")


if __name__ == "__main__":
    unittest.main()
