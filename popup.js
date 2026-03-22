// Popup logic: shows totals, active toggle, exports, and last 5 collected items.

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('reddit_osint_db', 1);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAllItems() {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('items', 'readonly');
      const store = tx.objectStore('items');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    return [];
  }
}

function download(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function toCSV(rows) {
  const headers = [
    'type', 'url', 'title', 'author', 'subreddit', 'score', 'commentCount',
    'postId', 'timestamp', 'domain', 'postType', 'flairText', 'isNsfw',
    'postText', 'text', 'depth', 'thingId', 'pageContext', 'collectedAt'
  ];
  const csv = [headers.join(',')];
  for (const r of rows) {
    const vals = headers.map(h => {
      let v = r[h];
      if (Array.isArray(v)) v = v.join('|');
      if (v === null || typeof v === 'undefined') v = '';
      return '"' + String(v).replace(/"/g, '""') + '"';
    });
    csv.push(vals.join(','));
  }
  return csv.join('\n');
}

document.addEventListener('DOMContentLoaded', async () => {
  const totalEl = document.getElementById('total');
  const sessionBadge = document.getElementById('sessionBadge');
  const activeToggle = document.getElementById('activeToggle');
  const last5 = document.getElementById('last5');
  const statusEl = document.getElementById('status');

  function showStatus(msg, duration) {
    statusEl.textContent = msg;
    if (duration) setTimeout(() => { statusEl.textContent = ''; }, duration);
  }

  function refreshTotal() {
    chrome.storage.local.get({ totalCollected: 0, active: true }, (items) => {
      totalEl.textContent = items.totalCollected || 0;
      activeToggle.checked = !!items.active;
    });
    chrome.runtime.sendMessage({ type: 'getSessionCount' }, (resp) => {
      if (resp && typeof resp.sessionCount === 'number') {
        sessionBadge.textContent = 'session: ' + resp.sessionCount;
      }
    });
  }

  refreshTotal();

  activeToggle.addEventListener('change', () => {
    const active = activeToggle.checked;
    chrome.storage.local.set({ active });
    chrome.tabs.query({}, (tabs) => {
      for (const t of tabs) {
        chrome.tabs.sendMessage(t.id, { type: active ? 'resume' : 'pause' }, () => {
          if (chrome.runtime.lastError) { /* ignore errors for non-content-script tabs */ }
        });
      }
    });
    showStatus(active ? 'Collection resumed.' : 'Collection paused.', 2000);
  });

  document.getElementById('openOptions').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  document.getElementById('exportJson').addEventListener('click', async () => {
    const rows = await getAllItems();
    download('reddit_osint_items.json', JSON.stringify(rows, null, 2), 'application/json');
    showStatus('Exported ' + rows.length + ' items as JSON.', 2500);
  });

  document.getElementById('exportCsv').addEventListener('click', async () => {
    const rows = await getAllItems();
    const csv = toCSV(rows);
    download('reddit_osint_items.csv', csv, 'text/csv');
    showStatus('Exported ' + rows.length + ' items as CSV.', 2500);
  });

  document.getElementById('clearDb').addEventListener('click', async () => {
    if (!confirm('Clear all collected data? This cannot be undone.')) return;
    try {
      const db = await openDB();
      const tx = db.transaction('items', 'readwrite');
      tx.objectStore('items').clear();
      tx.oncomplete = () => {
        chrome.storage.local.set({ totalCollected: 0 });
        chrome.runtime.sendMessage({ type: 'resetSessionCount' });
        refreshTotal();
        last5.innerHTML = '';
        showStatus('Database cleared.', 2000);
      };
    } catch (e) {
      showStatus('Error clearing database.', 2000);
    }
  });

  // Show last 5 collected items
  try {
    const rows = await getAllItems();
    rows.sort((a, b) => new Date(b.collectedAt) - new Date(a.collectedAt));
    const top = rows.slice(0, 5);
    last5.innerHTML = '';
    if (top.length === 0) {
      last5.innerHTML = '<div style="color:#888;font-size:12px;">No items collected yet.</div>';
      return;
    }
    for (const r of top) {
      const d = document.createElement('div');
      d.className = 'item-preview';
      const time = r.collectedAt ? new Date(r.collectedAt).toLocaleString() : '';
      const label = r.type === 'comment' ? '💬 comment' : '📝 post';
      const sub = r.subreddit || '';
      const author = r.author || '';
      const displayText = r.title || r.text || '';
      const truncated = displayText.length > 80 ? displayText.slice(0, 80) + '…' : displayText;
      d.innerHTML =
        '<div class="meta">' + label + (sub ? ' · ' + sub : '') + (author ? ' · ' + author : '') +
        (time ? ' · ' + time : '') + '</div>' +
        '<div class="text">' + truncated.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</div>';
      last5.appendChild(d);
    }
  } catch (e) {
    last5.textContent = 'Could not load items.';
  }
});
