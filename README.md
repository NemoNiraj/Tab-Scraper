# Active Tab Scraper (Chrome Extension)

This simple Chrome extension watches the active tab and scrapes page content (title, URL, body text, and full HTML). It saves the latest scrape to extension storage and shows it in a popup where you can download it.

Installation (Developer mode - load unpacked):

1. Open `chrome://extensions/` in Chrome.
2. Enable **Developer mode** (top-right).
3. Click **Load unpacked** and select the folder you created containing `manifest.json`.
4. The extension will appear in the toolbar. Click it to open the popup.

Usage:

- The extension automatically scrapes whenever the active tab changes or finishes loading.
- Open the popup to view the last scraped data. Use **Refresh** to trigger a manual scrape for the current active tab. Use **Download** to save the page HTML.

Privacy & Security:

- This extension requests broad host permissions (`<all_urls>`) to be able to inject the scraper into whichever tab is active. Be cautious with the data it scrapes — it may include sensitive content.
- The scraped data is stored only in extension local storage. If you want automatic upload to a server, let me know and I can add a configurable webhook (with consent and opt-in steps).

Notes / Alternatives:

- If you prefer a script that attaches via Chrome's remote debugging protocol (without an extension), you can run Chrome with `--remote-debugging-port=9222` and use a Python/Node CDP client. I can provide that alternative if you want.


Feel Free to Fork it!