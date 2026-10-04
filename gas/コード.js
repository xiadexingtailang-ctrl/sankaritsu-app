/**********************************************************************
 * 参加率アプリ ── グーグルスプレッドシート側 ＋ GAS
 * 介護タクシー協議会「召集判断のための事実データ」用
 *
 * 使い方は「参加率アプリ_手順書.md」を見てください。
 * 最初にやること：メニュー［参加率アプリ］→［① 初期セットアップ］
 **********************************************************************/


/* ====================================================================
 * ▼ 設定（ここだけ直せば動きが変わります）
 * ==================================================================== */

// 召集の判定ライン（あとから数字を変えるだけでOK）
const 参加召集ライン = 5;   // この回数以上で「召集回数に達した」報告リストに載る
const 推薦優遇ライン = 3;   // この回数以上で「召集検討」リストに載る

// 合言葉（ウェブアプリの簡易認証）。空文字なら認証なし。
// 使う場合はここに好きな文字列を入れ、アプリ側からも同じ値を送ってもらう。
const 合言葉 = '';

// タイムゾーンと日付の形（2026/8/10 の形）
const TZ = 'Asia/Tokyo';
const 日付形式 = 'yyyy/M/d';

// 種別の3つ（この3つ以外は受け付けない）
const 種別一覧 = ['観光', 'イベント', '社会貢献'];

// 業者の区分
const 区分一覧 = ['会員', '執行部'];


/* ====================================================================
 * ▼ シート名と列の定義（表記ゆれ防止のため、ここで一元管理）
 * ==================================================================== */

const S = {
  PROJ:   'プロジェクトマスター',
  VEND:   '業者マスター',
  LEAD:   'リーダーマスター',
  JOIN:   '参加記録',
  REPORT: 'メンバー報告',
  COST:   '経費明細',
  REC:    '推薦記録',
  SUM:    '集計・判定'
};

const HEADERS = {
  [S.PROJ]:   ['プロジェクトID', 'プロジェクト名', '種別', '日付', 'リーダー'],
  [S.VEND]:   ['業者ID', '業者名', '区分', 'よみ'],
  [S.LEAD]:   ['種別', 'リーダー'],
  [S.JOIN]:   ['参加ID', '日付', '業者ID', 'プロジェクトID'],
  [S.REPORT]: ['報告ID', '日付', 'プロジェクトID', '種別', 'リーダー', '内容'],
  [S.COST]:   ['報告ID', 'プロジェクトID', '使途', '金額'],
  [S.REC]:    ['報告ID', 'プロジェクトID', '業者ID']
};

// 日付を「2026/8/10」の見た目のまま保つため、文字列として持たせる列
const 日付列 = {
  [S.PROJ]:   4,
  [S.JOIN]:   2,
  [S.REPORT]: 2
};


/* ====================================================================
 * ▼ メニュー
 * ==================================================================== */

function onOpen() {
  const menu = SpreadsheetApp.getUi().createMenu('参加率アプリ')
    .addItem('① 初期セットアップ（最初に1回）', 'setup')
    .addItem('② 集計を今すぐ更新', 'recalc');
  menu.addToUi();
}


/* ====================================================================
 * ▼ ① 初期セットアップ
 *    シートを全部作り、見出しを入れ、トリガーを仕掛ける
 * ==================================================================== */

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(TZ);

  // --- 業者マスターの列並びをそろえる（区分とよみが入れ替わっていたら直す） ---
  normalizeVendorSheet_(ss);

  // --- 各シートを作る（すでにあれば見出しだけ整える） ---
  Object.keys(HEADERS).forEach(function (name) {
    const sh = ss.getSheetByName(name) || ss.insertSheet(name);
    const head = HEADERS[name];
    sh.getRange(1, 1, 1, head.length).setValues([head])
      .setFontWeight('bold')
      .setBackground('#e8eaed');
    sh.setFrozenRows(1);
    // 日付列は文字列扱いにして「2026/8/10」の形を固定する
    if (日付列[name]) {
      sh.getRange(2, 日付列[name], sh.getMaxRows() - 1, 1).setNumberFormat('@');
    }
    sh.autoResizeColumns(1, head.length);
  });

  // --- 集計・判定シート ---
  if (!ss.getSheetByName(S.SUM)) ss.insertSheet(S.SUM);

  // --- リーダーマスターに3種別の枠を用意（名前は空欄。あとで手で入れる） ---
  const lead = ss.getSheetByName(S.LEAD);
  if (lead.getLastRow() < 2) {
    lead.getRange(2, 1, 3, 2).setValues([
      ['観光', ''],
      ['イベント', ''],
      ['社会貢献', '']
    ]);
  }

  // --- 入力ミス防止のプルダウン ---
  setDropdown_(ss.getSheetByName(S.PROJ), 3, 種別一覧);   // プロジェクトマスターの種別
  setDropdown_(ss.getSheetByName(S.VEND), 3, 区分一覧);   // 業者マスターの区分

  // --- トリガー（二重登録を避けるため、いったん全部消してから付け直す） ---
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('onEditHandler').forSpreadsheet(ss).onEdit().create();

  // --- 初回の集計 ---
  recalc();

  // --- 不要な初期シートを片付ける ---
  const first = ss.getSheetByName('シート1') || ss.getSheetByName('Sheet1');
  if (first && ss.getSheets().length > 1 && first.getLastRow() === 0) ss.deleteSheet(first);

  SpreadsheetApp.getActive().toast('セットアップが終わりました。リーダーマスターに名前を入れてください。', '参加率アプリ', 8);
}

