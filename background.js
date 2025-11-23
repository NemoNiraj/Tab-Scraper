let lastScrape = null;

async function scrapeTab(tabId) {
  try {
    // get tab info and ensure it's the target host before injecting script
    const tabs = await chrome.tabs.get(tabId).catch(() => null);
    const url = tabs && tabs.url ? tabs.url : '';
    if (!url || !url.startsWith('https://onitinc.lightning.force.com/')) return;
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const title = document.title || '';
        const url = location.href || '';
        const text = document.body ? document.body.innerText : '';
        const html = document.documentElement ? document.documentElement.outerHTML : '';
        return { title, url, text, html, ts: Date.now() };
      }
    });

    if (results && results[0] && results[0].result) {
      lastScrape = results[0].result;
      await chrome.storage.local.set({ lastScrape });
      chrome.runtime.sendMessage({ type: 'scraped', data: lastScrape });
    }
  } catch (err) {
    console.error('scrapeTab error', err);
  }
}

chrome.tabs.onActivated.addListener((activeInfo) => {
  scrapeTab(activeInfo.tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab && tab.active) {
    scrapeTab(tabId);
  }
});

chrome.runtime.onStartup.addListener(async () => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs && tabs[0]) scrapeTab(tabs[0].id);
});

chrome.runtime.onInstalled.addListener(async () => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs && tabs[0]) scrapeTab(tabs[0].id);
});