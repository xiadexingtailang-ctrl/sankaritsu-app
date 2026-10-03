/* =========================================================
   メンバーアプリ（協議会メンバーが使う）
   種別 → 企画 → 内容 → 経費 → 良かった業者 → 送信
   種別とリーダーはGASが自動で埋めるので、送信には含めない（第3部の指定）。
   ========================================================= */

const el = (id) => document.getElementById(id);

const state = {
  projects: [],
  leaders: {},
  types: [],
  type: null,
  projectId: null,
  participants: [],
  good: new Set(),
  costs: [],          // [{ id, item, amount }]
  loadingParticipants: false,
  sending: false,
};

let costSeq = 0;

/* ---------- エラー ---------- */

function showError(message) {
  el('loading').hidden = true;
  el('errorText').textContent = message;
  el('error').hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function clearError() {
  el('error').hidden = true;
}

/* ---------- ① 種別 ---------- */

function renderTypes() {
  const list = el('typeList');
  list.textContent = '';

  for (const type of state.types) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn';
    button.textContent = type;
    button.setAttribute('aria-pressed', String(state.type === type));
    button.addEventListener('click', () => selectType(type));
    list.append(button);
  }

  renderLeader();
}

/* リーダーは、企画をえらんだら「その企画のリーダー」を出す。
   企画ごとにリーダーが種別のリーダーとちがうことがある
   （例：社会貢献のリーダーはかおり、ごみ拾いの企画はいまここ）。 */
function renderLeader() {
  const project = state.projects.find((p) => p.id === state.projectId);
  const leader = (project && project.leader) || (state.type ? state.leaders[state.type] : '');
  el('leaderLine').hidden = !leader;
  el('leaderName').textContent = leader || '';
}

function selectType(type) {
  if (state.type === type) return;
  state.type = type;

  // 種別を変えたら、その先で選んだものは全部やり直し
  state.projectId = null;
  state.participants = [];
  state.good.clear();

  renderTypes();
  renderProjects();
  renderGood();
  el('projectCard').hidden = false;
  updateSubmit();
}

/* ---------- ② 企画 ---------- */

function projectsOfType() {
  const matched = state.projects.filter((p) => p.type === state.type);
  const time = (p) => {
    const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})/.exec(p.date);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : -Infinity;
  };
  return matched.sort((a, b) => time(b) - time(a));
}

function renderProjects() {
  const list = el('projectList');
  list.textContent = '';

  const projects = projectsOfType();
  el('noProject').hidden = projects.length > 0;

  for (const project of projects) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn';
    button.setAttribute('aria-pressed', String(state.projectId === project.id));

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

async function selectProject(projectId) {
  if (state.projectId === projectId) return;
  state.projectId = projectId;
  state.participants = [];
  state.good.clear();

  renderProjects();
  renderLeader();
  el('contentCard').hidden = false;
  el('costCard').hidden = false;
  el('goodCard').hidden = false;
  updateSubmit();

  await loadParticipants(projectId);
}

/* ---------- ⑤ 良かった業者（その企画に参加した業者だけ） ---------- */

async function loadParticipants(projectId) {
  state.loadingParticipants = true;
  el('goodLoading').hidden = false;
  el('goodList').textContent = '';
  el('noGood').hidden = true;
  el('goodHint').hidden = true;
  clearError();

  try {
    const result = await fetchParticipants(projectId);
    // 待っているあいだに別の企画を押されていたら、古い結果は捨てる
    if (state.projectId !== projectId) return;
    state.participants = result.participants;
  } catch (e) {
    if (state.projectId !== projectId) return;
    state.participants = [];
    showError(e.message);
  } finally {
    if (state.projectId === projectId) {
      state.loadingParticipants = false;
      el('goodLoading').hidden = true;
      renderGood();
    }
  }
}

function renderGood() {
  const list = el('goodList');
  list.textContent = '';

  if (state.loadingParticipants) return;

  const hasProject = Boolean(state.projectId);
  const empty = state.participants.length === 0;
  el('noGood').hidden = !hasProject || !empty;
  el('goodHint').hidden = !hasProject || empty;

  // 並びはGASがよみの50音順で返してくれる。ここで並べ替えないこと。
  for (const vendor of state.participants) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn';
    button.setAttribute('aria-pressed', String(state.good.has(vendor.id)));

    const name = document.createElement('span');
    name.textContent = vendor.name;
    button.append(name);

    // すでに別の報告で推薦されている業者は目じるしを付ける。
    // ただし最初から選んだ状態にはしない。
    // 報告は出すたびに1件積まれるので、勝手に入れておくと推薦回数が水増しされる。
    if (vendor.alreadyRecommended) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = '推薦ずみ';
      button.append(badge);
    }

    button.addEventListener('click', () => {
      if (state.good.has(vendor.id)) state.good.delete(vendor.id);
      else state.good.add(vendor.id);
      renderGood();
    });

    list.append(button);
  }

  el('goodCount').textContent = state.good.size ? `${state.good.size}者を選択中` : '';
}

