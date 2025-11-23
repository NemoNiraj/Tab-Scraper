function render(data) {
  if (!data) return;
  const urlEl = document.getElementById('url');
  const titleEl = document.getElementById('title');
  const contactsEl = document.getElementById('contacts');
  const textPre = document.getElementById('text');

  if (urlEl) urlEl.textContent = data.url || '';
  if (titleEl) titleEl.textContent = data.title || '';

  // Extract numeric id from title (e.g. "00537006 | Case | Salesforce")
  const titleNumMatch = (data && data.title) ? String(data.title).match(/\b([0-9]{6,})\b/) : null;
  const titleNumber = titleNumMatch ? titleNumMatch[1] : '';

  if (contactsEl) {
    contactsEl.innerHTML = '';
    // Prefer extracting Customer Account and Actions from the textual body for stability
    const bodyText = (data && data.text) ? data.text : '';

    function extractCustomerFromText(t) {
      if (!t) return '';
      // Try common inline label: "Customer Account: <value>" stopping before other labels
      let m = t.match(/Customer Account\s*:\s*([\s\S]*?)(?=\r?\n(?:Subject:|Priority:|Actions for|Show Actions|Show more actions|Case\b)|$)/i);
      if (m && m[1]) return m[1].trim().replace(/\s*\(.*\)\s*$/,'').replace(/\r?\n/g,' ').trim();
      // fallback: look for "Account Name:" label
      m = t.match(/Account Name\s*:\s*([\s\S]*?)(?=\r?\n(?:Subject:|Priority:|Actions for|Show Actions|Case\b)|$)/i);
      if (m && m[1]) return m[1].trim().replace(/\s*\(.*\)\s*$/,'').replace(/\r?\n/g,' ').trim();
      // final fallback: look for 'Customer Account' followed by newline then value
      m = t.match(/Customer Account\s*\r?\n\s*([^-\r\n][^\r\n]{1,500})/i);
      if (m && m[1]) return m[1].trim().replace(/\s*\(.*\)\s*$/,'').trim();
      return '';
    }

    function extractActionsFromText(t) {
      const out = new Set();
      if (!t) return Array.from(out);
      // Actions for <id> (prefer 6+ digit IDs)
      const rx = /Actions for\s+([0-9]{6,})/ig;
      let mm;
      while ((mm = rx.exec(t)) !== null) {
        out.add(mm[1]);
      }
      // Also capture 'Case Number' lines
      const rx2 = /Case Number\s*[:\n]\s*([0-9]{6,})/ig;
      while ((mm = rx2.exec(t)) !== null) out.add(mm[1]);
      // Also capture standalone 6+ digit tokens that appear on lines starting with 'Actions for' or 'Show Actions'
      const lines = t.split(/\r?\n/);
      for (const line of lines) {
        if (/Actions for|Show Actions|Show actions|Open\s+[0-9]{6,}/i.test(line)) {
          const m2 = line.match(/([0-9]{6,})/);
          if (m2) out.add(m2[1]);
        }
      }
      return Array.from(out);
    }

    const customerAccount = extractCustomerFromText(bodyText) || (data.customerAccount || '');
    const actionsFor = (extractActionsFromText(bodyText).length) ? extractActionsFromText(bodyText) : ((data.actionsFor && Array.isArray(data.actionsFor)) ? data.actionsFor : []);

    if (titleNumber) {
      const caseRow = document.createElement('div');
      caseRow.style.display = 'flex';
      caseRow.style.alignItems = 'center';
      const caseSpan = document.createElement('span');
      caseSpan.textContent = 'Case: ' + titleNumber;
      caseSpan.style.flex = '1';
      const copyBtn = document.createElement('button');
      copyBtn.textContent = 'Copy';
      copyBtn.style.marginLeft = '8px';
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(titleNumber);
          copyBtn.textContent = 'Copied';
          setTimeout(() => (copyBtn.textContent = 'Copy'), 1400);
        } catch (err) {
          alert('Copy failed: ' + String(err));
        }
      });
      caseRow.appendChild(caseSpan);
      caseRow.appendChild(copyBtn);
      contactsEl.appendChild(caseRow);
    }
    if (customerAccount) contactsEl.appendChild(Object.assign(document.createElement('div'), { textContent: 'Customer Account: ' + customerAccount }));
    if (actionsFor.length) contactsEl.appendChild(Object.assign(document.createElement('div'), { textContent: 'Actions for: ' + actionsFor.join(', ') }));
    if (!contactsEl.childNodes.length) contactsEl.appendChild(Object.assign(document.createElement('div'), { textContent: 'No contact details' }));
  }

  if (textPre) textPre.textContent = data.text || '';
}

