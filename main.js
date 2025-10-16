import { createClient } from './supabase.js';
const params = new URLSearchParams(location.search);
const diary = params.get('diary') || 'default-diary';
const supabase = createClient(window.ENV.SUPABASE_URL, window.ENV.SUPABASE_ANON_KEY);

const IMAGE_BUCKET = window.ENV.IMAGE_BUCKET || 'diary-images';
const VIDEO_BUCKET = window.ENV.VIDEO_BUCKET || 'diary-videos';

const recent = document.getElementById('recent');
const latestVideo = document.getElementById('latest-video');
const daySelect = document.getElementById('daySelect');
const promptPreview = document.getElementById('promptPreview');
const prevBtn = document.getElementById('prev');
const nextBtn = document.getElementById('next');
const viewDay = document.getElementById('viewDay');
const viewText = document.getElementById('viewText');

let PROMPTS = [];
let currentViewDay = 1;

async function loadPrompts(){
  const r = await fetch('/prompts.json'); const j = await r.json();
  PROMPTS = j.prompts || [];
  daySelect.innerHTML = '';
  for (let i=1;i<=151;i++){
    const p = PROMPTS.find(x=>x.id===i);
    const text = p ? p.text : '';
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = `Day ${i} ${text.slice(0,24)}${text.length>24?'…':''}`;
    daySelect.appendChild(opt);
  }
  const optBeyond = document.createElement('option');
  optBeyond.value = 'beyond';
  optBeyond.textContent = '> Day 151（不顯示句子）';
  daySelect.appendChild(optBeyond);
  currentViewDay = 1; updateViewer();
  promptPreview.textContent = getPromptTextForDay(1);
}
function getPromptTextForDay(day){
  const id = Number(day);
  if (!Number.isFinite(id)) return '（不顯示句子）';
  const p = PROMPTS.find(x=>x.id===id);
  return p ? '「'+p.text+'」' : '（不顯示句子）';
}
function updateViewer(){
  viewDay.textContent = String(currentViewDay);
  viewText.textContent = getPromptTextForDay(currentViewDay);
}
prevBtn.addEventListener('click', ()=>{ if (currentViewDay>1){ currentViewDay--; updateViewer(); } });
nextBtn.addEventListener('click', ()=>{ if (currentViewDay<151){ currentViewDay++; updateViewer(); } });
daySelect.addEventListener('change', ()=>{
  const v = daySelect.value;
  promptPreview.textContent = (v==='beyond') ? '（不顯示句子）' : getPromptTextForDay(Number(v));
});

const form = document.getElementById('entry-form');
form.addEventListener('submit', async (e)=>{
  e.preventDefault();
  let image_url = null;
  const img = document.getElementById('image');
  if (img.files.length){
    const file = img.files[0];
    const path = `${diary}/${Date.now()}-${file.name}`;
    const up = await supabase.storage.from(IMAGE_BUCKET).upload(path, file);
    if (up.error){ alert('圖片上傳失敗：'+up.error.message); return; }
    const pub = await supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path);
    image_url = pub.data?.publicUrl || null;
  }
  const dayValue = daySelect.value;
  let day_number = null, prompt_id = null, prompt_text = null;
  if (dayValue !== 'beyond'){
    day_number = Number(dayValue);
    const p = PROMPTS.find(x=>x.id===day_number);
    if (p){ prompt_id = p.id; prompt_text = p.text; }
  }
  const payload = {
    diary_id: diary,
    date: new Date().toISOString().slice(0,10),
    author: document.getElementById('author').value,
    title: document.getElementById('title').value,
    text: document.getElementById('text').value,
    mood: document.getElementById('mood').value,
    image_url,
    day_number, prompt_id, prompt_text,
    date_label: document.getElementById('dateLabel').value || null,
    day_label: document.getElementById('dayLabel').value || null
  };
  const { error } = await supabase.from('entries').insert(payload);
  if (error){ alert('送出失敗：'+error.message); return; }
  form.reset(); daySelect.value='beyond'; promptPreview.textContent='（不顯示句子）';
  loadRecent();
});

async function loadRecent(){
  const { data, error } = await supabase
    .from('entries').select('*').eq('diary_id', diary).order('date', { ascending:false }).limit(10);
  if (error){ console.error(error); return; }
  recent.innerHTML = (data||[]).map(e => `
    <div class="item">
      ${e.prompt_text ? `<div class="muted">「${e.prompt_text}」</div>` : ''}
      <div><strong>${e.title || '（無標題）'}</strong></div>
      <div class="muted">${e.date_label ? e.date_label+' · ' : ''}${e.day_label ? e.day_label+' · ' : ''}${e.author||''} · ${e.mood||'🙂'}</div>
      <div>${(e.text||'').slice(0,120)}${(e.text||'').length>120?'…':''}</div>
      ${e.image_url ? `<img class="thumb" src="${e.image_url}">` : ''}
    </div>
  `).join('');
}

async function loadLatestVideo(){
  const list = await supabase.storage.from(VIDEO_BUCKET).list(diary, { limit: 100, sortBy: { column:'name', order:'desc' } });
  if (!list.data?.length){ latestVideo.innerHTML = '<em>尚無影片</em>'; return; }
  const latest = list.data[0];
  const signed = await supabase.storage.from(VIDEO_BUCKET).createSignedUrl(`${diary}/${latest.name}`, 86400);
  const url = signed.data?.signedUrl;
  if (url) latestVideo.innerHTML = `<video controls src="${url}"></video>`;
}

await loadPrompts();
await loadRecent();
await loadLatestVideo();
