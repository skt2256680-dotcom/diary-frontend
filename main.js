import { createClient } from './supabase.js';

const MAX_DAY = 131; // ← 這裡決定最多幾天

console.log('frontend build: v-delete-2c (MAX_DAY=131)');

const params = new URLSearchParams(location.search);
const diary = params.get('diary') || 'default-diary';

// Supabase
const supabase = createClient(window.ENV.SUPABASE_URL, window.ENV.SUPABASE_ANON_KEY);

// Buckets
const IMAGE_BUCKET = window.ENV.IMAGE_BUCKET || 'diary-images';
const VIDEO_BUCKET = window.ENV.VIDEO_BUCKET || 'diary-videos';

// UI
const recent        = document.getElementById('recent');
const latestVideo   = document.getElementById('latest-video');
const viewDay       = document.getElementById('viewDay');
const viewText      = document.getElementById('viewText');
const prevBtn       = document.getElementById('prev');
const nextBtn       = document.getElementById('next');
const jumpDayInput  = document.getElementById('jumpDay');
const form          = document.getElementById('entry-form');

// ───────────────── Prompts ─────────────────
let PROMPTS = [];
async function loadPrompts() {
  try {
    const r = await fetch('/prompts.json');
    const j = await r.json();
    PROMPTS = j.prompts || [];
  } catch (e) {
    console.warn('loadPrompts error', e);
    PROMPTS = [];
  }
}
function promptTextById(id) {
  const p = PROMPTS.find(x => x.id === id);
  return p ? p.text : null;
}

// ──────────────── 下一個 Day（自動） ────────────────
async function getNextDay(diaryId) {
  const { data, error } = await supabase
    .from('entries')
    .select('day_number')
    .eq('diary_id', diaryId)
    .not('day_number', 'is', null);
  if (error) { console.warn('getNextDay error', error); return 1; }
  const max = (data || []).reduce((m, r) => Math.max(m, r.day_number || 0), 0);
  return Math.min(MAX_DAY, max + 1);
}

// ───────────────── Viewer ─────────────────
let autoDay = 1;
const clampDay = n => Math.max(1, Math.min(MAX_DAY, Math.trunc(Number(n) || 1)));

function updateViewer(){
  if (!viewDay || !viewText) return;
  viewDay.textContent = String(autoDay);
  if (jumpDayInput) jumpDayInput.value = String(autoDay);

  const t = (autoDay >= 1 && autoDay <= MAX_DAY) ? promptTextById(autoDay) : null;
  viewText.textContent = t ? `「${t}」` : '（不顯示句子）';

  // UX：到邊界就禁用按鈕
  if (prevBtn) prevBtn.disabled = (autoDay <= 1);
  if (nextBtn) nextBtn.disabled = (autoDay >= MAX_DAY);
}

function wireViewerNav(){
  if (prevBtn) prevBtn.onclick = ()=>{ if (autoDay>1){ autoDay--; updateViewer(); } };
  if (nextBtn) nextBtn.onclick = ()=>{ if (autoDay<MAX_DAY){ autoDay++; updateViewer(); } };
  if (jumpDayInput){
    const go=()=>{ autoDay = clampDay(jumpDayInput.value); updateViewer(); };
    jumpDayInput.addEventListener('change', go);
    jumpDayInput.addEventListener('keyup', e=>{ if(e.key==='Enter') go(); });
  }
}

// ──────────────── 小工具：從 public URL 抽 path ────────────────
function extractPathFromPublicUrl(url){
  // 例如：https://.../object/public/<bucket>/<path>
  if (!url) return null;
  const m = url.match(/\/object\/public\/([^/]+)\/(.+)$/);
  if (!m) return null;
  const [, bucket, path] = m;
  if (bucket !== IMAGE_BUCKET) return null;
  return path;
}

// ──────────────── 刪除（先檔案、再資料） ────────────────
async function deleteEntryAndAssets(id, image_path, image_url){
  // 1) 刪 Storage 檔（舊資料沒 path 時，從 URL 解析）
  const path = image_path || extractPathFromPublicUrl(image_url || '');
  if (path){
    const { error: rmErr } = await supabase.storage.from(IMAGE_BUCKET).remove([path]);
    if (rmErr && !/not\s*found/i.test(rmErr.message)) {
      alert('刪圖片失敗：' + rmErr.message);
      return;
    }
  }
  // 2) 刪 DB 資料
  const { error: delErr } = await supabase.from('entries').delete().eq('id', id);
  if (delErr){ alert('刪資料失敗：' + delErr.message); return; }
}