/* ---------- ④ 経費 ---------- */

function addCostRow() {
  state.costs.push({ id: ++costSeq, item: '', amount: '' });
  renderCosts();
}

function renderCosts() {
  const wrap = el('costRows');
  wrap.textContent = '';

  for (const cost of state.costs) {
    const row = document.createElement('div');
    row.className = 'cost-row';

    const item = document.createElement('input');
    item.type = 'text';
    item.placeholder = '使途（例：駐車場代）';
    item.value = cost.item;
    item.autocomplete = 'off';
    item.addEventListener('input', () => { cost.item = item.value; });

    const amount = document.createElement('input');
    amount.type = 'text';
    amount.className = 'amount';
    amount.inputMode = 'numeric';
    amount.placeholder = '金額';
    amount.value = cost.amount;
    amount.autocomplete = 'off';
    amount.addEventListener('input', () => {
      cost.amount = amount.value;
      updateCostSum();
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'icon-btn';
    remove.textContent = '×';
    remove.setAttribute('aria-label', 'この行をけす');
    remove.addEventListener('click', () => {
      state.costs = state.costs.filter((c) => c.id !== cost.id);
      if (state.costs.length === 0) addCostRow();
      else renderCosts();
      updateCostSum();
    });

    row.append(item, amount, remove);
    wrap.append(row);
  }

  updateCostSum();
}

/* 「1,200」「1200円」どちらで打たれても数字として読む */
function toAmount(text) {
  const digits = String(text).replace(/[^0-9]/g, '');
  return digits ? Number(digits) : null;
}

function updateCostSum() {
  const total = state.costs.reduce((sum, c) => sum + (toAmount(c.amount) || 0), 0);
  el('costSum').textContent = `合計 ${total.toLocaleString('ja-JP')}円`;
}

/* 送るぶんだけ取り出す。使途も金額も空の行は、書きかけではなく未使用として捨てる */
function collectExpenses() {
  const expenses = [];
  for (const cost of state.costs) {
    const item = cost.item.trim();
    const amount = toAmount(cost.amount);
    if (!item && amount === null) continue;
    if (!item) throw new Error(`金額 ${amount.toLocaleString('ja-JP')}円 の使途が空です。何に使ったか入れてください。`);
    if (amount === null) throw new Error(`「${item}」の金額が空です。`);
    expenses.push({ item, amount });
  }
  return expenses;
}

/* ---------- 送信 ---------- */

function updateSubmit() {
  el('submit').disabled = !(state.type && state.projectId) || state.sending;
}

async function submit() {
  if (state.sending) return;
  const project = state.projects.find((p) => p.id === state.projectId);
  if (!project) return;

  let expenses;
  try {
    expenses = collectExpenses();
  } catch (e) {
    showError(e.message);
    return;
  }

  state.sending = true;
  const button = el('submit');
  button.disabled = true;
  button.textContent = 'おくっています…';
  clearError();

  try {
    const result = await apiPost('report', PAYLOAD.report({
      projectId: project.id,
      content: el('content').value.trim(),
      expenses,
      goodVendors: [...state.good],
    }));

    const detail = el('doneDetail');
    detail.textContent = '';
    detail.append(
      document.createTextNode(project.name),
      document.createElement('br'),
      document.createTextNode(
        `経費 ${result.expenseCount ?? expenses.length}件 ／ 良かった業者 ${result.goodVendorCount ?? state.good.size}者`
      ),
      document.createElement('br'),
      document.createTextNode(todayLabel())
    );
    el('done').hidden = false;
  } catch (e) {
    showError(e.message);
  } finally {
    state.sending = false;
    button.textContent = '報告をおくる';
    updateSubmit();
  }
}

function resetForm() {
  state.type = null;
  state.projectId = null;
  state.participants = [];
  state.good.clear();
  state.costs = [];
  addCostRow();
  el('content').value = '';

  el('projectCard').hidden = true;
  el('contentCard').hidden = true;
  el('costCard').hidden = true;
  el('goodCard').hidden = true;

  renderTypes();
  renderProjects();
  renderGood();
  updateSubmit();
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

  state.projects = masters.projects;
  state.leaders = masters.leaders;
  state.types = masters.types;

  el('loading').hidden = true;
  el('typeCard').hidden = false;

  if (state.costs.length === 0) addCostRow();
  renderTypes();
  renderCosts();
  updateSubmit();
}

/* ---------- つなぎこみ ---------- */

el('retry').addEventListener('click', boot);
el('addCost').addEventListener('click', addCostRow);
el('submit').addEventListener('click', submit);

el('doneBack').addEventListener('click', () => {
  el('done').hidden = true;
  resetForm();
  window.scrollTo({ top: 0 });
});

boot();