/**
 * 業者マスターの3列目・4列目の並びをそろえる。
 * 正しい形： 業者ID ／ 業者名 ／ 区分 ／ よみ
 *
 * 見出しの文字ではなく「中身」で判定する（見出しだけ直っていて中身がずれている事故を防ぐため）。
 * 4列目に 会員／執行部 が入っていて3列目には入っていなければ、その2列を入れ替える。
 * どちらでもなければ何もしない。中身を勝手に消したり動かしたりしない。
 */
function normalizeVendorSheet_(ss) {
  const sh = ss.getSheetByName(S.VEND);
  if (!sh || sh.getLastRow() < 2) return;

  const n = sh.getLastRow() - 1;
  const c3 = sh.getRange(2, 3, n, 1).getValues();
  const c4 = sh.getRange(2, 4, n, 1).getValues();
  const count = function (col) {
    return col.filter(function (r) { return 区分一覧.indexOf(String(r[0] || '').trim()) >= 0; }).length;
  };
  const in3 = count(c3), in4 = count(c4);

  if (in4 > 0 && in4 > in3) {          // 区分が4列目にある＝入れ替わっている
    sh.getRange(2, 3, n, 1).setValues(c4);
    sh.getRange(2, 4, n, 1).setValues(c3);
    sh.getRange(2, 4, Math.max(sh.getMaxRows() - 1, 1), 1).clearDataValidations();
    SpreadsheetApp.getActive().toast('業者マスターの「区分」と「よみ」を正しい列に入れ替えました', '参加率アプリ', 8);
  }
}

function setDropdown_(sh, col, list) {
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(false).build();
  sh.getRange(2, col, Math.max(sh.getMaxRows() - 1, 1), 1).setDataValidation(rule);
}

/** 手でマスターを直したときも集計を追いかける */
function onEditHandler(e) {
  try {
    const name = e.range.getSheet().getName();
    if ([S.PROJ, S.VEND, S.LEAD, S.JOIN, S.REPORT, S.COST, S.REC].indexOf(name) >= 0) recalc();
  } catch (err) { /* 編集のたびに止まらないよう握りつぶす */ }
}


/* ====================================================================
 * ▼ ウェブアプリの入口（アプリ画面はここに投げる）
 * ==================================================================== */

/**
 * GET：マスターの読み出し（アプリの選択肢用）と疎通確認
 *   ?action=ping
 *   ?action=masters                    → 業者一覧・プロジェクト一覧・リーダー一覧
 *   ?action=summary                    → 集計・判定の中身（判定表）
 *   ?action=participants&projectId=P001 → そのプロジェクトに参加した業者だけ
 */
