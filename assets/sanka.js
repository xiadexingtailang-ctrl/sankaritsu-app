/* =========================================================
   参加者アプリ（業者が使う）
   えらぶのは「企画」だけ。事業所は初回に1回えらべば端末が覚える。
   ========================================================= */

const STORE_VENDOR = 'sankaritsu.vendorId';

const el = (id) => document.getElementById(id);

const state = {
  vendors: [],
  projects: [],
  vendorId: null,
  projectId: null,
  rowFilter: 'すべて',
  keyword: '',
  sending: false,
  creating: false,   // 事業所を登録している最中
};

/* ---------- 50音の行わけ ---------- */

const KANA_ROWS = [
  ['あ', 'あいうえおぁぃぅぇぉ'],
  ['か', 'かきくけこがぎぐげご'],
  ['さ', 'さしすせそざじずぜぞ'],
  ['た', 'たちつてとだぢづでどっ'],
  ['な', 'なにぬねの'],
  ['は', 'はひふへほばびぶべぼぱぴぷぺぽ'],
  ['ま', 'まみむめも'],
  ['や', 'やゆよゃゅょ'],
  ['ら', 'らりるれろ'],
  ['わ', 'わをん'],
];

function toHiragana(str) {
  return String(str).replace(/[ァ-ヶ]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0x60)
  );
}

/* よみ列があればそれを使う。無ければ名前の先頭文字で判定し、
   漢字ではじまる事業所は「その他」に入れる。
   （コワークに業者マスターへの「よみ」列追加を依頼ずみ。
     追加されればこの関数は自動的に正しく効く） */
function rowOf(vendor) {
  const base = toHiragana(vendor.yomi || vendor.name).trim();
  const head = base.charAt(0);
  for (const [label, chars] of KANA_ROWS) {
    if (chars.includes(head)) return label;
  }
  return 'その他';
}

/* ---------- 画面のくみたて ---------- */

function showError(message) {
  el('loading').hidden = true;
  el('errorText').textContent = message;
  el('error').hidden = false;
}

function clearError() {
  el('error').hidden = true;
}

function renderVendorCard() {
  const vendor = state.vendors.find((v) => v.id === state.vendorId);
  if (!vendor) return;
  el('vendorName').textContent = vendor.name;
  el('vendorCard').hidden = false;
}

function renderProjects() {
  const list = el('projectList');
  list.textContent = '';

  if (state.projects.length === 0) {
    el('noProject').hidden = false;
    return;
  }
  el('noProject').hidden = true;

  for (const project of state.projects) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn';
    button.setAttribute('aria-pressed', String(state.projectId === project.id));
    button.dataset.projectId = project.id;

    const name = document.createElement('span');
    name.textContent = project.name;
    button.append(name);

    if (project.date) {
      const sub = document.createElement('span');
      sub.className = 'sub';
      sub.textContent = project.date;
      button.append(sub);
    }

    button.addEventListener('click', () => selectProject(project.id));
    list.append(button);
  }
}

function renderRowTabs() {
  const used = new Set(state.vendors.map(rowOf));
  const labels = ['すべて', ...KANA_ROWS.map(([l]) => l).filter((l) => used.has(l))];
  if (used.has('その他')) labels.push('その他');

  const tabs = el('rowTabs');
  tabs.textContent = '';
  for (const label of labels) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'row-tab';
    button.textContent = label;
    button.setAttribute('aria-pressed', String(state.rowFilter === label));
    button.addEventListener('click', () => {
      state.rowFilter = label;
      renderRowTabs();
      renderVendorList();
    });
    tabs.append(button);
  }
}

function renderVendorList() {
  const keyword = toHiragana(state.keyword).trim().toLowerCase();

  const matched = state.vendors.filter((vendor) => {
    if (state.rowFilter !== 'すべて' && rowOf(vendor) !== state.rowFilter) return false;
    if (!keyword) return true;
    const haystack = toHiragana(`${vendor.name} ${vendor.yomi}`).toLowerCase();
    return haystack.includes(keyword);
  });

  const list = el('vendorList');
  list.textContent = '';
  el('noVendor').hidden = matched.length > 0;

  for (const vendor of matched) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn';
    button.textContent = vendor.name;
    button.setAttribute('aria-pressed', String(state.vendorId === vendor.id));
    button.addEventListener('click', () => selectVendor(vendor.id));
    list.append(button);
  }
}

