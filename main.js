import { createClient } from './supabase.js';

console.log('frontend build: v-delete-1');

const params = new URLSearchParams(location.search);
const diary = params.get('diary') || 'default-diary';

const supabase = createClient(window.ENV.SUPABASE_URL, window.ENV.SUPABASE_ANON_KEY);

const IMAGE_BUCKET = window.ENV.IMAGE_BUCKET || 'diary-images';
const VIDEO_BUCKET = window.ENV.VIDEO_BUCKET || 'diary-videos';

const recent = document.getElementById('recent');
const latestVideo = document.getElementById('latest-video');
const viewDay = document.getElementById('viewDay');
const viewText = document.getElementById('viewText');
const prevBtn = document.getElementById('prev');
const nextBtn = document.getElementById('next');
const jumpDayInput = document.getElementById('jumpDay');
const form = document.getElementById('entry-form');

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

async function getNextDay(diaryId) {
  const { data, error } = await supabase
    .from('entries')
    .select('day_number')
    .eq('diary_id', diaryId)
    .not('day_number', 'is', null);
  if (error) { console.warn('getNextDay error', error); return 1; }
  const max = (data || []).reduce((m, r) => Math.max(m, r.day_number || 0), 0);
  return Math.min(151, max + 1);
}

// ── Viewer ───────────────────────────────────────────────
let autoDay = 1;
const clampDay = n => Math.max(1, Math.min(151, Math.trunc(Number(n) || 1)));

function updateViewer(){
  if (!viewDay || !viewText) return;
  viewDay.textContent = String(autoDay);
  if (jumpDayInput) jumpDayInput.value = String(autoDay);
  const t = (autoDay >= 1 && autoDay <= 151) ? promptTextById(autoDay) : null;
  viewText.textContent = t ? `「${t}」` : '（不顯示句子）';
}

function wireViewerNav(){
  if (prevBtn) prevBtn.addEventListener('click', ()=>{ if (autoDay>1){ autoDay--; updateViewer(); } });
  if (nextBtn) nextBtn.addEventListener('click', ()=>{ if (autoDay<151){ autoDay++; updateViewer(); } });
  if (jumpDayInput){
    const go=()=>{ autoDay = clampDay(jumpDayInput.value); updateViewer(); };
    jumpDayInput.addEventListener('change', go);
    jumpDayInput.addEventListener('keyup', e=>{ if(e.key==='Enter') go(); });
  }
}

// ── 最近新增（含刪除檔案 + 刪資料） ─────────────────────
function extractPathFromPublicUrl(url){
  // 解析 Supabase public URL: .../object/public/<bucket>/<path>
  if (!url) return null;
  const m = url.match(/\/object\/public\/([^/]+)\/(.+)$/);
  if (!m) return null;
  const [, bucket, path] = m;
  if (bucket !== IMAGE_BUCKET) return null;
  return path;
}

async function deleteEntryAndAssets(id, image_path, image_url){
  // 1) 刪 Storage 檔（可容忍「檔案不存在」）
  const path = image_path || extractPathFromPublicUrl(image_url || '');
  if (path){
    const { error: rmErr } = await supabase.storage.from(IMAGE_BUCKET).remove([path]);
    if (rmErr && !/not\s*found/i.test(rmErr.message)) {
      // 不是「找不到」的錯就提示
      alert('刪圖片失敗：' + rmErr.message);
      return;
    }
  }
  // 2) 刪 DB 資料
  const { error: delErr } = await supabase.from('entries').delete().eq('id', id);
  if (delErr){ alert('刪資料失敗：' + delErr.message); return; }
}

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

// ── 最新影片（保留：不做刪除） ─────────────────────────
async function loadLatestVideo(){
  if (!latestVideo) return;
  const list = await supabase.storage.from(VIDEO_BUCKET).list(diary, { limit:100, sortBy:{column:'name', order:'desc'} });
  if (!list.data?.length){ latestVideo.innerHTML = '<em>尚無影片</em>'; return; }
  const latest = list.data[0];
  const signed = await supabase.storage.from(VIDEO_BUCKET).createSignedUrl(`${diary}/${latest.name}`, 86400);
  const url = signed.data?.signedUrl;
  if (url) latestVideo.innerHTML = `<video controls src="${url}" style="max-width:100%;border-radius:12px;"></video>`;
}

// ── 送出表單（會把 image_path 一起存） ───────────────────
if (form){
  form.addEventListener('submit', async (e)=>{
    e.preventDefault();

    let image_url = null;
    let image_path = null;

    const img = document.getElementById('image');
    if (img?.files?.length){
      const file = img.files[0];
      const path = `${diary}/${Date.now()}-${file.name}`;
      const up = await supabase.storage.from(IMAGE_BUCKET)
        .upload(path, file, { contentType: file.type || 'image/png', upsert: true });
      if (up.error){ alert('圖片上傳失敗：' + up.error.message); console.error(up.error); return; }
      const pub = await supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path);
      image_url = pub.data?.publicUrl || null;
      image_path = path; // ← 關鍵：存路徑
    }

    const inRange = autoDay>=1 && autoDay<=151;
    const prompt_text = inRange ? promptTextById(autoDay) : null;

    const payload = {
      diary_id: diary,
      date: new Date().toISOString().slice(0,10),
      author: (document.getElementById('author')?.value?.trim() || null),
      title: '給妳的150天',
      text: document.getElementById('text')?.value || '',
      mood: document.getElementById('mood')?.value || null,
      image_url,
      image_path,                        // ← 關鍵：一起存
      day_number: inRange ? autoDay : null,
      prompt_id: inRange ? autoDay : null,
      prompt_text,
      date_label: document.getElementById('dateLabel')?.value || null,
      day_label: document.getElementById('dayLabel')?.value || null
    };

    const { error } = await supabase.from('entries').insert(payload);
    if (error){ alert('送出失敗：' + error.message); return; }

    autoDay = Math.min(151, autoDay+1);
    updateViewer();

    if (document.getElementById('text')) document.getElementById('text').value = '';
    if (document.getElementById('image')) document.getElementById('image').value = '';
    alert(`已儲存！本篇 ${payload.day_number ? `Day ${payload.day_number}` : '—'}${payload.prompt_text ? '（已帶句子）' : '（無導引句）'}`);

    loadRecent();
  });
}

// ── 初始化 ───────────────────────────────────────────────
await loadPrompts();
autoDay = await getNextDay(diary);
wireViewerNav();
updateViewer();
await loadRecent();
await loadLatestVideo();