function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    checkToken_(p);
    switch (p.action) {
      case 'ping':    return json_({ ok: true, message: 'pong', time: today_() });
      case 'masters': return json_({ ok: true, data: getMasters_() });
      case 'summary': return json_({ ok: true, data: getSummary_() });
      case 'participants': return json_({ ok: true, data: getParticipants_(p.projectId) });
      default:        return json_({ ok: false, error: 'action が不明です（ping / masters / summary / participants）' });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

/**
 * POST：書き込み
 *   本文は JSON（Content-Type: text/plain 推奨）。action で処理を振り分ける。
 *     action = "createProject"  プロジェクトを作ってIDを返す
 *     action = "participation"  参加記録を1件足す（参加者アプリ）
 *     action = "report"         メンバー報告を1件足す（メンバーアプリ）
 *     action = "createVendor"   業者を足してIDを返す
 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const body = parseBody_(e);
    checkToken_(body);
    let res;
    switch (body.action) {
      case 'createProject': res = createProject_(body); break;
      case 'createVendor':  res = createVendor_(body);  break;
      case 'participation': res = addParticipation_(body); break;
      case 'report':        res = addReport_(body); break;
      default: throw new Error('action が不明です（createProject / createVendor / participation / report）');
    }
    recalc();                       // 書き込みのたびに集計を作り直す
    return json_(Object.assign({ ok: true }, res));
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

function parseBody_(e) {
  if (e && e.postData && e.postData.contents) {
    try { return JSON.parse(e.postData.contents); } catch (err) { /* フォーム形式かもしれない */ }
  }
  return (e && e.parameter) || {};
}

