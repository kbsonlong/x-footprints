/* The popup reads storage directly and delegates all writes to the background. */
const api = typeof browser !== 'undefined' ? browser : chrome;
const $ = id => document.getElementById(id);
let records = [];
let settings = { paused: false, limit: 2000 };
const isTabView = new URLSearchParams(location.search).get('view') === 'tab';
const configFields = { syncConfig: ['endpoint', 'bucket', 'region', 'objectKey', 'accessKey', 'secretKey'], aiConfig: ['endpoint', 'model', 'apiKey'] };
const configPrefix = { syncConfig: 's3', aiConfig: 'ai' };
api.storage.local.get(['syncConfig', 'aiConfig']).then(state => {
  for (const [key, fields] of Object.entries(configFields)) for (const field of fields) $(configPrefix[key] + '-' + field).value = state[key]?.[field] || '';
  $('s3-autoSync').checked = state.syncConfig?.autoSync === true;
}).catch(error => setStatus(`Could not load settings: ${error.message || error}`));
function showSyncStatus(status) {
  $('sync-status').textContent = status?.error ? `自动同步失败：${status.error}` : status?.lastSuccess ? `上次同步：${new Date(status.lastSuccess).toLocaleString()}` : '';
}
api.storage.local.get('syncStatus').then(state => showSyncStatus(state.syncStatus)).catch(() => {});
api.runtime.sendMessage({ type: 'sync-if-enabled' }).then(response => {
  if (!response?.ok) showSyncStatus({ error: response?.error || '同步失败' });
}).catch(error => showSyncStatus({ error: String(error.message || error) }));
for (const [button, key] of [['save-s3', 'syncConfig'], ['save-ai', 'aiConfig']]) {
  $(button).addEventListener('click', async () => {
    const value = Object.fromEntries(configFields[key].map(field => [field, $(configPrefix[key] + '-' + field).value.trim()]));
    if (key === 'syncConfig') value.autoSync = $('s3-autoSync').checked;
    if (await mutate({ type: 'config', key, value })) setStatus('设置已保存。');
  });
}
$('sync').addEventListener('click', async event => {
  event.currentTarget.disabled = true;
  try { if (await mutate({ type: 'sync' })) setStatus('同步完成。'); } finally { event.currentTarget.disabled = false; }
});
$('summarize').addEventListener('click', async event => {
  event.currentTarget.disabled = true;
  try {
    setStatus('');
    const response = await api.runtime.sendMessage({ type: 'summarize', records: filteredRecords().slice(0, 100) });
    if (!response?.ok) throw new Error(response?.error || 'No response from extension');
    $('ai-result').textContent = response.summary;
  } catch (error) { setStatus(`总结失败：${error.message || error}`); }
  finally { event.currentTarget.disabled = false; }
});
document.documentElement.classList.toggle('tab-view', isTabView);
$('open-tab').hidden = isTabView;
$('open-tab').addEventListener('click', async () => {
  try {
    await api.tabs.create({ url: `${api.runtime.getURL('popup.html')}?view=tab`, active: true });
  } catch (error) {
    setStatus(`Could not open management tab: ${error.message || error}`);
  }
});

function setStatus(message = '') { $('status').textContent = message; }
function timeOf(record) {
  const value = record.visitedAt;
  const time = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}