/* ---------- えらぶ ---------- */

function selectVendor(vendorId) {
  state.vendorId = vendorId;
  try { localStorage.setItem(STORE_VENDOR, vendorId); } catch (e) { /* 使えなくても動く */ }
  closeSheet();
  renderVendorCard();
  renderVendorList();
  updateSubmit();
}

function selectProject(projectId) {
  state.projectId = state.projectId === projectId ? null : projectId;
  renderProjects();
  updateSubmit();
}

function openSheet(cancelable) {
  state.keyword = '';
  el('search').value = '';
  state.rowFilter = 'すべて';
  el('closeSheet').hidden = !cancelable;
  renderRowTabs();
  renderVendorList();
  el('vendorSheet').hidden = false;
}

function closeSheet() {
  el('vendorSheet').hidden = true;
  closeNewForm();
}

function updateSubmit() {
  el('submit').disabled = !(state.vendorId && state.projectId) || state.sending;
}

/* ---------- 一覧にない事業所を足す ----------
   不正防止のため、登録には「事業所名」と「参加した企画」の2つを必須にする。
   登録と参加の記録を一度に送るので、名前だけ登録して数を稼ぐことはできない。

   GASの createVendor は同じ名前でもそのまま行を足す（二重チェックが無い）。
   なので、ここで先に一覧と見くらべて、同じ名前ならその事業所で参加だけを送る。
   同じ事業所が V05・V06 と2つに割れると、参加回数も2つに割れて判定がくるう。 */

// 「介護タクシー　陽気」「ｶｲｺﾞタクシー陽気」などを同じものとして見る
function nameKey(name) {
  return toHiragana(String(name).normalize('NFKC'))
    .replace(/[\s・･.\-ー－]/g, '')
    .toLowerCase();
}

function findSameVendor(name) {
  const key = nameKey(name);
  return state.vendors.find((v) => nameKey(v.name) === key) || null;
}

function fillNewProjects() {
  const select = el('newProject');
  select.textContent = '';
  const first = document.createElement('option');
  first.value = '';
  first.textContent = state.projects.length ? 'えらんでください' : '企画がまだありません';
  select.append(first);
  for (const project of state.projects) {
    const option = document.createElement('option');
    option.value = project.id;
    option.textContent = project.date ? `${project.name}（${project.date}）` : project.name;
    select.append(option);
  }
  select.value = state.projectId || '';
}

function openNewForm() {
  el('openNew').hidden = true;
  el('newForm').hidden = false;
  el('newErr').hidden = true;
  el('newName').value = state.keyword.trim();
  el('newYomi').value = '';
  fillNewProjects();
  el('newName').focus();
}

function closeNewForm() {
  el('openNew').hidden = false;
  el('newForm').hidden = true;
}

function showNewError(message) {
  el('newErr').textContent = message;
  el('newErr').hidden = false;
}

async function submitNewVendor(event) {
  event.preventDefault();
  if (state.creating || state.sending) return;
  el('newErr').hidden = true;

  const name = el('newName').value.normalize('NFKC').replace(/\s+/g, ' ').trim();
  const yomiRaw = toHiragana(el('newYomi').value.trim());
  const project = state.projects.find((p) => p.id === el('newProject').value);

  if (!name) {
    showNewError('事業所名を入れてください。');
    el('newName').focus();
    return;
  }
  if (yomiRaw && !cleanYomi(yomiRaw)) {
    showNewError('よみは ひらがな で入れてください（わからなければ空のままでだいじょうぶです）。');
    el('newYomi').focus();
    return;
  }
  if (!project) {
    showNewError('参加した企画をえらんでください。');
    el('newProject').focus();
    return;
  }

  // すでに一覧にあるなら、新しく作らずにその事業所で参加だけを送る
  const same = findSameVendor(name);
  const message = same
    ? `「${same.name}」はすでに登録されています。\n「${project.name}」の参加をおくります。`
    : `「${name}」を登録して、\n「${project.name}」の参加をおくります。\nまちがいありませんか？`;
  if (!window.confirm(message)) return;

  state.creating = true;
  const button = el('newSubmit');
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'おくっています…';

  try {
    let vendorId = same ? same.id : '';
    if (!same) {
      const result = await apiPost('createVendor', PAYLOAD.vendor({
        vendorName: name,
        yomi: yomiRaw,
      }));
      vendorId = String(result.vendorId || '');
      if (!vendorId) throw new Error('登録できたか確かめられませんでした。協議会に連絡してください。');
      state.vendors.push({ id: vendorId, name, kubun: '会員', yomi: yomiRaw });
    }

    // 事業所をえらんだ状態にして、そのまま参加をおくる。
    // 参加の送信がしくじっても、事業所と企画はえらばれたまま残るので
    // 「参加をおくる」をもう一度押せばよい（エラーは上に出る）。
    selectVendor(vendorId);
    state.projectId = project.id;
    renderProjects();
    state.creating = false;
    await submit();
  } catch (e) {
    showNewError(e.message);
  } finally {
    state.creating = false;
    button.disabled = false;
    button.textContent = label;
  }
}