function checkToken_(p) {
  if (合言葉 && String(p.token || '') !== 合言葉) throw new Error('合言葉が違います');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


/* ====================================================================
 * ▼ 書き込みの中身
 * ==================================================================== */

/** プロジェクトを作る。種別からリーダーを自動で決める。 */
function createProject_(b) {
  const name = must_(b.projectName, 'projectName（プロジェクト名）');
  const type = must_(b.type, 'type（種別）');
  if (種別一覧.indexOf(type) < 0) throw new Error('種別は ' + 種別一覧.join('／') + ' のどれかです');
  const date = b.date ? String(b.date) : today_();

  const sh = sheet_(S.PROJ);
  const id = nextId_(sh, 1, 'P', 3);
  const leader = leaderOf_(type);
  sh.appendRow([id, String(name), type, date, leader]);
  sh.getRange(sh.getLastRow(), 日付列[S.PROJ]).setNumberFormat('@').setValue(date);
  return { projectId: id, leader: leader };
}

/** 業者を足す */
function createVendor_(b) {
  const name = must_(b.vendorName, 'vendorName（業者名）');
  const yomi = String(b.yomi || '').trim();
  const kubun = b.kubun || '会員';
  if (区分一覧.indexOf(kubun) < 0) throw new Error('区分は ' + 区分一覧.join('／') + ' のどちらかです');
  const sh = sheet_(S.VEND);
  const id = nextId_(sh, 1, 'V', 2);
  sh.appendRow([id, String(name), kubun, yomi]);
  return { vendorId: id };
}

/** 参加記録を1件（参加者アプリの「参加した」ボタン） */
function addParticipation_(b) {
  const vendorId  = must_(b.vendorId, 'vendorId（業者ID）');
  const projectId = must_(b.projectId, 'projectId（プロジェクトID）');
  assertExists_(S.VEND, vendorId, '業者ID');
  assertExists_(S.PROJ, projectId, 'プロジェクトID');

  const date = b.date ? String(b.date) : today_();
  const sh = sheet_(S.JOIN);

  // 同じ日・同じ業者・同じプロジェクトの二重押しは弾く
  const rows = values_(sh);
  const dup = rows.some(function (r) {
    return String(r[1]) === date && String(r[2]) === vendorId && String(r[3]) === projectId;
  });
  if (dup) return { joinId: null, duplicated: true, message: 'すでに同じ参加記録があります' };

  const id = nextId_(sh, 1, 'J', 5);
  sh.appendRow([id, date, vendorId, projectId]);
  sh.getRange(sh.getLastRow(), 日付列[S.JOIN]).setNumberFormat('@').setValue(date);
  return { joinId: id, duplicated: false };
}

/**
 * メンバー報告を1件。経費は「経費明細」、良い業者は「推薦記録」に分けて書く。
 * b = { projectId, content, date?, expenses:[{item, amount}], goodVendors:[vendorId] }
 */
function addReport_(b) {
  const projectId = must_(b.projectId, 'projectId（プロジェクトID）');
  const proj = findRow_(S.PROJ, projectId);
  if (!proj) throw new Error('プロジェクトID ' + projectId + ' がマスターにありません');

  const date    = b.date ? String(b.date) : today_();
  const type    = proj[2];
  const leader  = proj[4] || leaderOf_(type);
  const content = String(b.content || '');

  const sh = sheet_(S.REPORT);
  const id = nextId_(sh, 1, 'R', 4);
  sh.appendRow([id, date, projectId, type, leader, content]);
  sh.getRange(sh.getLastRow(), 日付列[S.REPORT]).setNumberFormat('@').setValue(date);

  // 経費（何組でも入る）
  const costs = toArray_(b.expenses).map(function (x) {
    const item = String((x && x.item) || '').trim();
    const amt  = Number((x && x.amount) || 0);
    if (!item && !amt) return null;
    if (isNaN(amt)) throw new Error('経費の金額が数字ではありません：' + JSON.stringify(x));
    return [id, projectId, item, amt];
  }).filter(Boolean);
  if (costs.length) sheet_(S.COST).getRange(sheet_(S.COST).getLastRow() + 1, 1, costs.length, 4).setValues(costs);

  // 良い業者（推薦）。同じ報告内の重複は1回に丸める。
  const goods = [];
  toArray_(b.goodVendors).forEach(function (v) {
    const vid = String(v || '').trim();
    if (!vid || goods.indexOf(vid) >= 0) return;
    assertExists_(S.VEND, vid, '業者ID');
    goods.push(vid);
  });
  if (goods.length) {
    const rows = goods.map(function (v) { return [id, projectId, v]; });
    sheet_(S.REC).getRange(sheet_(S.REC).getLastRow() + 1, 1, rows.length, 3).setValues(rows);
  }

  return { reportId: id, expenseCount: costs.length, goodVendorCount: goods.length };
}


/* ====================================================================
 * ▼ 集計・判定（シート3を丸ごと作り直す）
 * ==================================================================== */

function recalc() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(S.SUM) || ss.insertSheet(S.SUM);
  const d = getSummary_();

  sh.clear();
  let r = 1;

  // --- ① 業者ごとの召集判定 ---
  r = writeBlock_(sh, r,
    '① 業者別 参加・推薦・召集判定',
    ['業者ID', '業者名', '区分', '参加回数', '推薦回数', '召集判定'],
    d.vendors.map(function (v) {
      return [v.id, v.name, v.kubun, v.join, v.rec, v.judge];
    }));
  sh.getRange(r, 1).setValue(
    '判定の見方： ◎＝参加' + 参加召集ライン + '回以上（召集回数に達した） ／ ○＝推薦' +
    推薦優遇ライン + '回以上（召集検討） ／ −＝未達 ／ 対象外＝執行部'
  ).setFontColor('#666666');
  r += 3;

  // --- ② プロジェクトごとの参加回数 ---
  r = writeBlock_(sh, r,
    '② プロジェクト別 参加回数',
    ['プロジェクトID', 'プロジェクト名', '種別', '日付', '参加回数', '経費合計'],
    d.projects.map(function (p) {
      return [p.id, p.name, p.type, p.date, p.join, p.cost];
    }));
  r += 2;

  // --- ③ 種別ごとの集計 ---
  r = writeBlock_(sh, r,
    '③ 種別別 集計',
    ['種別', 'リーダー', 'プロジェクト数', '延べ参加回数', '経費合計'],
    d.types.map(function (t) {
      return [t.type, t.leader, t.projects, t.join, t.cost];
    }));
  r += 2;

  // --- ④ 経費の名目別 ---
  r = writeBlock_(sh, r,
    '④ 経費 名目別 集計',
    ['使途（名目）', '件数', '合計金額'],
    d.costItems.map(function (c) { return [c.item, c.count, c.sum]; }));

  sh.autoResizeColumns(1, 6);
  sh.getRange(1, 1).setValue('① 業者別 参加・推薦・召集判定');
  ss.toast('集計を更新しました（' + Utilities.formatDate(new Date(), TZ, 'H:mm') + '）', '参加率アプリ', 3);
}

function writeBlock_(sh, row, title, header, rows) {
  sh.getRange(row, 1).setValue(title).setFontWeight('bold').setFontSize(12);
  row += 1;
  sh.getRange(row, 1, 1, header.length).setValues([header])
    .setFontWeight('bold').setBackground('#e8eaed');
  row += 1;
  if (rows.length) {
    sh.getRange(row, 1, rows.length, header.length).setValues(rows);
    row += rows.length;
  } else {
    sh.getRange(row, 1).setValue('（データなし）').setFontColor('#999999');
    row += 1;
  }
  return row + 1;
}