async function loadLast() {
  // Try to perform a live scrape on the active tab only if it's the allowed host.
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs && tabs[0] ? tabs[0] : null;
    if (tab && tab.url && tab.url.startsWith('https://onitinc.lightning.force.com/')) {
      // attempt live scrape; doScrape will store and render when successful
      await doScrape(tab.id);
      return;
    }
  } catch (err) {
    console.warn('live scrape check failed, falling back to stored lastScrape', err);
  }

  const s = await chrome.storage.local.get('lastScrape');
  render(s.lastScrape);
}

async function doScrape(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const title = document.title || '';
        const url = location.href || '';
        const text = document.body ? document.body.innerText : '';
        const html = document.documentElement ? document.documentElement.outerHTML : '';
        const ts = Date.now();

        // Limit scraping to `.records-record-layout-section` elements when present
        const sections = Array.from(document.querySelectorAll('.records-record-layout-section'));
        const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig;
        const emails = new Set();
        const actionsFor = new Set();

        let name = '';
        let accountName = '';
        let customerAccount = '';

        function textOf(el) { return el && el.textContent ? el.textContent.trim() : ''; }

        function tryExtractFromContainer(container) {
          if (!container) return;

          // gather emails from anchors and visible text
          for (const a of Array.from(container.querySelectorAll('a[href]'))) {
            const href = a.getAttribute('href') || '';
            if (href.toLowerCase().startsWith('mailto:')) {
              const e = href.replace(/^mailto:/i, '').split('?')[0];
              if (e) emails.add(e.trim());
            }
            const txt = a.textContent || '';
            let m;
            while ((m = emailRegex.exec(txt)) !== null) emails.add(m[0]);
          }

          // find "Actions for ..." lines anywhere in the container
          for (const n of Array.from(container.querySelectorAll('*'))) {
            const t = (n.textContent || '').trim();
            if (!t) continue;
            const m = t.match(/Actions for\s+(.+)/i);
            if (m && m[1]) {
              // normalize: stop at newline, then prefer numeric case id if present
              const entry = m[1].split(/\r?\n/)[0].trim();
              if (entry) {
                  // prefer IDs with at least 6 digits to avoid matching years
                  const idMatch = entry.match(/\b(\d{6,})\b/);
                  if (idMatch) actionsFor.add(idMatch[1]);
                  else {
                    // as a last resort, take the first token but keep it short
                    const tok = entry.split(/[\s|,]+/)[0];
                    if (tok && tok.length <= 20) actionsFor.add(tok);
                  }
              }
            }
          }

          // look for label/value patterns inside the container
          const candidates = Array.from(container.querySelectorAll('span,div,label,dt,dd'))
            .map(el => ({ el, t: textOf(el) }))
            .filter(x => x.t && x.t.length < 200);

          for (const c of candidates) {
            const t = c.t;
            // Name
            if (!name && /(^|\b)(Name|Full Name|Contact Name)\b[:]?/i.test(t)) {
              // try sibling
              const next = c.el.nextElementSibling;
              if (next && textOf(next)) { name = textOf(next); continue; }
              // fallback: strip label
              name = t.replace(/(^|\b)(Name|Full Name|Contact Name)\b[:]?/i, '').trim();
              if (name) continue;
            }

            // Account Name
            if (!accountName && /(^|\b)(Account Name|Account)\b[:]?/i.test(t)) {
              const next = c.el.nextElementSibling;
              if (next && textOf(next)) { accountName = textOf(next); continue; }
              accountName = t.replace(/(^|\b)(Account Name|Account)\b[:]?/i, '').trim();
              if (accountName) continue;
            }

            // Customer Account explicit label
            if (!customerAccount && /(^|\b)Customer Account\b[:]?/i.test(t)) {
              const next = c.el.nextElementSibling;
              if (next && textOf(next)) { customerAccount = textOf(next); customerAccount = customerAccount.replace(/\s*\(.*\)\s*$/,'').trim(); continue; }
              customerAccount = t.replace(/(^|\b)Customer Account\b[:]?/i, '').trim();
              customerAccount = customerAccount.replace(/\s*\(.*\)\s*$/,'').trim();
              // truncate at other known labels to avoid capturing Subject/Priority/etc.
              customerAccount = customerAccount.split(/Subject:|Priority:|Actions for|Show Actions|Show more actions|Case\b/i)[0].trim();
              if (customerAccount) continue;
            }

            // Also try to capture linked account names or anchor text near known data attrs
            if (!accountName) {
              const special = c.el.querySelector('[data-target-selection-name="sfdc:RecordField.Contact.AccountId"]');
              if (special) {
                const a = special.querySelector('a');
                const txt = textOf(a) || textOf(special);
                if (txt) accountName = txt.replace(/Account Name\s*:?/i, '').trim();
              }
            }
          }
        }

        if (sections.length) {
          for (const sec of sections) {
            tryExtractFromContainer(sec);
            if (name && accountName && customerAccount) break;
          }
        } else {
          // fallback: try whole document
          tryExtractFromContainer(document);
        }

        // Final cleanup: prefer first found customerAccount, strip parentheticals, and limit its length
        const finalCustomer = (customerAccount || '').replace(/\s*\(.*\)\s*$/,'').split(/\r?\n/)[0].trim().slice(0,300);
        return { title, url, text, html, ts, name: name || '', accountName: accountName || '', customerAccount: finalCustomer || '', actionsFor: Array.from(actionsFor), contacts: { emails: Array.from(emails) } };
      }
    });
    if (results && results[0] && results[0].result) {
      const data = results[0].result;
      await chrome.storage.local.set({ lastScrape: data });
      render(data);
    }
  } catch (err) {
    console.error('popup scrape error', err);
    alert('Scrape failed: ' + String(err));
  }
}

