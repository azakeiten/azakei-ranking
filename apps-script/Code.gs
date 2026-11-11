/**
 * AZAKEI 本日の億万長者 — 記録の保存先（Google Apps Script）
 *
 * このスクリプトは、ランキング用スプレッドシートの「拡張機能 → Apps Script」に貼り付けて使います。
 * 手順は README.md の「記録の保存先をつくる」を見てください。
 *
 * 管理者の合言葉は「プロジェクトの設定 → スクリプト プロパティ」に
 *   ADMIN_PASS = （好きな合言葉）
 * として登録します。コードには書きません。
 */

const SHEET_NAME = "記録";
const HEADER = ["id", "名前", "枚数", "日付", "登録時刻"];
const CACHE_KEY = "entries-v1";
const CACHE_SECONDS = 4;

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEADER);
    sh.setFrozenRows(1);
  }
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function dateText_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, "Asia/Tokyo", "yyyy-MM-dd");
  return String(v || "");
}

function readEntries_() {
  const values = sheet_().getDataRange().getValues();
  return values.slice(1)
    .filter(function (r) { return r[0]; })
    .map(function (r) {
      return { id: String(r[0]), name: String(r[1]), chips: Number(r[2]) || 0, date: dateText_(r[3]), createdAt: Number(r[4]) || 0 };
    });
}

/** ランキングを読む（だれでも） */
function doGet() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(CACHE_KEY);
  if (hit) return ContentService.createTextOutput(hit).setMimeType(ContentService.MimeType.JSON);
  const body = JSON.stringify({ ok: true, entries: readEntries_() });
  if (body.length < 90000) cache.put(CACHE_KEY, body, CACHE_SECONDS);
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
}

/** 記録を足す・消す（合言葉が必要） */
function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: "bad_request" }); }

  const pass = PropertiesService.getScriptProperties().getProperty("ADMIN_PASS");
  if (!pass) return json_({ ok: false, error: "no_pass_set" });
  if (String(req.pass || "") !== pass) return json_({ ok: false, error: "wrong_pass" });

  if (req.action === "check") return json_({ ok: true });

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return json_({ ok: false, error: "busy" });
  try {
    const sh = sheet_();
    if (req.action === "add") {
      const name = String(req.name || "").trim().slice(0, 20);
      const chips = Math.floor(Number(req.chips));
      const date = String(req.date || "");
      if (!name) return json_({ ok: false, error: "no_name" });
      if (!isFinite(chips) || chips < 0 || chips > 99999) return json_({ ok: false, error: "bad_chips" });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json_({ ok: false, error: "bad_date" });
      const entry = { id: Utilities.getUuid().slice(0, 8), name: name, chips: chips, date: date, createdAt: Date.now() };
      // 先頭の ' は「文字としてそのまま入れる」という意味（数式や日付に変わらないように）
      sh.appendRow([entry.id, "'" + entry.name, entry.chips, "'" + entry.date, entry.createdAt]);
      CacheService.getScriptCache().remove(CACHE_KEY);
      return json_({ ok: true, entry: entry });
    }
    if (req.action === "delete") {
      const id = String(req.id || "");
      const ids = sh.getRange(1, 1, sh.getLastRow(), 1).getValues();
      for (let i = ids.length - 1; i >= 1; i--) {
        if (String(ids[i][0]) === id) { sh.deleteRow(i + 1); break; }
      }
      CacheService.getScriptCache().remove(CACHE_KEY);
      return json_({ ok: true });
    }
    return json_({ ok: false, error: "bad_action" });
  } finally {
    lock.releaseLock();
  }
}
