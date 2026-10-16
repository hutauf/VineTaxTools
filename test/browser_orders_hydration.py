"""Real browser regression; requires Playwright + Chromium and npm ci.

python test/browser_orders_hydration.py --output /tmp/vtt-hydration
Pass --baseline <previous-userscript> to reproduce the pre-fix failure as well.
All traffic is mocked; no Amazon account or real backend is contacted.
"""

import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--baseline", type=Path)
    parser.add_argument("--browser-channel")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    args.output.mkdir(parents=True, exist_ok=True)
    html = (root / "test/fixtures/orders-hydration.html").read_text(encoding="utf-8")
    results = {}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel=args.browser_channel, args=["--no-sandbox"])
        versions = {"after": root / "main_order_tax_cancellations_eval.user.js"}
        if args.baseline:
            versions = {"before": args.baseline, **versions}
        for name, source in versions.items():
            context = browser.new_context(
                viewport={"width": 430, "height": 1000},
                record_video_dir=str(args.output / name),
                record_video_size={"width": 430, "height": 1000},
            )
            page = context.new_page()
            page.route(
                "**/*",
                lambda route: (
                    route.fulfill(content_type="text/html", body=html)
                    if route.request.url == "https://www.amazon.de/vine/orders"
                    else route.abort()
                ),
            )
            page.goto("https://www.amazon.de/vine/orders")
            page.add_script_tag(path=str(root / "node_modules/dexie/dist/dexie.min.js"))
            page.evaluate("""() => {
                setTimeout(() => { for (let i=0; i<9; i++) window.__fillDate(i); }, 1000);
                setTimeout(() => window.__fillDate(9), 2500);
            }""")
            page.add_script_tag(path=str(source))
            page.locator("#load-orders-info").wait_for()
            if name == "after":
                # Simulate concurrent requests while Amazon's final date is still blank.
                page.evaluate("""() => {
                    window.__VINE_TAX_TOOLS_TEST_HOOK__.loadOrdersInfo();
                    window.__VINE_TAX_TOOLS_TEST_HOOK__.loadOrdersInfo();
                }""")
                assert page.locator("#load-orders-info").is_disabled()
            page.wait_for_function("() => window.__datesFilled === 9")
            interim = page.evaluate("""() => ({
                dates: window.__datesFilled, uploads: window.__fixtureRequests.length,
                alerts: window.__fixtureAlerts,
                state: document.getElementById('simpleProgressBarContainer').dataset.state
            })""")
            assert interim["uploads"] == 0, interim
            if name == "before":
                assert len(interim["alerts"]) == 1 and "10 Bestellung" in interim["alerts"][0], interim
            else:
                assert interim["alerts"] == [], interim
                assert interim["state"] != "success", interim
                page.screenshot(path=str(args.output / "waiting.png"), full_page=True)
            page.wait_for_function("() => window.__datesFilled === 10")
            page.wait_for_timeout(500)
            if name == "after":
                page.wait_for_function(
                    "() => document.getElementById('simpleProgressBarContainer').dataset.state === 'success'"
                )
                assert not page.locator("#load-orders-info").is_disabled()
            final = page.evaluate("""async () => ({
                dates: window.__datesFilled, uploads: window.__fixtureRequests.map(r => r.length),
                alerts: window.__fixtureAlerts, errors: window.__fixtureErrors,
                progress: document.getElementById('simpleProgressBarContainer').textContent,
                savedDate: JSON.parse(await window.__VINE_TAX_TOOLS_TEST_HOOK__.getValue('ASIN_B000000000', '{}')).date || null
            })""")
            if name == "after":
                assert final["uploads"] == [10] and not final["alerts"] and not final["errors"], final
                assert final["savedDate"] == "15/10/2026", final
            else:
                assert final["savedDate"] is None and final["uploads"] == [], final
            results[name] = {"while_last_date_missing": interim, "after_hydration": final}
            page.screenshot(path=str(args.output / f"{name}.png"), full_page=True)
            page.wait_for_timeout(1000)
            context.close()
        browser.close()
    (args.output / "results.json").write_text(
        json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(json.dumps(results, ensure_ascii=True))


if __name__ == "__main__":
    main()
