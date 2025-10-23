import { createClient } from './supabase.js';

const MAX_DAY = 131;
console.log('frontend build: v-softcard-anim');

const params = new URLSearchParams(location.search);
const diary = params.get('diary') || 'default-diary';
const supabase = createClient(window.ENV.SUPABASE_URL, window.ENV.SUPABASE_ANON_KEY);

const IMAGE_BUCKET = window.ENV.IMAGE_BUCKET || 'diary-images';
const VIDEO_BUCKET = window.ENV.VIDEO_BUCKET || 'diary-videos';

const latestVideo = document.getElementById('latest-video');
const viewDay = document.getElementById('viewDay');
const viewText = document.getElementById('viewText');
const prevBtn = document.getElementById('prev');
const nextBtn = document.getElementById('next');
const jumpDayInput = document.getElementById('jumpDay');
const form = document.getElementById('entry-form');
const ePrev = document.getElementById('ePrev');
const eNext = document.getElementById('eNext');
const eCursor = document.getElementById('eCursor');
const eTotal = document.getElementById('eTotal');
const eJump = document.getElementById('eJump');
const entryView = document.getElementById('entryView');

let PROMPTS = [];
async function loadPrompts() {
  try {
    const r = await fetch('/prompts.json');
    const j = await r.json();
    PROMPTS = j.prompts || [];
  } catch {
    PROMPTS = [];
  }
}
function promptTextById(id) {
  const p = PROMPTS.find(x => x.id === id);
  return p ? p.text : null;
}

async function getNextDay(diaryId) {
  const { data, error } = await supabase.from('entries').select('day_number').eq('diary_id', diaryId);
  if (error) return 1;
  const max = (data || []).reduce((m, r) => Math.max(m, r.day_number || 0), 0);
  return Math.min(MAX_DAY, max + 1);
}

let autoDay = 1;
const clampDay = n => Math.max(1, Math.min(MAX_DAY, Math.trunc(Number(n) || 1)));

function updateViewer() {
  if (!viewDay || !viewText) return;
  viewDay.textContent = String(autoDay);
  if (jumpDayInput) jumpDayInput.value = String(autoDay);
  const t = (autoDay >= 1 && autoDay <= MAX_DAY) ? promptTextById(autoDay) : null;
  viewText.textContent = t ? `「${t}」` : '（不顯示句子）';
  if (prevBtn) prevBtn.disabled = (autoDay <= 1);
  if (nextBtn) nextBtn.disabled = (autoDay >= MAX_DAY);
}

function wireViewerNav() {
  if (prevBtn) prevBtn.onclick = ()=>{ if (autoDay>1){ autoDay--; updateViewer(); } };
  if (nextBtn) nextBtn.onclick = ()=>{ if (autoDay<MAX_DAY){ autoDay++; updateViewer(); } };
  if (jumpDayInput) {
    const go=()=>{ autoDay = clampDay(jumpDayInput.value); updateViewer(); };
    jumpDayInput.addEventListener('change', go);
    jumpDayInput.addEventListener('keyup', e=>{ if(e.key==='Enter') go(); });
  }
}

function extractPathFromPublicUrl(url){
  if (!url) return null;
  const m = url.match(/\/object\/public\/([^/]+)\/(.+)$/);
  if (!m) return null;
  const [, bucket, path] = m;
  if (bucket !== IMAGE_BUCKET) return null;
  return path;
}

async function deleteEntryAndAssets(id, image_path, image_url){
  const path = image_path || extractPathFromPublicUrl(image_url || '');
  if (path){
    await supabase.storage.from(IMAGE_BUCKET).remove([path]);
  }
  await supabase.from('entries').delete().eq('id', id);
}

// 🩵 柔光滑入動畫
function playEntryAnim() {
  if (!entryView) return;
  entryView.classList.remove('entry-anim');
  void entryView.offsetWidth;
  entryView.classList.add('entry-anim');
}

let ENTRIES = [];
let idx = 0;