/** 集計の中身を作る（シートにもAPIにも同じものを使う） */
function getSummary_() {
  const vendorsRaw  = values_(sheet_(S.VEND));
  const projectsRaw = values_(sheet_(S.PROJ));
  const joins       = values_(sheet_(S.JOIN));
  const recs        = values_(sheet_(S.REC));
  const costs       = values_(sheet_(S.COST));
  const leaders     = leaderMap_();

  // 参加回数（業者別・プロジェクト別）
  const joinByVendor = {}, joinByProject = {};
  joins.forEach(function (r) {
    const v = String(r[2] || ''), p = String(r[3] || '');
    if (v) joinByVendor[v] = (joinByVendor[v] || 0) + 1;
    if (p) joinByProject[p] = (joinByProject[p] || 0) + 1;
  });

  // 推薦回数（業者別）
  const recByVendor = {};
  recs.forEach(function (r) {
    const v = String(r[2] || '');
    if (v) recByVendor[v] = (recByVendor[v] || 0) + 1;
  });

  // 経費（プロジェクト別・名目別）
  const costByProject = {}, costByItem = {};
  costs.forEach(function (r) {
    const p = String(r[1] || ''), item = String(r[2] || '（名目なし）'), amt = Number(r[3] || 0);
    costByProject[p] = (costByProject[p] || 0) + amt;
    if (!costByItem[item]) costByItem[item] = { count: 0, sum: 0 };
    costByItem[item].count += 1;
    costByItem[item].sum += amt;
  });

  // 業者の判定
  const vendors = vendorsRaw.filter(function (r) { return String(r[0] || '').trim(); }).map(function (r) {
    const id = String(r[0]).trim();
    const kubun = String(r[2] || '会員').trim();
    const j = joinByVendor[id] || 0;
    const c = recByVendor[id] || 0;
    let judge;
    if (kubun === '執行部')            judge = '対象外';
    else if (j >= 参加召集ライン)      judge = '◎';   // 回数該当を優先
    else if (c >= 推薦優遇ライン)      judge = '○';
    else                               judge = '−';
    return { id: id, name: String(r[1] || ''), yomi: String(r[3] || ''), kubun: kubun, join: j, rec: c, judge: judge };
  }).sort(function (a, b) {
    return (b.join - a.join) || (b.rec - a.rec) || a.id.localeCompare(b.id);
  });

  // プロジェクト
  const projects = projectsRaw.filter(function (r) { return String(r[0] || '').trim(); }).map(function (r) {
    const id = String(r[0]).trim();
    return {
      id: id, name: String(r[1] || ''), type: String(r[2] || ''), date: String(r[3] || ''),
      leader: String(r[4] || ''), join: joinByProject[id] || 0, cost: costByProject[id] || 0
    };
  });

  // 種別
  const types = 種別一覧.map(function (t) {
    const ps = projects.filter(function (p) { return p.type === t; });
    return {
      type: t,
      leader: leaders[t] || '',
      projects: ps.length,
      join: ps.reduce(function (s, p) { return s + p.join; }, 0),
      cost: ps.reduce(function (s, p) { return s + p.cost; }, 0)
    };
  });

  // 経費の名目別（金額の大きい順）
  const costItems = Object.keys(costByItem).map(function (k) {
    return { item: k, count: costByItem[k].count, sum: costByItem[k].sum };
  }).sort(function (a, b) { return b.sum - a.sum; });

  return {
    vendors: vendors,
    projects: projects,
    types: types,
    costItems: costItems,
    lines: { 参加召集ライン: 参加召集ライン, 推薦優遇ライン: 推薦優遇ライン },
    召集報告リスト: vendors.filter(function (v) { return v.judge === '◎'; }).map(function (v) { return v.name; }),
    召集検討リスト: vendors.filter(function (v) { return v.judge === '○'; }).map(function (v) { return v.name; })
  };
}


/* ====================================================================
 * ▼ 小さな道具
 * ==================================================================== */

function sheet_(name) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('シート「' + name + '」がありません。メニューの［① 初期セットアップ］を先に実行してください。');
  return sh;
}

/** 見出し行を除いた中身。空なら空配列。 */
function values_(sh) {
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
}

function findRow_(sheetName, id) {
  const rows = values_(sheet_(sheetName));
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === String(id).trim()) return rows[i];
  }
  return null;
}

function assertExists_(sheetName, id, label) {
  if (!findRow_(sheetName, id)) throw new Error(label + ' ' + id + ' がマスターにありません');
}