// ──────────────── 最近新增（含刪除） ────────────────
async function loadRecent(){
  const { data, error } = await supabase
    .from('entries')
    .select('*')
    .eq('diary_id', diary)
    .order('date', { ascending:false })
    .limit(10);
  if (error){ console.error(error); return; }

  if (!recent) return;
  recent.innerHTML = (data||[]).map(e => `
    <div class="item"
         data-id="${e.id}"
         data-image-path="${e.image_path || ''}"
         data-image-url="${e.image_url || ''}">
      ${e.prompt_text ? `<div class="muted">「${e.prompt_text}」</div>` : ''}
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <strong>${e.title || '（無標題）'}</strong>
        <button class="ghost danger" data-delete="${e.id}">刪除</button>
      </div>
      <div class="muted">
        ${e.date_label ? e.date_label + ' · ' : ''}${e.day_label ? e.day_label + ' · ' : ''}${e.author || ''} · ${e.mood || '🙂'}
      </div>
      <div class="body">${e.text || ''}</div>
      ${e.image_url ? `<img class="thumb" src="${e.image_url}">` : ''}
    </div>
  `).join('');

  // 刪除事件（事件委派）
  recent.onclick = async (ev)=>{
    const btn = ev.target.closest('[data-delete]');
    if (!btn) return;
    const wrap = btn.closest('.item');
    const id = wrap?.dataset.id;
    const image_path = wrap?.dataset.imagePath || null;
    const image_url  = wrap?.dataset.imageUrl  || null;

    if (!id) return;
    if (!confirm('確定要刪除這篇日記嗎？（圖片也會一併刪除）')) return;

    await deleteEntryAndAssets(id, image_path, image_url);
    await loadRecent();
  };
}

// ──────────────── 最新影片（讀取） ────────────────
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
  if (url) latestVideo.innerHTML =
    `<video controls src="${url}" style="max-width:100%;border-radius:12px;"></video>`;
}

// ──────────────── 上傳：安全檔名（避免中文/emoji） ────────────────
function buildSafePath(dir, file){
  const ext = (file.name.split('.').pop() || 'png').toLowerCase();
  const safeName = `${Date.now()}.${ext}`;  // 只用時間戳 + 副檔名
  return `${dir}/${safeName}`;
}

// ──────────────── 送出表單 ────────────────
function wireForm(){
  if (!form) return;
  form.addEventListener('submit', async (e)=>{
    e.preventDefault();

    // 沒有 Day 可寫了就擋住
    const inRange = autoDay >= 1 && autoDay <= MAX_DAY;
    if (!inRange) {
      alert(`已經是最後一頁了（Day ${MAX_DAY}）`);
      return;
    }

    let image_url = null;
    let image_path = null;

    // 1) 圖片（可選）
    const img = document.getElementById('image');
    if (img?.files?.length){
      const file = img.files[0];
      const path = buildSafePath(diary, file);

      const up = await supabase.storage
        .from(IMAGE_BUCKET)
        .upload(path, file, { contentType: file.type || 'image/png', upsert: true });

      if (up.error){
        alert('圖片上傳失敗：' + up.error.message);
        console.error(up.error);
        return;
      }
      const pub = await supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path);
      image_url  = pub.data?.publicUrl || null;
      image_path = path; // 存路徑，之後刪除會用到
    }

    // 2) 導引句
    const prompt_text = promptTextById(autoDay);

    // 3) payload
    const payload = {
      diary_id: diary,
      date: new Date().toISOString().slice(0,10),
      author: (document.getElementById('author')?.value?.trim() || null),
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

    const { error } = await supabase.from('entries').insert(payload);
    if (error){ alert('送出失敗：' + error.message); return; }

    // 4) 下一篇 + 清表單 + 重新載入
    autoDay = Math.min(MAX_DAY, autoDay + 1);
    updateViewer();

    const textEl  = document.getElementById('text');
    const imageEl = document.getElementById('image');
    if (textEl)  textEl.value = '';
    if (imageEl) imageEl.value = '';
    alert(`已儲存！本篇 Day ${payload.day_number}${payload.prompt_text ? '（已帶句子）' : '（無導引句）'}`);

    loadRecent();
  });
}

// ──────────────── 初始化（不使用 top-level await） ────────────────
async function init(){
  wireViewerNav();     // 先綁事件，按鈕立刻可用
  wireForm();

  await loadPrompts();
  autoDay = await getNextDay(diary);
  updateViewer();

  await loadRecent();
  await loadLatestVideo();
}

init();