document.getElementById('refresh').addEventListener('click', async () => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs && tabs[0] ? tabs[0] : null;
  if (!tab) return alert('No active tab found');
  if (!tab.url || !tab.url.startsWith('https://onitinc.lightning.force.com/')) {
    alert('Scraping is restricted to https://onitinc.lightning.force.com/ — showing last saved scrape.');
    const s = await chrome.storage.local.get('lastScrape');
    render(s.lastScrape);
    return;
  }
  await doScrape(tab.id);
});

document.getElementById('download').addEventListener('click', async () => {
  const s = await chrome.storage.local.get('lastScrape');
  const data = s.lastScrape;
  if (!data) return alert('No scraped data available');

  const blob = new Blob([data.html || data.text || ''], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (data.title || 'scraped') + '.html';
  a.click();
  URL.revokeObjectURL(url);
});

async function initPopup() {
  const toggleBtn = document.getElementById('toggleBody');
  const textPre = document.getElementById('text');

  function applyShow(show) {
    if (textPre) textPre.style.display = show ? '' : 'none';
    if (toggleBtn) toggleBtn.textContent = show ? 'Hide body' : 'Show body';
  }

  // read persisted preference
  try {
    const s = await chrome.storage.local.get('showBody');
    const show = (s && typeof s.showBody !== 'undefined') ? s.showBody : true;
    applyShow(show);
  } catch (err) {
    applyShow(true);
  }

  if (toggleBtn) {
    toggleBtn.addEventListener('click', async () => {
      try {
        const s = await chrome.storage.local.get('showBody');
        const cur = (s && typeof s.showBody !== 'undefined') ? s.showBody : true;
        const next = !cur;
        await chrome.storage.local.set({ showBody: next });
        applyShow(next);
      } catch (err) {
        console.warn('toggleBody error', err);
      }
    });
  }

  await loadLast();
}

document.addEventListener('DOMContentLoaded', initPopup);