function renderEntry() {
  if (!entryView) return;
  if (!ENTRIES.length) {
    entryView.innerHTML = '<em class="muted">目前還沒有日記</em>';
    if (eTotal)  eTotal.textContent  = '0';
    if (eCursor) eCursor.textContent = '0';
    return;
  }

  const e = ENTRIES[idx];
  if (eTotal)  eTotal.textContent  = String(ENTRIES.length);
  if (eCursor) eCursor.textContent = String(idx + 1);
  if (eJump)   eJump.value = String(idx + 1);

  entryView.innerHTML = `
    <div class="soft-card">
      ${e.prompt_text ? `<div class="soft-quote">「${e.prompt_text}」</div>` : ''}
      <div class="soft-meta">🕊️ Day ${e.day_number || '?'} · ${e.date_label || e.date || ''} ${e.mood || '🙂'}</div>
      <div class="soft-text">${(e.text || '').replace(/</g,'&lt;')}</div>
      ${e.image_url ? `<img class="soft-img" src="${e.image_url}" alt="">` : ''}
      <div class="actions"><button class="soft-delete" id="deleteEntryBtn">刪除這篇日記</button></div>
    </div>
  `;
  playEntryAnim();

  const delBtn = document.getElementById('deleteEntryBtn');
  if (delBtn) {
    delBtn.onclick = async () => {
      if (!confirm('確定要刪除這篇日記嗎？')) return;
      await deleteEntryAndAssets(e.id, e.image_path, e.image_url);
      ENTRIES.splice(idx, 1);
      if (idx >= ENTRIES.length) idx = Math.max(0, ENTRIES.length - 1);
      renderEntry();
    };
  }
}

async function loadEntries() {
  const { data } = await supabase
    .from('entries')
    .select('*')
    .eq('diary_id', diary)
    .order('day_number', { ascending: true });
  ENTRIES = data || [];
  idx = Math.max(0, ENTRIES.length - 1);
  renderEntry();
}

function wireEntryPager() {
  if (ePrev) ePrev.onclick = () => { if (idx > 0) { idx--; renderEntry(); } };
  if (eNext) eNext.onclick = () => { if (idx < ENTRIES.length - 1) { idx++; renderEntry(); } };
  if (eJump) {
    const go = () => {
      const n = Math.trunc(Number(eJump.value) || 1);
      if (!ENTRIES.length) return;
      idx = Math.min(Math.max(n, 1), ENTRIES.length) - 1;
      renderEntry();
    };
    eJump.addEventListener('change', go);
    eJump.addEventListener('keyup', e => { if (e.key === 'Enter') go(); });
  }
}

async function loadLatestVideo(){
  if (!latestVideo) return;
  const list = await supabase.storage.from(VIDEO_BUCKET)
    .list(diary, { limit:100, sortBy:{column:'name', order:'desc'} });
  if (!list.data?.length){
    latestVideo.innerHTML = '<em>尚無影片</em>';
    return;
  }
  const latest = list.data[0];
  const signed = await supabase.storage.from(VIDEO_BUCKET)
    .createSignedUrl(`${diary}/${latest.name}`, 86400);
  const url = signed.data?.signedUrl;
  if (url)
    latestVideo.innerHTML = `<video controls src="${url}" style="max-width:100%;border-radius:12px;"></video>`;
}

function buildSafePath(dir, file){
  const ext = (file.name.split('.').pop() || 'png').toLowerCase();
  const safeName = `${Date.now()}.${ext}`;
  return `${dir}/${safeName}`;
}

function wireForm(){
  if (!form) return;
  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const inRange = autoDay >= 1 && autoDay <= MAX_DAY;
    if (!inRange) return alert(`已經是最後一頁了（Day ${MAX_DAY}）`);

    let image_url = null;
    let image_path = null;
    const img = document.getElementById('image');
    if (img?.files?.length){
      const file = img.files[0];
      const path = buildSafePath(diary, file);
      const up = await supabase.storage.from(IMAGE_BUCKET).upload(path, file, { upsert: true });
      if (up.error){ alert('圖片上傳失敗'); return; }
      const pub = await supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path);
      image_url  = pub.data?.publicUrl || null;
      image_path = path;
    }

    const prompt_text = promptTextById(autoDay);
    const payload = {
      diary_id: diary,
      date: new Date().toISOString().slice(0,10),
      author: document.getElementById('author')?.value || null,
      title: '倒數131天日記',
      text: document.getElementById('text')?.value || '',
      mood: document.getElementById('mood')?.value || null,
      image_url,
      image_path,
      day_number: autoDay,
      prompt_id: autoDay,
      prompt_text,
      date_label: document.getElementById('dateLabel')?.value || null,
      day_label: document.getElementById('dayLabel')?.value || null
    };

    await supabase.from('entries').insert(payload);
    autoDay = Math.min(MAX_DAY, autoDay + 1);
    updateViewer();

    document.getElementById('text').value = '';
    document.getElementById('image').value = '';
    await loadEntries();
    idx = Math.max(0, ENTRIES.length - 1);
    renderEntry();
    alert(`已儲存！Day ${payload.day_number}`);
  });
}

async function init(){
  wireViewerNav();
  wireForm();
  wireEntryPager();
  await loadPrompts();
  autoDay = await getNextDay(diary);
  updateViewer();
  await loadEntries();
  await loadLatestVideo();
}

init();

