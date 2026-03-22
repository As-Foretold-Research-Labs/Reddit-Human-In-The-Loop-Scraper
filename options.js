// Options page logic: save/load settings to chrome.storage.sync

const defaults = {
  webhookUrl: '',
  webhookEnabled: false,
  autoCollect: true,
  collectComments: true,
  contexts: ['home', 'subreddit', 'post', 'profile', 'search'],
  subredditFilter: '',
  userFilter: '',
  keywordFilter: '',
  notionEnabled: false,
  notionApiKey: '',
  notionDatabaseId: ''
};

function getFormValues() {
  const webhookUrl = document.getElementById('webhookUrl').value.trim();
  const webhookEnabled = document.getElementById('webhookEnabled').checked;
  const autoCollect = document.getElementById('autoCollect').checked;
  const collectComments = document.getElementById('collectComments').checked;
  const subredditFilter = document.getElementById('subredditFilter').value.trim();
  const userFilter = document.getElementById('userFilter').value.trim();
  const keywordFilter = document.getElementById('keywordFilter').value.trim();
  const notionEnabled = document.getElementById('notionEnabled').checked;
  const notionApiKey = document.getElementById('notionApiKey').value.trim();
  const notionDatabaseId = document.getElementById('notionDatabaseId').value.trim();
  const ctxEls = document.querySelectorAll('.ctx');
  const contexts = [];
  ctxEls.forEach(c => { if (c.checked) contexts.push(c.value); });
  return {
    webhookUrl, webhookEnabled, autoCollect, collectComments,
    subredditFilter, userFilter, keywordFilter, contexts,
    notionEnabled, notionApiKey, notionDatabaseId
  };
}

function setFormValues(cfg) {
  document.getElementById('webhookUrl').value = cfg.webhookUrl || '';
  document.getElementById('webhookEnabled').checked = !!cfg.webhookEnabled;
  document.getElementById('autoCollect').checked =
    typeof cfg.autoCollect === 'undefined' ? true : !!cfg.autoCollect;
  document.getElementById('collectComments').checked =
    typeof cfg.collectComments === 'undefined' ? true : !!cfg.collectComments;
  document.getElementById('subredditFilter').value = cfg.subredditFilter || '';
  document.getElementById('userFilter').value = cfg.userFilter || '';
  document.getElementById('keywordFilter').value = cfg.keywordFilter || '';
  document.getElementById('notionEnabled').checked = !!cfg.notionEnabled;
  document.getElementById('notionApiKey').value = cfg.notionApiKey || '';
  document.getElementById('notionDatabaseId').value = cfg.notionDatabaseId || '';
  const ctxEls = document.querySelectorAll('.ctx');
  ctxEls.forEach(c => { c.checked = (cfg.contexts || []).includes(c.value); });
  toggleNotionSection(!!cfg.notionEnabled);
}

function toggleNotionSection(enabled) {
  const section = document.getElementById('notionSection');
  if (section) {
    section.classList.toggle('visible', enabled);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const statusEl = document.getElementById('status');

  function showStatus(msg, duration) {
    statusEl.textContent = msg;
    if (duration) setTimeout(() => { statusEl.textContent = ''; }, duration);
  }

  document.getElementById('notionEnabled').addEventListener('change', (e) => {
    toggleNotionSection(e.target.checked);
  });

  document.getElementById('save').addEventListener('click', () => {
    const cfg = getFormValues();
    chrome.storage.sync.set(cfg, () => {
      showStatus('Settings saved.', 2000);
    });
  });

  document.getElementById('restore').addEventListener('click', () => {
    setFormValues(defaults);
    chrome.storage.sync.set(defaults, () => {
      showStatus('Restored defaults.', 2000);
    });
  });

  // Load saved settings
  chrome.storage.sync.get(defaults, (items) => {
    setFormValues(items);
  });
});
