import { createClient } from './supabase.js';

const params = new URLSearchParams(location.search);
const diary = params.get('diary') || 'default-diary';

// Supabase
const supabase = createClient(window.ENV.SUPABASE_URL, window.ENV.SUPABASE_ANON_KEY);

// Buckets
const IMAGE_BUCKET = window.ENV.IMAGE_BUCKET || 'diary-images';
const VIDEO_BUCKET = window.ENV.VIDEO_BUCKET || 'diary-videos';

// UI refs（有就用，沒有也不會壞）
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
  re