function filteredRecords() {
  const query = $('search').value.trim().toLocaleLowerCase();
  const period = $('period').value;
  const now = new Date();
  let start = null;
  let end = null;
  if (period === 'today' || period === 'week') {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (period === 'week') start.setDate(start.getDate() - 6);
    end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  } else if (period === 'custom') {
    const from = $('from').value;
    const to = $('to').value;
    if (from) start = new Date(`${from}T00:00:00`);
    if (to) { end = new Date(`${to}T00:00:00`); end.setDate(end.getDate() + 1); }
  }
  const invalidRange = $('period').value === 'custom' && $('from').value && $('to').value && $('from').value > $('to').value;
  if (invalidRange) { setStatus('Start date must be on or before end date.'); return []; }
  if ($('status').textContent === 'Start date must be on or before end date.') setStatus();
  return records.filter(record => {
    const text = `${record.author || ''} ${record.text || ''}`.toLocaleLowerCase();
    const time = timeOf(record);
    return (!query || text.includes(query)) && (!start || time >= start.getTime()) && (!end || time < end.getTime());
  }).sort ( (a, b) => timeOf(b) - timeOf(a));
}
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function safeUrl(value) {
  try {
    const url = new URL(value);
    if ((url.protocol === 'https:' || url.protocol === 'http:') && /^(?:www\.|mobile\.)?(?:x\.com|twitter\.com)$/i.test(url.hostname)) return url.href;
  } catch (_) { /* Invalid URLs are displayed without a link. */ }
  return null;
}
function render() {
  const shown = filteredRecords();
  $('paused').checked = settings.paused === true;
  $('limit').value = settings.limit;
  $('dates').hidden = $('period').value !== 'custom';
  $('count').textContent = `${shown.length} shown · ${records.length} saved`;
  $('storage').textContent = `Approx. ${formatBytes(new Blob([JSON.stringify({ records, settings })]).size)}`;
  $('empty').hidden = shown.length > 0;
  $('clear').disabled = records.length === 0;
  $('export-json').disabled = shown.length === 0;
  $('export-csv').disabled = shown.length === 0;
  const list = $('records');
  list.replaceChildren();
  for (const record of shown) {
    const item = document.createElement('li');
    item.className = 'record';
    const header = document.createElement('div');
    header.className = 'record-head';
    const details = document.createElement('div');
    const author = document.createElement('div');
    author.className = 'record-author';
    author.textContent = record.author || 'Unknown author';
    const date = document.createElement('div');
    date.className = 'record-time';
    const time = timeOf(record);
    date.textContent = time ? new Date(time).toLocaleString() : 'Unknown date';
    details.append(author, date);
    header.append(details);
    const text = document.createElement('p');
    text.className = 'record-text';
    text.textContent = Array.from(record.text || record.title || 'No text available').slice(0, 100).join('');
    const actions = document.createElement('div');
    actions.className = 'record-actions';
    const link = document.createElement('span');
    const url = safeUrl(record.url);
    if (url) {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.textContent = 'Open post';
      link.append(anchor);
    }
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'danger';
    remove.textContent = 'Delete';
    remove.setAttribute('aria-label', `Delete record by ${record.author || 'unknown author'}`);
    remove.addEventListener('click', () => mutate({ type: 'delete', id: record.id }));
    actions.append(link, remove);
    item.append(header, text, actions);
    list.append(item);
  }
}
function applyState(state) {
  if (Array.isArray(state.records)) records = state.records.filter(record => record && typeof record === 'object');
  if (state.settings && typeof state.settings === 'object') settings = { ...settings, ...state.settings };
  render();
}
async function mutate(message) {
  try {
    setStatus();
    const response = await api.runtime.sendMessage(message);
    if (!response || response.ok === false) throw new Error(response?.error || 'No response from extension');
    applyState(response);
    return true;
  } catch (error) {
    setStatus(`Could not save change: ${error.message || error}`);
    render();
    return false;
  }
}
function download(content, type, filename) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function csvCell(value) {
  const text = String(value ?? '');
  // Prevent spreadsheet programs from treating exported content as a formula.
  const safe = /^[\s\u0000-\u001f]*[=+@-]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}
$('search').addEventListener('input', render);
for (const id of ['period', 'from', 'to']) $(id).addEventListener('change', render);
$('paused').addEventListener('change', event => mutate({ type: 'settings', settings: { paused: event.target.checked } }));
$('limit').addEventListener('change', event => {
  const limit = Number(event.target.value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 2000) { setStatus('Record limit must be between 1 and 2000.'); render(); return; }
  mutate({ type: 'settings', settings: { limit } });
});
$('clear').addEventListener('click', () => { $('confirm-clear').hidden = false; });
$('cancel-delete').addEventListener('click', () => { $('confirm-clear').hidden = true; });
$('confirm-delete').addEventListener('click', async () => { if (await mutate({ type: 'clear' })) $('confirm-clear').hidden = true; });
$('export-json').addEventListener('click', () => download(JSON.stringify(filteredRecords(), null, 2), 'application/json;charset=utf-8', 'x-footprints.json'));
$('export-csv').addEventListener('click', () => {
  const fields = ['id', 'firstVisitedAt', 'visitedAt', 'author', 'text', 'title', 'url'];
  const rows = [fields.map(csvCell).join(','), ...filteredRecords().map(record => fields.map(field => csvCell(record[field])).join(','))];
  download('\ufeff' + rows.join('\r\n'), 'text/csv;charset=utf-8', 'x-footprints.csv');
});
api.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.syncStatus) showSyncStatus(changes.syncStatus.newValue);
  const state = {};
  if (changes.records) state.records = changes.records.newValue || [];
  if (changes.settings) state.settings = changes.settings.newValue || { paused: false, limit: 2000 };
  applyState(state);
});
api.storage.local.get(['records', 'settings']).then(applyState).catch(error => setStatus(`Could not load records: ${error.message || error}`));