/* ---------- おくる ----------
   二重押しの見張りはGASがやってくれる。
   同じ日・同じ業者・同じ企画なら行を増やさず duplicated: true を返す仕様なので、
   こちらは押す前に止めず、返ってきた結果を正直に出す。
   （「もう一度おくりますか？」と聞いても、押した先で行は増えない＝嘘の選択肢になる） */

async function submit() {
  if (state.sending) return;
  const vendor = state.vendors.find((v) => v.id === state.vendorId);
  const project = state.projects.find((p) => p.id === state.projectId);
  if (!vendor || !project) return;

  state.sending = true;
  const button = el('submit');
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'おくっています…';
  clearError();

  try {
    const result = await apiPost('participation', PAYLOAD.participation({
      vendorId: vendor.id,
      projectId: project.id,
    }));

    showDone(vendor, project, Boolean(result.duplicated));
  } catch (e) {
    showError(e.message);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } finally {
    state.sending = false;
    button.textContent = label;
    updateSubmit();
  }
}

function showDone(vendor, project, duplicated) {
  const done = el('done');
  done.classList.toggle('is-dup', duplicated);

  el('doneMark').textContent = duplicated ? '！' : '✓';
  el('doneTitle').textContent = duplicated ? 'すでに記録ずみです' : '参加を記録しました';

  const detail = el('doneDetail');
  detail.textContent = '';
  detail.append(
    document.createTextNode(vendor.name),
    document.createElement('br'),
    document.createTextNode(project.name),
    document.createElement('br'),
    document.createTextNode(todayLabel())
  );

  const note = el('doneNote');
  note.hidden = !duplicated;
  note.textContent = duplicated
    ? 'この企画の参加は、今日ぶんがすでに入っています。もう一度おくる必要はありません。'
    : '';

  done.hidden = false;
}

/* ---------- 起動 ---------- */

async function boot() {
  clearError();
  el('loading').hidden = false;
  el('today').textContent = todayLabel();

  let masters;
  try {
    masters = await fetchMasters();
  } catch (e) {
    showError(e.message);
    return;
  }

  state.vendors = masters.vendors;
  state.projects = sortProjects(masters.projects);
  el('loading').hidden = true;

  // 前回えらんだ事業所を思い出す。無ければ（または消えていれば）えらんでもらう。
  let saved = null;
  try { saved = localStorage.getItem(STORE_VENDOR); } catch (e) { /* noop */ }

  if (saved && state.vendors.some((v) => v.id === saved)) {
    state.vendorId = saved;
    renderVendorCard();
  } else {
    openSheet(false);
  }

  el('projectCard').hidden = false;
  renderProjects();
  updateSubmit();
}

/* 新しい企画を上に。日付が無いものは下に回す */
function sortProjects(projects) {
  const time = (p) => {
    const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})/.exec(p.date);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : -Infinity;
  };
  return [...projects].sort((a, b) => time(b) - time(a));
}

/* ---------- つなぎこみ ---------- */

el('changeVendor').addEventListener('click', () => openSheet(true));
el('closeSheet').addEventListener('click', closeSheet);
el('retry').addEventListener('click', boot);
el('openNew').addEventListener('click', openNewForm);
el('newForm').addEventListener('submit', submitNewVendor);
el('submit').addEventListener('click', submit);

el('search').addEventListener('input', (event) => {
  state.keyword = event.target.value;
  renderVendorList();
});

// 検索欄でエンターを押したらキーボードを閉じる（画面が跳ねないように）
el('search').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    event.target.blur();
  }
});

el('doneBack').addEventListener('click', () => {
  el('done').hidden = true;
  state.projectId = null;
  renderProjects();
  updateSubmit();
  window.scrollTo({ top: 0 });
});

boot();