/** P001 / V01 / R0001 のような連番を作る */
function nextId_(sh, col, prefix, digits) {
  const rows = values_(sh);
  let max = 0;
  rows.forEach(function (r) {
    const s = String(r[col - 1] || '');
    if (s.indexOf(prefix) === 0) {
      const n = parseInt(s.slice(prefix.length), 10);
      if (!isNaN(n) && n > max) max = n;
    }
  });
  return prefix + String(max + 1).padStart(digits, '0');
}

function leaderMap_() {
  const m = {};
  values_(sheet_(S.LEAD)).forEach(function (r) {
    if (String(r[0] || '').trim()) m[String(r[0]).trim()] = String(r[1] || '').trim();
  });
  return m;
}

function leaderOf_(type) { return leaderMap_()[type] || ''; }

function getMasters_() {
  return {
    vendors: sortByYomi_(values_(sheet_(S.VEND)).filter(function (r) { return String(r[0] || '').trim(); })
      .map(function (r) {
        return { vendorId: String(r[0]).trim(), vendorName: String(r[1] || ''), yomi: String(r[3] || ''), kubun: String(r[2] || '') };
      })),
    projects: values_(sheet_(S.PROJ)).filter(function (r) { return String(r[0] || '').trim(); })
      .map(function (r) {
        return { projectId: String(r[0]).trim(), projectName: String(r[1] || ''), type: String(r[2] || ''), date: String(r[3] || ''), leader: String(r[4] || '') };
      }),
    leaders: leaderMap_(),
    種別一覧: 種別一覧
  };
}

/**
 * そのプロジェクトに参加した業者だけを返す（メンバーアプリ用）
 * ?action=participants&projectId=P001
 */
function getParticipants_(projectId) {
  const pid = must_(projectId, 'projectId（プロジェクトID）');
  const proj = findRow_(S.PROJ, pid);
  if (!proj) throw new Error('プロジェクトID ' + pid + ' がマスターにありません');

  // 業者マスターを引ける形にする
  const vmap = {};
  values_(sheet_(S.VEND)).forEach(function (r) {
    const id = String(r[0] || '').trim();
    if (id) vmap[id] = { vendorName: String(r[1] || ''), yomi: String(r[3] || ''), kubun: String(r[2] || '') };
  });

  // このプロジェクトの参加記録だけ拾って業者ごとにまとめる
  const acc = {};
  values_(sheet_(S.JOIN)).forEach(function (r) {
    if (String(r[3] || '').trim() !== pid) return;
    const vid = String(r[2] || '').trim();
    if (!vid) return;
    if (!acc[vid]) acc[vid] = { count: 0, dates: [] };
    acc[vid].count += 1;
    if (r[1]) acc[vid].dates.push(String(r[1]));
  });

  // すでに推薦されている業者（メンバーアプリで初期チェックを入れたいとき用）
  const already = {};
  values_(sheet_(S.REC)).forEach(function (r) {
    if (String(r[1] || '').trim() === pid) already[String(r[2] || '').trim()] = true;
  });

  const participants = sortByYomi_(Object.keys(acc).map(function (vid) {
    const m = vmap[vid] || { vendorName: '（マスター未登録）', yomi: '', kubun: '' };
    const dates = acc[vid].dates;
    return {
      vendorId: vid,
      vendorName: m.vendorName,
      yomi: m.yomi,
      kubun: m.kubun,
      参加回数: acc[vid].count,
      初回日付: dates.length ? dates[0] : '',
      最終日付: dates.length ? dates[dates.length - 1] : '',
      推薦ずみ: !!already[vid]
    };
  }));

  return {
    projectId: pid,
    projectName: String(proj[1] || ''),
    type: String(proj[2] || ''),
    date: String(proj[3] || ''),
    leader: String(proj[4] || ''),
    participantCount: participants.length,
    participants: participants
  };
}

/** よみの50音順に並べる。よみが空のものは後ろにまわし、業者名で並べる。 */
function sortByYomi_(list) {
  return list.sort(function (a, b) {
    const ay = String(a.yomi || '').trim(), by = String(b.yomi || '').trim();
    if (ay && !by) return -1;
    if (!ay && by) return 1;
    const ka = ay || String(a.vendorName || ''), kb = by || String(b.vendorName || '');
    return ka.localeCompare(kb, 'ja');
  });
}

function today_() { return Utilities.formatDate(new Date(), TZ, 日付形式); }

function must_(v, label) {
  const s = String(v == null ? '' : v).trim();
  if (!s) throw new Error(label + ' が足りません');
  return s;
}

function toArray_(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch (e) { return []; } }
  return [];
}
