/* =========================================================
   参加率アプリ  GAS通信レイヤー
   ここ以外の場所に通信コードを書かないこと。
   仕様が変わったときに直す場所を1か所に閉じ込めてある。
   ========================================================= */

const GAS_URL =
  'https://script.google.com/macros/s/AKfycbyvvqR4ZvxOgwVUmvvWhvYFSGZ2jZ4w9FukwSLCEWG_99hPSDbvQPi3PUVZ72qIIqgeAQ/exec';

/* ---------------------------------------------------------
   GASに送る項目名。
   出どころ：第3部「参加率アプリ GAS API 仕様」GAS版 v1.1（2026/8/10）
   仕様が変わったら、直すのはここだけ。画面側はさわらなくていい。
   --------------------------------------------------------- */
const PAYLOAD = {
  // 参加者アプリ → 参加記録シート
  // date は送らない。省略するとGASが当日を入れてくれるので、
  // スマホの時計がずれていても記録日がぶれない。
  participation({ vendorId, projectId }) {
    return { vendorId, projectId };
  },

  // メンバーアプリ → メンバー報告シート
  // 種別とリーダーはGASが自動で埋める。送らないこと（第3部の指定）。
  report({ projectId, content, expenses, goodVendors }) {
    return {
      projectId,
      content,
      expenses,     // [{ item: '駐車場代', amount: 1200 }, ...]
      goodVendors,  // ['V01', 'V02']
    };
  },
};

/* ---------------------------------------------------------
   GET  … ping / masters / summary（実機で動作確認ずみ）
   --------------------------------------------------------- */
async function apiGet(action, params = {}) {
  const url = new URL(GAS_URL);
  url.searchParams.set('action', action);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  let res;
  try {
    res = await fetch(url.toString(), { method: 'GET', redirect: 'follow' });
  } catch (e) {
    throw new Error('通信できませんでした。電波の入るところで、もう一度おためしください。');
  }
  if (!res.ok) throw new Error(`サーバーにつながりませんでした（${res.status}）`);

  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'サーバーがエラーを返しました');
  return json.data;
}

/* ---------------------------------------------------------
   POST … participation / report / createProject / createVendor

   GAS は OPTIONS（プリフライト）に返事ができない。
   そのため Content-Type は text/plain のままにして、
   中身だけ JSON 文字列で送る（＝ブラウザが単純リクエスト扱いにする）。
   ここを application/json にするとブラウザに止められるので変えないこと。
   --------------------------------------------------------- */
async function apiPost(action, payload) {
  let res;
  try {
    res = await fetch(GAS_URL, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, ...payload }),
    });
  } catch (e) {
    throw new Error('送信できませんでした。電波の入るところで、もう一度おためしください。');
  }
  if (!res.ok) throw new Error(`送信に失敗しました（${res.status}）`);

  const json = await res.json();
  if (!json.ok) throw new Error(json.error || '送信に失敗しました');

  // POSTの戻り値は data の中ではなく、ok と同じ階層にならぶ
  // （例：{ ok:true, joinId:'J00001', duplicated:false }）。
  // そのまま返して、呼んだ側に判断させる。
  return json;
}

/* ---------------------------------------------------------
   マスターの読み取り
   コワーク側の項目名が今後変わっても落ちないよう、
   考えられる名前を順に見にいく。
   --------------------------------------------------------- */
function pick(obj, names, fallback = '') {
  for (const n of names) {
    if (obj && obj[n] !== undefined && obj[n] !== null && obj[n] !== '') return obj[n];
  }
  return fallback;
}

/* よみ は「ひらがな・カタカナだけ」のときしか信用しない。
   マスターの列がずれて「会員」「執行部」などが よみ に入ってきても、
   50音の行わけが巻きぞえで壊れないようにするための番人。 */
function cleanYomi(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return /^[ぁ-んァ-ヶー・\s]+$/.test(text) ? text : '';
}

function normalizeVendor(raw) {
  return {
    id: String(pick(raw, ['vendorId', 'id', '業者ID'])),
    name: String(pick(raw, ['vendorName', 'name', '業者名'])),
    kubun: String(pick(raw, ['kubun', '区分'], '')),
    yomi: cleanYomi(pick(raw, ['yomi', 'よみ', 'kana', 'ヨミ'], '')),
  };
}

function normalizeProject(raw) {
  return {
    id: String(pick(raw, ['projectId', 'id', 'プロジェクトID'])),
    name: String(pick(raw, ['projectName', 'name', 'プロジェクト名'])),
    type: String(pick(raw, ['type', 'shubetsu', '種別'])),
    date: String(pick(raw, ['date', '日付'], '')),
    leader: String(pick(raw, ['leader', 'リーダー'], '')),
  };
}

async function fetchMasters() {
  const data = await apiGet('masters');
  return {
    vendors: (data.vendors || []).map(normalizeVendor).filter((v) => v.id && v.name),
    projects: (data.projects || []).map(normalizeProject).filter((p) => p.id && p.name),
    leaders: data.leaders || {},
    types: data['種別一覧'] || data.types || ['観光', 'イベント', '社会貢献'],
  };
}

/* そのプロジェクトに参加した業者だけを取る（メンバーアプリ用）
   並びはGASがよみの50音順にして返してくれるので、こちらで並べ替えないこと。 */
async function fetchParticipants(projectId) {
  const data = await apiGet('participants', { projectId });
  const list = data.participants || data.vendors || [];
  return {
    projectId: String(data.projectId || projectId),
    projectName: String(data.projectName || ''),
    type: String(data.type || ''),
    date: String(data.date || ''),
    leader: String(data.leader || ''),
    participants: list.map((raw) => ({
      ...normalizeVendor(raw),
      count: Number(raw['参加回数'] || 0),
      alreadyRecommended: Boolean(raw['推薦ずみ']),
    })).filter((v) => v.id && v.name),
  };
}

/* 今日の日付を 2026/8/10 形式で（画面表示用。記録の日付はGASが付ける） */
function todayLabel() {
  const d = new Date();
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}
