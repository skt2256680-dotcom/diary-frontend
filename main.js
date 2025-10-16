import { createClient } from './supabase.js';

console.log('frontend build: v-upload-fix-1'); // ← 看 Console 就知道是不是新檔

const params = new URLSearchParams(location.search);
const diary = params.get('diary') || 'default-diary';

// Supabase
const supabase = createClient(window.ENV.SUPABASE_URL, window.ENV.SUPABASE_ANON_KEY);

// Buckets
const IMAGE_BUCKET = window.ENV.IMAGE_BUCKET || 'diary-images';
const VIDEO_BUCKET = window.ENV.VIDEO_BUCKET || 'diary-videos';

// UI
const recent = document.getElementById('recent');
const latestVideo = document.getElementById('latest-video');
const viewDay = document.getElementById('viewDay');
const viewText = document.getElementById('viewText');
const prevBtn = document.getElementById('prev');
const nextBtn = document.getElementById('next');
const form = document.getElementById('entry-form');

// ---- Prompts ----
let PROMPTS = [];
async function loadPrompts() {
  const r = await fetch('/prompts.json');
  const j = await r.json();
  PROMPTS = j.prompts || [];
}
function promptTextById(id) {
  const p = PROMPTS.find(x => x.id === id);
  return p ? p.text : null;
}

// ---- 下一個 Day（自動） ----
async function getNextDay(diaryId) {
  const { data, error } = await supabase
    .from('entries')
    .select('day_number')
    .eq('diary_id', diaryId)
    .not('day_number', 'is', null);
  if (error) {
    console.warn('getNextDay error', error);
    return 1;
  }
  const max = (data || []).reduce((m, r) => Math.max(m, r.day_number || 0), 0);
  return Math.min(151, max + 1);
}

// ---- Viewer（僅顯示；送出不靠它）----
let autoDay = 1;
function updateViewer() {
  if (!viewDay || !viewText) return;
  viewDay.textContent = String(autoDay);
  const t = (autoDay >= 1 && autoDay <= 151) ? promptTextById(autoDay) : null;
  viewText.textContent = t ? `「${t}」` : '（不顯示句子）';
}
function wireViewerNav() {
  if (prevBtn) prevBtn.addEventListener('click', () => {
    if (autoDay > 1) { autoDay--; updateViewer(); }
  });
  if (nextBtn) nextBtn.addEventListener('click', () => {
    if (autoDay < 151) { autoDay++; updateViewer(); }
  });
}

// ---- 最近列表 ----
async function loadRecent() {
  const { data, error } = await supabase
    .from('entries')
    .select('*')
    .eq('diary_id', diary)
    .order('date', { ascending: false })
    .limit(10);
  if (error) { console.error(error); return; }

  if (!recent) return;
  recent.innerHTML = (data || []).map(e => `
    <div class="item">
      ${e.prompt_text ? `<div class="muted">「${e.prompt_text}」</div>` : ''}
      <div><strong>${e.title || '（無標題）'}</strong></div>
      <div class="muted">
        ${e.date_label ? e.date_label + ' · ' : ''}
        ${e.day_label ? e.day_label + ' · ' : ''}
        ${e.author || ''} · ${e.mood || '🙂'}
      </div>
      <div>${(e.text || '').slice(0,120)}${(e.text || '').length > 120 ? '…' : ''}</div>
      ${e.image_url ? `<img class="thumb" src="${e.image_url}">` : ''}
    </div>
  `).join('');
}

// ---- 最新影片 ----
async function loadLatestVideo() {
  if (!latestVideo) return;
  const list = await supabase.storage.from(VIDEO_BUCKET).list(diary, {
    limit: 100, sortBy: { column: 'name', order: 'desc' }
  });
  if (!list.data?.length) { latestVideo.innerHTML = '<em>尚無影片</em>'; return; }
  const latest = list.data[0];
  const signed = await supabase.storage.from(VIDEO_BUCKET)
    .createSignedUrl(`${diary}/${latest.name}`, 86400);
  const url = signed.data?.signedUrl;
  if (url) latestVideo.innerHTML = `<video controls src="${url}"></video>`;
}

// ---- 表單送出（自動 Day + 固定標題 + 簽名可留白）----
if (form) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // 1) 圖片（可選）— 這裡是重點：帶 contentType + upsert
    let image_url = null;
    const img = document.getElementById('image');
    if (img?.files?.length) {
      const file = img.files[0];
      const path = `${diary}/${Date.now()}-${file.name}`;

      const up = await supabase.storage
        .from(IMAGE_BUCKET)
        .upload(path, file, { contentType: file.type || 'image/png', upsert: true });

      if (up.error) {
        alert('圖片上傳失敗：' + up.error.message);
        console.error(up.error);
        return;
      }

      const pub = await supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path);
      image_url = pub.data?.publicUrl || null;
    }

    // 2) 自動 Day 與導引句
    const inRange = autoDay >= 1 && autoDay <= 151;
    const prompt_text = inRange ? promptTextById(autoDay) : null;

    // 3) payload
    const payload = {
      diary_id: diary,
      date: new Date().toISOString().slice(0, 10),
      author: (document.getElementById('author')?.value?.trim() || null), // 簽名可留白
      title: '給妳的150天',                                            // 固定標題
      text: document.getElementById('text')?.value || '',
      mood: document.getElementById('mood')?.value || null,
      image_url,
      day_number: inRange ? autoDay : null,
      prompt_id: inRange ? autoDay : null,
      prompt_text,
      date_label: document.getElementById('dateLabel')?.value || null,
      day_label: document.getElementById('dayLabel')?.value || null
    };

    const { error } = await supabase.from('entries').insert(payload);
    if (error) { alert('送出失敗：' + error.message); return; }

    // 4) 下一篇自動 +1、清表單、重載列表
    autoDay = Math.min(151, autoDay + 1);
    updateViewer();

    if (document.getElementById('text')) document.getElementById('text').value = '';
    if (document.getElementById('image')) document.getElementById('image').value = '';
    alert('已儲存！本篇 Day ' + (payload.day_number ?? '—') + (payload.prompt_text ? '（已帶句子）' : '（無導引句）'));

    loadRecent();
  });
}

// ---- 初始化 ----
await loadPrompts();
autoDay = await getNextDay(diary);
wireViewerNav();
updateViewer();
await loadRecent();
await loadLatestVideo();

