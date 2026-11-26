// My Pick 서버 — 익명으로 함께 고르는 My Pick (따로 설치할 것 없음, Node 22.13 이상만 있으면 돼요)
//
// 공정성 · 비밀 보장을 위해 지키는 것
//  - ‘누가 픽했는지’(participation)와 ‘무엇을 골랐는지’(options.votes 숫자)를 따로 저장해요.
//    표 한 장 한 장은 남기지 않고 숫자만 올려서, 관리자도 · 저장 파일을 열어도 누가 무엇을 골랐는지 알 수 없어요.
//  - 한 사람 한 주제 한 표: participation 의 (주제, 참여자) 가 겹치면 저장이 거부돼요.
//  - 픽 받는 중 결과는 방 설정에서 ‘실시간 공개’를 켠 방만 보여 줘요. 꺼져 있으면 관리자도 마감 전에는 못 봐요.
//  - 마감된 주제는 고치거나 지울 수 없고, 관리자가 한 일은 앞뒤가 이어진 기록(audit)으로 남아요.
//
// 환경 변수는 .env.example 에 설명이 있어요.
//   --api-only   화면 파일은 안 보여 주고 /api · /uploads 만 (개발 서버용)
import { createServer } from 'node:http'
import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import { createHash, createHmac, randomBytes, randomInt, scrypt, scryptSync, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { AsyncLocalStorage } from 'node:async_hooks'
import { brotliCompressSync, gzipSync } from 'node:zlib'
import { DatabaseSync } from 'node:sqlite'

const env = process.env
const num = (v, d, min, max) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Number(v))) : d)

const LISTEN = num(env.LISTEN_PORT, 8080, 1, 65535)
const STATIC = resolve(env.STATIC_DIR || 'dist')
const DATA = resolve(env.DATA_DIR || 'data')
const UPLOADS = join(DATA, 'uploads')
const API_ONLY = process.argv.includes('--api-only')
const TRUST_PROXY = env.TRUST_PROXY === '1'
const SITE_URL = (env.SITE_URL || '').replace(/\/+$/, '')

const ADMIN_ID = env.ADMIN_ID || 'admin'
const ADMIN_PASSWORD = env.ADMIN_PASSWORD || ''
const ENABLED = ADMIN_PASSWORD.length >= 8

const ORG_NAME = (env.ORG_NAME || 'My Pick').slice(0, 40)
const DEFAULT_SECONDS = Math.round(num(env.DEFAULT_VOTE_SECONDS, 60, 0, 3600))
const DEFAULT_GRACE = Math.round(num(env.DEFAULT_GRACE_SECONDS, 15, 3, 600))
const LOCK_AFTER = num(env.LOGIN_LOCK_AFTER, 5, 3, 50)
const LOCK_MS = num(env.LOGIN_LOCK_MINUTES, 10, 1, 1440) * 60_000
const JOIN_LOCK_AFTER = num(env.JOIN_LOCK_AFTER, 10, 3, 100)
const JOIN_LOCK_MS = num(env.JOIN_LOCK_SECONDS, 60, 10, 3600) * 1000
const ADMIN_SESSION_MS = num(env.ADMIN_SESSION_HOURS, 12, 1, 168) * 3_600_000
// 참여자 세션은 기본 7일: 며칠에 걸친 픽에서도 같은 사람으로 남아야 한 표만 낼 수 있어요
const VOTER_SESSION_MS = num(env.VOTER_SESSION_HOURS, 168, 1, 720) * 3_600_000
const MAX_LOGO = num(env.MAX_LOGO_MB, 2, 0.1, 10) * 1024 * 1024
const MAX_STREAMS = num(env.MAX_CONNECTIONS, 2000, 10, 50_000)
// 누구나 방 만들기 (방장). 끄려면 PUBLIC_ROOMS=0
const PUBLIC_ROOMS = env.PUBLIC_ROOMS !== '0'
const KEEP_DAYS = Math.round(num(env.ROOM_KEEP_DAYS, 7, 1, 365))
const ROOMS_PER_HOUR = num(env.PUBLIC_ROOMS_PER_HOUR, 5, 1, 1000)
const MAX_PUBLIC_ROOMS = num(env.MAX_PUBLIC_ROOMS, 200, 1, 100_000)
// 소스 코드 주소 (AGPL: 서비스를 쓰는 사람이 소스를 받을 수 있어야 해요) · 하루 한 번 백업을 며칠치 둘지 (0 이면 끔)
// 운영하는 곳의 연락처 (이용약관 · 개인정보 처리방침에 나와요). 예: 전화번호나 이메일
const CONTACT = (env.CONTACT || '').slice(0, 100)
const SOURCE_URL = /^https?:\/\//.test(env.SOURCE_URL || '') ? env.SOURCE_URL.slice(0, 200) : ''
const BACKUP_KEEP = Math.round(num(env.BACKUP_KEEP_DAYS, 7, 0, 365))
// 마감 뒤 확인 요청을 받을 시간(분). 0 이면 받지 않아요
const OBJECT_MS = num(env.OBJECTION_MINUTES, 10, 0, 1440) * 60_000
const HOST_SESSION_MS = num(env.HOST_SESSION_HOURS, 24, 1, 720) * 3_600_000

const BOOT = Date.now()
const VERSION = '0.2.0'

// ── 저장 (SQLite) ────────────────────────────────────────
mkdirSync(UPLOADS, { recursive: true })
const BACKUPS = join(DATA, 'backups')
mkdirSync(BACKUPS, { recursive: true })
// 되돌리기: 관리자가 고른 백업이 restore-pending.db 로 놓여 있으면, 지금 파일을 옆으로 치우고 그것으로 켜요.
const DB_FILE = join(DATA, 'mypick.db')
const PENDING = join(DATA, 'restore-pending.db')
let restoredFrom = null
if (existsSync(PENDING)) {
  if (existsSync(DB_FILE)) renameSync(DB_FILE, join(BACKUPS, `before-restore-${new Date().toISOString().replace(/[:.]/g, '-')}.db`))
  for (const ext of ['-wal', '-shm']) rmSync(DB_FILE + ext, { force: true })
  renameSync(PENDING, DB_FILE)
  restoredFrom = existsSync(PENDING + '.txt') ? readFileSync(PENDING + '.txt', 'utf8') : '?'
  rmSync(PENDING + '.txt', { force: true })
}
const db = new DatabaseSync(DB_FILE)
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA secure_delete = ON;
  -- id 는 지운 뒤에도 다시 쓰지 않아요 (AUTOINCREMENT). 기록(audit)의 방 · 주제 번호가 나중에 다른 것을 가리키면 안 되니까요.
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, screen_key TEXT NOT NULL, title TEXT NOT NULL,
    pass_hash TEXT, mode TEXT NOT NULL CHECK (mode IN ('simple','strict')),
    capacity INTEGER NOT NULL DEFAULT 0, live INTEGER NOT NULL DEFAULT 0,
    seconds INTEGER NOT NULL, grace INTEGER NOT NULL, close_all INTEGER NOT NULL DEFAULT 1,
    locked INTEGER NOT NULL DEFAULT 0, closed INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT, room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    pos INTEGER NOT NULL, title TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
    max_pick INTEGER NOT NULL DEFAULT 1, seconds INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed')),
    opened_at INTEGER, closes_at INTEGER, closed_at INTEGER, reason TEXT,
    voted INTEGER NOT NULL DEFAULT 0, eligible INTEGER NOT NULL DEFAULT 0, abstain INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS options (
    id INTEGER PRIMARY KEY, item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    pos INTEGER NOT NULL, label TEXT NOT NULL, votes INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS voters (
    id INTEGER PRIMARY KEY AUTOINCREMENT, room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS codes (
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, code TEXT NOT NULL,
    voter_id INTEGER REFERENCES voters(id) ON DELETE SET NULL, PRIMARY KEY (room_id, code)
  ) WITHOUT ROWID;
  -- 누가 픽했는지만 (무엇을 골랐는지는 여기 없어요). 넣은 순서가 남지 않게 WITHOUT ROWID.
  CREATE TABLE IF NOT EXISTS participation (
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    voter_id INTEGER NOT NULL REFERENCES voters(id) ON DELETE CASCADE, PRIMARY KEY (item_id, voter_id)
  ) WITHOUT ROWID;
  -- 더한 관리자 (.env 의 관리자는 최고 관리자로 여기 없어요)
  CREATE TABLE IF NOT EXISTS admins (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
  -- 신고: 방이 지워져도 남게 방 이름 · 번호를 같이 적어요. 누가 신고했는지는 ‘같은 사람이 두 번 못 하게’ 번호만.
  CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, room_id INTEGER, room_code TEXT NOT NULL, room_title TEXT NOT NULL, reason TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL, handled INTEGER NOT NULL DEFAULT 0, voter_id INTEGER);
  -- 방 만들기를 막은 곳 (접속 주소를 알아볼 수 없게 바꾼 값)
  CREATE TABLE IF NOT EXISTS blocks (creator TEXT PRIMARY KEY, at INTEGER NOT NULL, why TEXT NOT NULL DEFAULT '');
  -- 주제 묶음 (관리자들이 같이 써요)
  CREATE TABLE IF NOT EXISTS bundles (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, items TEXT NOT NULL, updated_at INTEGER NOT NULL);
  -- 날마다 세는 숫자 (방이 지워져도 통계는 남게). 누가 무엇을 골랐는지와는 상관없는 합계만.
  CREATE TABLE IF NOT EXISTS stats (day TEXT PRIMARY KEY, rooms INTEGER NOT NULL DEFAULT 0, voters INTEGER NOT NULL DEFAULT 0, items INTEGER NOT NULL DEFAULT 0, votes INTEGER NOT NULL DEFAULT 0, eligible INTEGER NOT NULL DEFAULT 0);
  -- 확인 요청: 마감 뒤 정한 시간 동안 참여자가 익명으로 한 번. 누가 냈는지는 ‘두 번 못 내게’ 번호만.
  CREATE TABLE IF NOT EXISTS objections (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE, voter_id INTEGER NOT NULL, note TEXT NOT NULL, at INTEGER NOT NULL, UNIQUE (item_id, voter_id));
  -- 오류 제보: 누구나 보내요. 이름 · 연락처 · 접속 주소는 받지 않아요 (어느 화면 · 어떤 브라우저인지만 같이).
  CREATE TABLE IF NOT EXISTS feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, kind TEXT NOT NULL, note TEXT NOT NULL, page TEXT NOT NULL DEFAULT '', ua TEXT NOT NULL DEFAULT '');
  CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL, hash TEXT NOT NULL);
`)

const stmts = new Map()
const sql = (s) => stmts.get(s) ?? (stmts.set(s, db.prepare(s)), stmts.get(s))
const get = (s, ...a) => sql(s).get(...a)
const all = (s, ...a) => sql(s).all(...a)
const run = (s, ...a) => sql(s).run(...a)
let inTx = false
function tx(fn) {
  if (inTx) return fn()
  db.exec('BEGIN IMMEDIATE')
  inTx = true
  try {
    const r = fn()
    db.exec('COMMIT')
    return r
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  } finally {
    inTx = false
  }
}

// 방장 기능에 필요한 칸 (이미 만들어진 저장 파일에도 붙여요)
//   archived: 보관함 · logo/tone: 방마다 로고와 색 · screen_mode/screen_notice: 큰 화면에 띄울 것
//   주제: memo 진행자 메모 · nudge_at 독려 알림 · quorum 최소 참여 인원 · basis 통과를 따질 기준 인원
//   cohost_hash: 공동 진행자 비밀번호   creator: 방을 만든 접속 주소를 알아볼 수 없게 바꾼 값 (차단에만 써요)
//   owner: 'admin' 관리자가 만든 방 · 'host' 누구나 만든 방   host_hash: 방장 비밀번호   active_at: 마지막으로 쓴 시각
{
  const cols = new Set(all('PRAGMA table_info(rooms)').map((c) => c.name))
  for (const [col, def] of [['owner', "TEXT NOT NULL DEFAULT 'admin'"], ['host_hash', 'TEXT'], ['active_at', 'INTEGER NOT NULL DEFAULT 0'], ['cohost_hash', 'TEXT'], ['creator', 'TEXT'], ['archived', 'INTEGER NOT NULL DEFAULT 0'], ['logo', 'TEXT'], ['tone', "TEXT NOT NULL DEFAULT ''"], ['easy', 'INTEGER NOT NULL DEFAULT 0'], ['screen_mode', "TEXT NOT NULL DEFAULT 'auto'"], ['screen_notice', "TEXT NOT NULL DEFAULT ''"], ['rehearsal', 'INTEGER'], ['observer_key', 'TEXT']]) if (!cols.has(col)) db.exec(`ALTER TABLE rooms ADD COLUMN ${col} ${def}`)
  if (!all('PRAGMA table_info(codes)').some((c) => c.name === 'reopen')) db.exec('ALTER TABLE codes ADD COLUMN reopen INTEGER NOT NULL DEFAULT 0') // 쓴 코드를 진행자가 한 번 더 열어 줬는지
  if (!all('PRAGMA table_info(voters)').some((c) => c.name === 'bot')) db.exec('ALTER TABLE voters ADD COLUMN bot INTEGER NOT NULL DEFAULT 0') // 리허설 방의 가짜 참여자
  // 방: rehearsal 리허설 방이면 원래 방 번호(id) · observer_key 지켜보기 주소의 열쇠   주제: shuffle 선택지 순서를 사람마다 섞기
  // 주제: open_at 예약해 둔 여는 때 · close_at 예약해 둔 마감 때 (있으면 ‘모두 픽함’으로 일찍 닫지 않아요)
  if (!all('PRAGMA table_info(blocks)').some((c) => c.name === 'until')) db.exec('ALTER TABLE blocks ADD COLUMN until INTEGER') // 막는 기간의 끝 (없으면 계속)
  // 주제: proof 결과 확인 코드 (마감하는 순간의 결과로 만든 12자리)
  // 주제: rule 통과 기준 ('none' · 'majority' 절반 넘게 · 'two_thirds' 3분의 2)   practice 연습 픽
  const icols = new Set(all('PRAGMA table_info(items)').map((c) => c.name))
  // 주제: paused 쉬어 가는 중이면 1, paused_left 멈춘 순간 남아 있던 시간(밀리초, 제한 시간이 없으면 NULL)
  for (const [col, def] of [['paused', 'INTEGER NOT NULL DEFAULT 0'], ['paused_left', 'INTEGER'], ['rule', "TEXT NOT NULL DEFAULT 'none'"], ['practice', 'INTEGER NOT NULL DEFAULT 0'], ['proof', 'TEXT'], ['open_at', 'INTEGER'], ['close_at', 'INTEGER'], ['memo', "TEXT NOT NULL DEFAULT ''"], ['nudge_at', 'INTEGER'], ['quorum', 'INTEGER NOT NULL DEFAULT 0'], ['basis', "TEXT NOT NULL DEFAULT 'voted'"], ['shuffle', 'INTEGER NOT NULL DEFAULT 0']]) if (!icols.has(col)) db.exec(`ALTER TABLE items ADD COLUMN ${col} ${def}`)
}

// ── 백업 ─────────────────────────────────────────────────
// 하루에 한 번 저장 파일을 통째로 떠 둬요 (DATA/backups/mypick-날짜.db, 최근 BACKUP_KEEP 일치).
// 지워진 방도 백업 안에는 그 기간만큼 남아 있어요.
const BACKUP_NAME = /^mypick-\d{4}-\d{2}-\d{2}(-\d{6})?\.db$/
const backupFiles = () => readdirSync(BACKUPS).filter((f) => BACKUP_NAME.test(f)).sort()
function backup(now = false) {
  if (!BACKUP_KEEP && !now) return null
  const stamp = new Date().toISOString()
  const name = `mypick-${stamp.slice(0, 10)}${now ? '-' + stamp.slice(11, 19).replaceAll(':', '') : ''}.db`
  const file = join(BACKUPS, name)
  if (!existsSync(file)) db.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`)
  // 날마다 뜬 것은 BACKUP_KEEP 개, 손으로 뜬 것까지 합쳐 10개 더 둬요
  const old = backupFiles()
  for (const f of old.slice(0, Math.max(0, old.length - (BACKUP_KEEP + 10)))) unlinkSync(join(BACKUPS, f))
  return name
}
backup()
setInterval(backup, 3_600_000).unref()
const today = () => new Date().toISOString().slice(0, 10)
const bumpStat = (col, n = 1) => run(`INSERT INTO stats(day, ${col}) VALUES(?, ?) ON CONFLICT(day) DO UPDATE SET ${col}=${col}+excluded.${col}`, today(), n) // col 은 코드에 적힌 이름만 들어와요
const touch = (roomId) => run('UPDATE rooms SET active_at=? WHERE id=?', Date.now(), roomId)

const setting = (k, d = '') => get('SELECT value FROM settings WHERE key=?', k)?.value ?? d
const setSetting = (k, v) => run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, v)
const org = () => ({ name: setting('org', ORG_NAME), logo: setting('logo') || null, open: PUBLIC_ROOMS, keepDays: KEEP_DAYS, source: SOURCE_URL, contact: CONTACT, voterDays: Math.round(VOTER_SESSION_MS / 86_400_000), backupDays: BACKUP_KEEP, objectMinutes: Math.round(OBJECT_MS / 60_000), seconds: DEFAULT_SECONDS, grace: DEFAULT_GRACE })

// ── 지울 수 없는 기록 ─────────────────────────────────────
// 줄마다 바로 앞 줄의 해시를 넣어 만들어서, 중간 줄을 고치거나 빼면 그 뒤가 모두 어긋나요.
const sha = (s) => createHash('sha256').update(String(s)).digest('hex')
// 기록을 봉하는 해시: AUDIT_SECRET 이 있으면 열쇠를 섞어요(HMAC). 저장 파일 · 백업만 가진 사람은 맞는 해시를 새로 만들 수 없어요.
const AUDIT_SECRET = env.AUDIT_SECRET || ''
const seal = (s) => (AUDIT_SECRET ? createHmac('sha256', AUDIT_SECRET).update(String(s)).digest('hex') : sha(s))
/** 지금 요청을 보낸 사람 (관리자 이름 · ‘방장’ · ‘공동 진행자’). 기록에 ‘누가’로 남아요. */
const actor = new AsyncLocalStorage()
function audit(action, detail = {}) {
  const by = actor.getStore()
  if (by && !('누가' in detail)) detail = { 누가: by, ...detail }
  const prev = get('SELECT hash FROM audit ORDER BY id DESC LIMIT 1')?.hash ?? ''
  const at = Date.now()
  const text = JSON.stringify(detail)
  run('INSERT INTO audit(at,action,detail,hash) VALUES(?,?,?,?)', at, action, text, seal(`${prev}|${at}|${action}|${text}`))
}
// ponytail: 볼 때마다 처음부터 다시 계산해요 (줄마다 해시 한 번). 기록이 수십만 줄을 넘어 느려지면 확인한 곳까지를 메모리에 기억해 두세요.
function auditIntact() {
  let prev = ''
  let ok = true
  for (const r of all('SELECT * FROM audit ORDER BY id')) {
    if (r.hash !== seal(`${prev}|${r.at}|${r.action}|${r.detail}`)) {
      ok = false
      break
    }
    prev = r.hash
  }
  intactSeen = { at: Date.now(), ok }
  return ok
}
// 누구나 부를 수 있는 곳(결과 확인 · 지켜보기)은 10초 안에 본 결과를 다시 써요.
// 결과 확인 코드는 큰 화면에 공개되고, 학교는 여럿이 한 인터넷 주소를 써서 주소마다 횟수를 막을 수도 없어요.
// 이렇게 해 두면 누가 마구 불러도 기록 전체를 매번 다시 계산하느라 서버가 붙잡히지 않아요. 관리자 화면은 늘 처음부터 다시 봐요.
let intactSeen = { at: 0, ok: true }
const auditIntactSoon = () => (Date.now() - intactSeen.at < 10_000 ? intactSeen.ok : auditIntact())
/** 기록 지문: 맨 끝 줄 해시의 앞 12자리. 서버 밖(인쇄물 · 사진)에 적어 두면, 나중에 그 줄이 그대로 있는지 견줄 수 있어요. */
const markOf = (hash) => hash.slice(0, 12).toUpperCase().replace(/(.{4})(?=.)/g, '$1-')
function auditMark() {
  const last = get('SELECT id, hash FROM audit ORDER BY id DESC LIMIT 1')
  return last ? { mark: markOf(last.hash), count: get('SELECT COUNT(*) AS n FROM audit').n } : { mark: '', count: 0 }
}
// 열쇠 없이 쌓인 기록을 열쇠로 한 번 다시 봉해요: node server.mjs --rekey-audit  (옛 방식으로 온전할 때만. 저절로는 하지 않아요)
if (process.argv.includes('--rekey-audit')) {
  if (!AUDIT_SECRET) console.log('.env 에 AUDIT_SECRET 이 없어요')
  else if (auditIntact()) console.log('이미 열쇠로 봉해져 있어요')
  else {
    const rows = all('SELECT * FROM audit ORDER BY id')
    let prev = ''
    const plain = rows.every((r) => r.hash === sha(`${prev}|${r.at}|${r.action}|${r.detail}`) && ((prev = r.hash), true))
    if (!plain) console.log('기록이 옛 방식으로도 어긋나 있어서 다시 봉하지 않았어요')
    else {
      prev = ''
      tx(() => {
        for (const r of rows) run('UPDATE audit SET hash=? WHERE id=?', (prev = seal(`${prev}|${r.at}|${r.action}|${r.detail}`)), r.id)
      })
      console.log(`기록 ${rows.length}줄을 열쇠로 다시 봉했어요`)
    }
  }
  process.exit(0)
}

// ── 공통 ─────────────────────────────────────────────────
class Bad extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
}

// 바깥 서버(글꼴 · 통계)를 하나도 부르지 않아요. 스크립트 · 스타일도 이 사이트의 파일만.
const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'X-Robots-Tag': 'noindex, nofollow',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
}

// 프록시 뒤일 때: X-Forwarded-For 의 맨 끝(우리 프록시가 붙인 것)만 믿어요. 앞쪽은 보내는 사람이 마음대로 적을 수 있어서, 그것을 믿으면 잠금 · 막기를 피해 갈 수 있어요.
const clientIp = (req) => (TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',').at(-1).trim()) || req.socket.remoteAddress || '?'
const isHttps = (req) => req.socket.encrypted || (TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https')
const cookieOf = (req, name) => new RegExp(`(?:^|;\\s*)${name}=([a-f0-9]{64})(?:;|$)`).exec(req.headers.cookie || '')?.[1] ?? null
const setCookie = (req, name, value, maxAgeMs, sameSite) =>
  `${name}=${value}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${Math.floor(maxAgeMs / 1000)}${isHttps(req) ? '; Secure' : ''}`

/** 받는 쪽이 풀 수 있으면 줄여서 보내요 (글자로 된 것만). res.enc 는 요청이 올 때 적어 둔 Accept-Encoding. */
function pack(res, buf, strong = false) {
  const enc = res.enc || ''
  if (buf.length < 1024) return [buf, {}]
  if (strong && /\bbr\b/.test(enc)) return [brotliCompressSync(buf), { 'Content-Encoding': 'br', Vary: 'Accept-Encoding' }]
  if (/\bgzip\b/.test(enc)) return [gzipSync(buf, { level: strong ? 9 : 4 }), { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' }]
  return [buf, {}]
}
function json(res, status, obj, headers = {}) {
  const [out, extra] = pack(res, Buffer.from(JSON.stringify(obj)))
  res.writeHead(status, { ...SECURITY, 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store', ...extra, ...headers })
  res.end(out)
}

/** 몸통 받기. 너무 크면 더 쌓지 않고 끝까지 흘려보낸 뒤 413 */
function readRaw(req, limit) {
  return new Promise((ok, fail) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size <= limit) chunks.push(c)
    })
    req.on('end', () => (size > limit ? fail(new Bad(413, '보낸 내용이 너무 커요')) : ok(Buffer.concat(chunks))))
    req.on('error', fail)
  })
}

async function body(req) {
  if (!String(req.headers['content-type']).startsWith('application/json')) throw new Bad(415, 'JSON 으로 보내 주세요')
  let v
  try {
    v = JSON.parse((await readRaw(req, 64 * 1024)).toString('utf8'))
  } catch (e) {
    throw e instanceof Bad ? e : new Bad(400, '잘못된 요청이에요')
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Bad(400, '잘못된 요청이에요')
  return v
}

// 받은 값 다듬기 (모양이 다르면 400)
const text = (v, name, max, min = 1) => {
  if (typeof v !== 'string') throw new Bad(400, `${name}: 글자로 적어 주세요`)
  const s = v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  if (s.length < min) throw new Bad(400, `${name}: ${min === 1 ? '비어 있어요' : `${min}자 이상 적어 주세요`}`)
  if (s.length > max) throw new Bad(400, `${name}: ${max}자까지 적을 수 있어요`)
  return s
}
const int = (v, name, min, max) => {
  if (!Number.isInteger(v) || v < min || v > max) throw new Bad(400, `${name}: ${min}~${max} 사이 숫자로 적어 주세요`)
  return v
}
const bool = (v) => (v ? 1 : 0)

// ── 여러 번 틀리면 잠그기 ──────────────────────────────────
const fails = new Map() // 열쇠 → { n, until }
function guard(key) {
  const f = fails.get(key)
  if (f && f.until > Date.now()) throw new Bad(429, `너무 많이 틀렸어요. ${Math.ceil((f.until - Date.now()) / 1000)}초 뒤에 다시 해 주세요.`)
}
function failed(key, after, ms) {
  // 주소를 바꿔 가며 메모리를 채우려 할 때: 잠겨 있지 않은 것부터 지워요 (통째로 비우면 걸어 둔 잠금이 다 풀려요)
  if (!fails.has(key) && fails.size >= 10_000) {
    const now = Date.now()
    for (const [k, f] of fails) if (f.until <= now && fails.size >= 5_000) fails.delete(k)
    for (const k of fails.keys()) if (fails.size >= 10_000) fails.delete(k) // 그래도 가득이면 오래된 것부터
  }
  const n = (fails.get(key)?.n ?? 0) + 1
  fails.set(key, n >= after ? { n: 0, until: Date.now() + ms } : { n, until: 0 })
}

// ── 비밀번호 ──────────────────────────────────────────────
const digest = (s) => createHash('sha256').update(String(s)).digest()
const same = (a, b) => timingSafeEqual(digest(a), digest(b))
function hashPass(p) {
  const salt = randomBytes(16)
  return `${salt.toString('hex')}:${scryptSync(p, salt, 32).toString('hex')}`
}
// 확인은 서버를 멈추지 않게 뒤에서 계산해요 (여럿이 한꺼번에 들어올 때 다른 사람의 픽이 밀리지 않게)
const scryptAsync = promisify(scrypt)
async function checkPass(p, stored) {
  const [salt, hash] = String(stored).split(':')
  return timingSafeEqual(await scryptAsync(String(p), Buffer.from(salt, 'hex'), 32), Buffer.from(hash, 'hex'))
}

// ── 관리자 로그인 ─────────────────────────────────────────
const adminSessions = new Map() // 토큰 해시 → { until, name, top }   top: .env 의 최고 관리자
function adminOf(req) {
  const t = cookieOf(req, 'mp_admin')
  const a = t && adminSessions.get(sha(t))
  return a && a.until > Date.now() ? a : null
}
const isAdmin = (req) => !!adminOf(req)
function needAdmin(req) {
  if (!ENABLED || !isAdmin(req)) throw new Bad(401, '관리자 로그인이 필요해요')
}

// ── 방장 (자기 방 하나만 관리) ────────────────────────────
const hostSessions = new Map() // 토큰 해시 → { roomId, until, role }   role: 'host' 방장 · 'cohost' 공동 진행자
function hostOf(req) {
  const t = cookieOf(req, 'mp_host')
  const h = t && hostSessions.get(sha(t))
  return h && h.until > Date.now() ? h : null
}
function hostCookie(req, roomId, role = 'host') {
  const token = randomBytes(32).toString('hex')
  hostSessions.set(sha(token), { roomId, until: Date.now() + HOST_SESSION_MS, role })
  return { 'Set-Cookie': setCookie(req, 'mp_host', token, HOST_SESSION_MS, 'Strict') }
}

// ── 참여자 ────────────────────────────────────────────────
function voterOf(req) {
  const t = cookieOf(req, 'mp_voter')
  const v = t && get('SELECT * FROM voters WHERE token_hash=?', sha(t))
  return v && v.expires_at > Date.now() ? v : null
}

// 접속 상태: 방 → 참여자 → { conns, lastSeen }. 메모리에만 있어요.
// 조용한 손들기: 방 → (참여자 → 'question' | 'more'). 메모리에만 두고 저장하지 않아요. 주제가 열리거나 진행자가 내리면 비워요.
const hands = new Map()
const handAt = new Map() // 참여자 → 마지막으로 누른 때
const presence = new Map()
const seen = (roomId, voterId) => {
  let m = presence.get(roomId)
  if (!m) presence.set(roomId, (m = new Map()))
  let p = m.get(voterId)
  if (!p) m.set(voterId, (p = { conns: 0, lastSeen: Date.now() }))
  return p
}
/** 연결돼 있거나, 끊긴 지 ‘기다리는 시간’이 안 지났으면 자리에 있는 것으로 봐요. 서버가 막 켜졌을 때는 켜진 시각부터 세요. */
function isPresent(room, voterId, now) {
  const p = presence.get(room.id)?.get(voterId)
  if (p?.conns > 0) return true
  return now - (p?.lastSeen ?? BOOT) < room.grace * 1000
}

// ── 실시간 알림 (SSE) ─────────────────────────────────────
// 바뀌었다는 신호만 보내고, 내용은 받는 쪽이 자기 권한으로 다시 읽어 가요.
const streams = new Map() // 방 → Set<res>
let streamCount = 0
const dirty = new Set()
const ping = (roomId) => dirty.add(roomId)
// 누가 픽했거나 들어오고 나간 것처럼 ‘숫자만’ 바뀐 때는 숫자만 실어 보내요. 받는 쪽은 다시 읽지 않고 화면의 숫자만 고쳐요.
const counted = new Set()
const tally = (roomId) => counted.add(roomId)
// ponytail: 방 하나에 0.5초에 한 번만 알려요. 표마다 모두가 다시 읽으니, 수천 명이면 받은 픽 수만 따로 실어 보내는 쪽으로 바꿔요.
setInterval(() => {
  for (const id of dirty) for (const res of streams.get(id) ?? []) res.write('data: 1\n\n')
  for (const id of counted) {
    if (dirty.has(id) || !streams.get(id)?.size) continue
    const room = roomById(id)
    if (!room) continue
    const now = Date.now()
    const voters = all('SELECT id FROM voters WHERE room_id=?', id)
    const v = Object.fromEntries(all("SELECT id FROM items WHERE room_id=? AND status='open'", id).map((it) => [it.id, votedCount(it.id)]))
    const line = `data: ${JSON.stringify({ j: voters.length, p: voters.filter((x) => isPresent(room, x.id, now)).length, v })}\n\n`
    for (const res of streams.get(id)) res.write(line)
  }
  dirty.clear()
  counted.clear()
}, 500).unref()
setInterval(() => {
  for (const set of streams.values()) for (const res of set) res.write(': 살아 있어요\n\n')
}, 25_000).unref()

function openStream(req, res, room, voterId) {
  if (streamCount >= MAX_STREAMS) throw new Bad(503, '지금 접속이 너무 많아요. 잠시 뒤에 다시 해 주세요.')
  const mine = voterId ? seen(room.id, voterId) : null
  if (mine?.conns >= 5) throw new Bad(429, '이 방을 너무 많은 창에서 열었어요. 다른 창을 닫아 주세요.') // 한 사람이 연결 자리를 다 차지하지 못하게
  res.writeHead(200, { ...SECURITY, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' })
  res.write('retry: 2000\n\ndata: 1\n\n')
  let set = streams.get(room.id)
  if (!set) streams.set(room.id, (set = new Set()))
  set.add(res)
  streamCount++
  if (mine) {
    mine.conns++
    tally(room.id)
  }
  // 열 때 잡은 그 기록만 줄여요. (방이 지워진 뒤에 끊기는 연결이 접속 기록을 새로 만들어 숫자를 깎으면 안 돼요)
  res.on('close', () => {
    set.delete(res)
    streamCount--
    if (mine) {
      mine.conns--
      mine.lastSeen = Date.now()
      tally(room.id)
    }
  })
}

// ── 방 · 주제 ─────────────────────────────────────────────
const roomByCode = (code) => (typeof code === 'string' && /^\d{6}$/.test(code) ? get('SELECT * FROM rooms WHERE code=?', code) ?? null : null)
const roomById = (id) => get('SELECT * FROM rooms WHERE id=?', Number(id)) ?? null
const votedCount = (itemId) => get('SELECT COUNT(*) n FROM participation WHERE item_id=?', itemId).n
const joinedCount = (roomId) => get('SELECT COUNT(*) n FROM voters WHERE room_id=?', roomId).n

/**
 * 결과 확인 코드: 마감된 결과 전체(방 번호 · 제목 · 선택지별 받은 픽 · 인원 · 건너뜀 · 시각 · 까닭)를 한 줄로 만들어 해시한 12자리.
 * 마감 때 한 번 만들어 저장하고 화면에 보여 줘요. 나중에 지금 저장된 결과로 다시 만들어 견주면, 숫자가 하나라도 바뀌었는지 알 수 있어요.
 * (참여자가 마감 때 본 코드를 적어 두거나 사진으로 남겨 두는 것이 바깥의 증거가 돼요.)
 */
function proofOf(itemId) {
  const it = get('SELECT i.*, r.code AS room_code FROM items i JOIN rooms r ON r.id=i.room_id WHERE i.id=?', itemId)
  const opts = all('SELECT label, votes FROM options WHERE item_id=? ORDER BY pos', itemId).map((o) => [o.label, o.votes])
  const hash = createHash('sha256').update(JSON.stringify([it.room_code, it.id, it.title, opts, it.voted, it.eligible, it.abstain, it.closed_at, it.reason, it.rule, ...(it.basis !== 'voted' ? [it.basis] : [])])).digest()
  const c = Array.from(hash.subarray(0, 12), (b) => ALPHABET[b % ALPHABET.length]).join('')
  return `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8)}`
}

function closeItem(item, reason) {
  const voted = votedCount(item.id)
  const eligible = joinedCount(item.room_id)
  tx(() => {
    run("UPDATE items SET status='closed', paused=0, paused_left=NULL, closed_at=?, reason=?, voted=?, eligible=? WHERE id=? AND status='open'", Date.now(), reason, voted, eligible, item.id)
    const tally = all('SELECT label, votes FROM options WHERE item_id=? ORDER BY pos', item.id)
    const proof = proofOf(item.id)
    if (!item.practice && !roomById(item.room_id).rehearsal) {
      bumpStat('items')
      bumpStat('votes', voted)
      bumpStat('eligible', eligible)
    }
    run('UPDATE items SET proof=? WHERE id=?', proof, item.id)
    touch(item.room_id)
    audit('주제 마감', { 방: item.room_id, 주제: item.id, 제목: item.title, 연습: !!item.practice, 통과기준: item.rule, 확인코드: proof, 이유: reason, 픽: voted, 참여자: eligible, 건너뜀: get('SELECT abstain FROM items WHERE id=?', item.id).abstain, 결과: tally })
  })
  ping(item.room_id)
}

function openItem(item, room, how) {
  const now = Date.now()
  // 예약 마감이 있으면 그때까지, 없으면 제한 시간만큼
  const until = item.close_at && item.close_at > now ? item.close_at : item.seconds ? now + item.seconds * 1000 : null
  run("UPDATE items SET status='open', opened_at=?, closes_at=?, open_at=NULL WHERE id=?", now, until, item.id)
  hands.delete(room.id) // 새 주제가 열리면 든 손은 모두 내려요
  touch(room.id)
  audit('주제 엶', { 방: room.id, 주제: item.id, 제목: item.title, 방법: how, 제한시간: item.seconds, 선택지: all('SELECT label FROM options WHERE item_id=? ORDER BY pos', item.id).map((o) => o.label) })
  ping(room.id)
}

// 1초마다: 예약한 주제를 열고, 시간이 다 됐거나 자리에 있는 사람이 모두 픽했으면 마감해요.
setInterval(() => {
  const now = Date.now()
  for (const item of all("SELECT * FROM items WHERE status='draft' AND open_at IS NOT NULL AND open_at<=? ORDER BY open_at, pos", now)) {
    const room = roomById(item.room_id)
    if (room.closed) run('UPDATE items SET open_at=NULL WHERE id=?', item.id)
    else if (!get("SELECT 1 x FROM items WHERE room_id=? AND status='open'", room.id) && joinedCount(room.id) >= item.quorum) openItem(item, room, '예약') // 앞 주제가 열려 있으면 끝나는 대로
  }
  // 리허설 방: 가짜 참여자가 1초마다 열에 셋꼴로 픽해요 (가끔 건너뜀). 픽 전까지는 자리에 있는 것으로 봐요.
  for (const item of all("SELECT i.* FROM items i JOIN rooms r ON r.id=i.room_id WHERE i.status='open' AND i.paused=0 AND r.rehearsal IS NOT NULL")) {
    const ids = all('SELECT id FROM options WHERE item_id=? ORDER BY pos', item.id).map((o) => o.id)
    for (const b of all('SELECT v.id FROM voters v LEFT JOIN participation p ON p.voter_id=v.id AND p.item_id=? WHERE v.room_id=? AND v.bot=1 AND p.voter_id IS NULL', item.id, item.room_id)) {
      seen(item.room_id, b.id).lastSeen = now
      if (Math.random() > 0.3 && now - item.opened_at < 6000) continue // 늦어도 6초 안에는 골라요 (리허설이 괜히 길어지지 않게)
      const picks = Math.random() < 0.08 ? [] : [...ids].sort(() => Math.random() - 0.5).slice(0, 1 + randomInt(Math.min(item.max_pick, ids.length)))
      tx(() => {
        run('INSERT INTO participation(item_id, voter_id) VALUES(?,?)', item.id, b.id)
        if (!picks.length) run('UPDATE items SET abstain=abstain+1 WHERE id=?', item.id)
        else for (const id of picks) run('UPDATE options SET votes=votes+1 WHERE id=?', id)
      })
      tally(item.room_id)
    }
  }
  for (const item of all("SELECT * FROM items WHERE status='open' AND paused=0")) {
    if (item.closes_at && now >= item.closes_at) {
      closeItem(item, '시간이 끝남')
      continue
    }
    const room = roomById(item.room_id)
    if (!room.close_all || item.close_at) continue // 마감 때를 정해 둔 주제는 그때까지 열어 둬요 (사람들이 드나들며 픽해요)
    const voters = all('SELECT v.id, p.voter_id AS done FROM voters v LEFT JOIN participation p ON p.voter_id=v.id AND p.item_id=? WHERE v.room_id=?', item.id, room.id)
    const done = voters.filter((v) => v.done).length
    if (done > 0 && !voters.some((v) => !v.done && isPresent(room, v.id, now))) closeItem(item, '모두 픽함')
  }
}, 1000).unref()

function deleteRoom(room, why) {
  const results = all('SELECT i.title, i.status, i.voted, i.eligible, i.abstain, o.label, o.votes FROM items i LEFT JOIN options o ON o.item_id=i.id WHERE i.room_id=? ORDER BY i.pos, o.pos', room.id)
  tx(() => {
    run('UPDATE codes SET voter_id=NULL WHERE room_id=?', room.id)
    hands.delete(room.id)
    run('DELETE FROM rooms WHERE id=?', room.id)
    audit(why, { 방: room.id, 번호: room.code, 이름: room.title, 마지막결과: results })
  })
  presence.delete(room.id)
  for (const [t, h] of hostSessions) if (h.roomId === room.id) hostSessions.delete(t)
  run('UPDATE reports SET room_id=NULL WHERE room_id=?', room.id)
  if (room.logo) rmSync(join(UPLOADS, room.logo.slice('/uploads/'.length)), { force: true })
  for (const s of streams.get(room.id) ?? []) s.end()
}

// 방장이 만든 방은 마지막으로 쓴 뒤 KEEP_DAYS 일이 지나면 지워요 (켤 때 한 번, 그 뒤 한 시간마다)
const sweep = () => {
  // 픽이 열려 있거나 예약이 걸린 방은 그 일이 끝날 때까지 두어요
  for (const room of all("SELECT * FROM rooms r WHERE owner='host' AND archived=0 AND active_at < ? AND NOT EXISTS (SELECT 1 FROM items i WHERE i.room_id=r.id AND (i.status='open' OR (i.status='draft' AND i.open_at IS NOT NULL)))", Date.now() - KEEP_DAYS * 86_400_000)) deleteRoom(room, '방 자동 삭제')
  for (const room of all('SELECT * FROM rooms WHERE rehearsal IS NOT NULL AND created_at < ?', Date.now() - 86_400_000)) deleteRoom(room, '리허설 방 지움') // 리허설 방은 하루 뒤 지워요
  run('DELETE FROM blocks WHERE until IS NOT NULL AND until < ?', Date.now()) // 기간이 끝난 막기는 풀어요
}
sweep()
setInterval(sweep, 3_600_000).unref()

// 만료된 관리자 로그인 · 풀린 잠금 치우기
setInterval(() => {
  const now = Date.now()
  for (const [t, a] of adminSessions) if (a.until < now) adminSessions.delete(t)
  for (const [t, h] of hostSessions) if (h.until < now) hostSessions.delete(t)
  for (const [k, c] of created) if (c.until < now) created.delete(k)
  for (const [k, f] of fails) if (f.until < now && f.n === 0) fails.delete(k)
}, 600_000).unref()

/** 통과 기준이 있는 주제: 첫 번째 선택지가 픽한 사람(건너뛴 사람 포함)의 절반 넘게 · 3분의 2 이상을 받았는지 */
function outcomeOf(it) {
  if (it.rule === 'none') return null
  const yes = get('SELECT votes FROM options WHERE item_id=? ORDER BY pos LIMIT 1', it.id)?.votes ?? 0
  // 기준 인원: 픽한 사람(건너뛴 사람 포함) · 실제로 고른 사람 · 들어온 사람 전체
  const base = it.basis === 'valid' ? it.voted - it.abstain : it.basis === 'joined' ? it.eligible : it.voted
  if (base <= 0) return 'fail'
  return (it.rule === 'majority' ? yes * 2 > base : yes * 3 >= base * 2) ? 'pass' : 'fail'
}

/** 보는 사람에 맞춘 방 상태. 결과는 마감됐거나 ‘실시간 공개’ 방일 때만 실어요 (관리자도 같아요). */
/** seed 가 있으면 그 사람만의 순서로 섞어요 (새로고침해도 같은 순서) */
const mix = (list, seed) => (seed ? list.map((o) => [sha(`${seed}|${o.id}`), o]).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map((x) => x[1]) : list)

function roomView(room, { admin = false, voterId = null, role = null } = {}) {
  const now = Date.now()
  const items = all(`SELECT * FROM items WHERE room_id=? ${admin ? '' : "AND status!='draft'"} ORDER BY pos, id`, room.id).map((it) => {
    const show = it.status === 'closed' || (it.status === 'open' && !!room.live)
    return {
      id: it.id,
      title: it.title,
      note: it.note,
      maxPick: it.max_pick,
      rule: it.rule,
      practice: !!it.practice,
      outcome: it.status === 'closed' ? outcomeOf(it) : null,
      seconds: it.seconds,
      status: it.status,
      closesAt: it.closes_at,
      paused: !!it.paused,
      pausedLeft: it.paused ? it.paused_left : null,
      openAt: it.status === 'draft' ? it.open_at : null,
      closeAt: it.status !== 'closed' ? it.close_at : null,
      openedAt: it.opened_at,
      closedAt: it.closed_at,
      proof: it.status === 'closed' ? it.proof : null,
      reason: it.reason,
      voted: it.status === 'closed' ? it.voted : votedCount(it.id),
      eligible: it.status === 'closed' ? it.eligible : null,
      revealed: show,
      abstain: show ? it.abstain : null,
      options: mix(all('SELECT id, label, votes FROM options WHERE item_id=? ORDER BY pos', it.id), it.shuffle && it.status === 'open' && voterId ? `${voterId}|${it.id}` : null).map((o) => (show ? { ...o } : { id: o.id, label: o.label })),
      shuffle: !!it.shuffle,
      // 확인 요청: 건수는 모두에게, 내용은 진행자에게만. 마감 뒤 정한 시간 동안 참여자가 한 번.
      objections: it.status === 'closed' ? get('SELECT COUNT(*) n FROM objections WHERE item_id=?', it.id).n : 0,
      objectUntil: it.status === 'closed' && OBJECT_MS ? it.closed_at + OBJECT_MS : null,
      objected: voterId && it.status === 'closed' ? !!get('SELECT 1 x FROM objections WHERE item_id=? AND voter_id=?', it.id, voterId) : null,
      objectionNotes: admin && it.status === 'closed' ? all('SELECT note, at FROM objections WHERE item_id=? ORDER BY id', it.id) : undefined,
      quorum: it.quorum,
      basis: it.basis,
      nudgeAt: it.status === 'open' ? it.nudge_at : null,
      memo: admin ? it.memo : undefined,
      mine: voterId ? !!get('SELECT 1 x FROM participation WHERE item_id=? AND voter_id=?', it.id, voterId) : null,
    }
  })
  const voters = all('SELECT id FROM voters WHERE room_id=?', room.id)
  const view = {
    now,
    org: { ...org(), logo: room.logo || org().logo },
    room: { easy: !!room.easy, rehearsal: !!room.rehearsal, tone: room.tone, screenMode: room.screen_mode, notice: room.screen_notice, code: room.code, title: room.title, mode: room.mode, live: !!room.live, locked: !!room.locked, closed: !!room.closed, needPass: !!room.pass_hash },
    joined: voters.length,
    // 기다리는 동안 보여 줄 것: 주제가 몇 개 중 몇 개 끝났는지, 다음 주제 제목
    agenda: { ...get("SELECT COUNT(*) total, COALESCE(SUM(status='closed'), 0) done FROM items WHERE room_id=?", room.id), next: get("SELECT title FROM items WHERE room_id=? AND status='draft' ORDER BY pos, id LIMIT 1", room.id)?.title ?? null },
    // 예약된 다음 주제가 열리는 때 (기다리는 사람에게 알려 줘요)
    nextOpenAt: get("SELECT MIN(open_at) t FROM items WHERE room_id=? AND status='draft'", room.id).t,
    present: voters.filter((v) => isPresent(room, v.id, now)).length,
    items,
  }
  // 조용한 손들기: 참여자에게는 내가 든 손만, 진행자에게는 몇 명인지만 (누구인지는 어디에도 안 남아요)
  if (voterId) view.myHand = hands.get(room.id)?.get(voterId) ?? null
  if (admin) {
    const raised = [...(hands.get(room.id)?.values() ?? [])]
    view.hands = { question: raised.filter((k) => k === 'question').length, more: raised.filter((k) => k === 'more').length }
  }
  if (admin) {
    const c = get('SELECT COUNT(*) total, COUNT(voter_id) used FROM codes WHERE room_id=?', room.id)
    if (!room.observer_key) {
      room.observer_key = randomBytes(16).toString('hex')
      run('UPDATE rooms SET observer_key=? WHERE id=?', room.observer_key, room.id)
    }
    view.admin = { mark: auditMark(), observerKey: room.observer_key, rehearsalOf: room.rehearsal ?? null, archived: !!room.archived, hasLogo: !!room.logo, role, cohost: !!room.cohost_hash, canBlock: role === 'admin' && !!room.creator, owner: room.owner, expiresAt: room.owner === 'host' ? room.active_at + KEEP_DAYS * 86_400_000 : null, id: room.id, capacity: room.capacity, seconds: room.seconds, grace: room.grace, closeAll: !!room.close_all, screenKey: room.screen_key, codes: { total: c.total, used: c.used } }
  }
  return view
}

// ── 입장 코드 (엄격 방식) ─────────────────────────────────
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // 헷갈리는 0 O 1 I L 은 뺐어요
const newCode = () => Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')
const cleanCode = (v) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16)

// ── 올린 로고 ─────────────────────────────────────────────
// 내용(바이트)으로 진짜 그림인지 확인해요. SVG 는 스크립트를 품을 수 있어 받지 않아요.
function imageKind(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return 'png'
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg'
  if (buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp'
  return null
}
const LOGO_NAME = /^(logo|room)-[a-f0-9]{16}\.(png|jpg|webp)$/
const dropLogo = async () => {
  const old = setting('logo').slice('/uploads/'.length)
  if (LOGO_NAME.test(old)) await unlink(join(UPLOADS, old)).catch(() => {})
  setSetting('logo', '')
}

// ── /api ─────────────────────────────────────────────────
/** 상태를 바꾸는 요청은 이 사이트의 화면에서 온 것만: Origin 확인 + 화면만 붙일 수 있는 머리글 */
function sameSite(req) {
  if (req.headers['x-requested-with'] !== 'mypick') return false
  const origin = req.headers.origin
  if (!origin) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

// 막을 낱말: 누구나 만드는 방(방장 방)의 이름 · 주제에만 걸러요.
const plain = (t) => String(t).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') // 글자 · 숫자만 남겨요 (바.보 · 바 보 · 바~보 → 바보)
const bannedWords = () => setting('banned').split('\n').map(plain).filter((w) => w.length >= 2)
function decent(...texts) {
  const words = bannedWords()
  if (!words.length) return
  const flat = plain(texts.join(''))
  if (words.some((w) => flat.includes(w))) throw new Bad(400, '쓸 수 없는 말이 들어 있어요. 다른 말로 바꿔 주세요.')
}
// 방을 만든 접속 주소는 그대로 두지 않고, 이 서버만 아는 값과 섞어 알아볼 수 없게 바꿔 둬요 (같은 곳인지만 견줄 수 있어요)
if (!setting('salt')) setSetting('salt', randomBytes(16).toString('hex'))
const creatorOf = (ip) => sha(`${setting('salt')}|${ip}`).slice(0, 32)

// 한 시간에 몇 번까지 (방 만들기 · 신고)
const overHour = (key, max) => {
  const c = created.get(key)
  return !!c && c.until > Date.now() && c.n >= max
}
const bumpHour = (key) => {
  const c = created.get(key)
  if (!c && created.size >= 10_000) {
    const now = Date.now()
    for (const [k, x] of created) if (x.until <= now) created.delete(k) // 지난 것만 지워요 (통째로 비우면 한 시간 제한이 풀려요)
    for (const k of created.keys()) if (created.size >= 10_000) created.delete(k)
  }
  created.set(key, c && c.until > Date.now() ? { n: c.n + 1, until: c.until } : { n: 1, until: Date.now() + 3_600_000 })
}

function itemFields(b, room) {
  if (!Array.isArray(b.options)) throw new Bad(400, '선택지를 적어 주세요')
  const options = b.options.map((o) => text(o, '선택지', 80))
  if (options.length < 2 || options.length > 30) throw new Bad(400, '선택지는 2개부터 30개까지예요')
  if (new Set(options).size !== options.length) throw new Bad(400, '같은 선택지가 두 번 있어요')
  if (room.owner === 'host') decent(String(b.title), String(b.note ?? ''), ...options)
  return {
    title: text(b.title, '주제 제목', 100),
    note: b.note ? text(b.note, '설명', 300) : '',
    maxPick: int(b.maxPick ?? 1, '고를 수 있는 개수', 1, options.length),
    seconds: int(b.seconds ?? room.seconds, '제한 시간', 0, 3600),
    // 통과 기준은 하나만 고르는 주제에서만 뜻이 있어요
    rule: ['majority', 'two_thirds'].includes(b.rule) && (b.maxPick ?? 1) === 1 ? b.rule : 'none',
    practice: bool(b.practice),
    quorum: int(b.quorum ?? 0, '최소 참여 인원', 0, 100_000),
    shuffle: bool(b.shuffle),
    basis: ['valid', 'joined'].includes(b.basis) ? b.basis : 'voted',
    options,
  }
}

/** 주제를 방 맨 뒤에 더해요 (새로 만들기 · 복사 · 다시 고르기) */
function addItem(roomId, f) {
  return tx(() => {
    const pos = (get('SELECT MAX(pos) p FROM items WHERE room_id=?', roomId).p ?? 0) + 1
    const id = Number(run('INSERT INTO items(room_id, pos, title, note, max_pick, seconds, rule, practice, quorum, basis, shuffle) VALUES(?,?,?,?,?,?,?,?,?,?,?)', roomId, pos, f.title, f.note, f.maxPick, f.seconds, f.rule, f.practice, f.quorum ?? 0, f.basis ?? 'voted', f.shuffle ?? 0).lastInsertRowid)
    f.options.forEach((label, i) => run('INSERT INTO options(item_id, pos, label) VALUES(?,?,?)', id, i, label))
    return id
  })
}

// 표 계산 프로그램이 수식으로 읽지 않게 (= + - @ 로 시작하는 칸 앞에 ' 를 붙여요)
const csvCell = (v) => {
  const t = String(v ?? '')
  return `"${(/^[=+\-@\t\r]/.test(t) ? "'" + t : t).replaceAll('"', '""')}"`
}

// 방 설정 읽기 (만들 때 · 고칠 때 같은 규칙)
function roomFields(b) {
  return {
    title: text(b.title, '방 이름', 60),
    password: b.password === undefined || b.password === '' ? null : text(b.password, '방 비밀번호', 100, 4),
    capacity: int(b.capacity ?? 0, '정원', 0, 100_000),
    live: bool(b.live),
    seconds: int(b.seconds ?? DEFAULT_SECONDS, '제한 시간', 0, 3600),
    grace: int(b.grace ?? DEFAULT_GRACE, '끊긴 사람 기다리는 시간', 3, 600),
    closeAll: bool(b.closeAll ?? true),
    easy: bool(b.easy ?? false), // 쉬운 말 모드: 참여 화면의 글자를 키우고 문장을 짧게
  }
}

function newRoomCode() {
  let code
  do code = String(randomInt(100_000, 1_000_000))
  while (roomByCode(code))
  return code
}
/** 설정과 주제를 그대로 담은 새 방 (주제는 모두 ‘준비’로) */
function cloneRoom(room, title, { owner = 'admin', rehearsal = null } = {}) {
  const now = Date.now()
  const code = newRoomCode()
  const keep = owner === 'host' // 방장 방의 리허설은 같은 방장 비밀번호 · 만든 곳을 물려받아요
  const nid = tx(() => {
    const nid = Number(
      run(
        'INSERT INTO rooms(code, screen_key, title, pass_hash, mode, capacity, live, seconds, grace, close_all, created_at, owner, host_hash, creator, active_at, tone, logo, rehearsal, easy) SELECT ?, ?, ?, pass_hash, mode, capacity, live, seconds, grace, close_all, ?, ?, ?, ?, ?, tone, NULL, ?, easy FROM rooms WHERE id=?',
        code, randomBytes(16).toString('hex'), title.slice(0, 60), now, owner, keep ? room.host_hash : null, keep ? room.creator : null, now, rehearsal, room.id,
      ).lastInsertRowid,
    )
    for (const it of all('SELECT * FROM items WHERE room_id=? ORDER BY pos, id', room.id))
      addItem(nid, { title: it.title, note: it.note, maxPick: it.max_pick, seconds: it.seconds, rule: it.rule, practice: it.practice, quorum: it.quorum, basis: it.basis, shuffle: it.shuffle, options: all('SELECT label FROM options WHERE item_id=? ORDER BY pos', it.id).map((o) => o.label) })
    return nid
  })
  return { id: nid, code }
}
function createRoom(b, owner, creator = null) {
  if (!['simple', 'strict'].includes(b.mode)) throw new Bad(400, '입장 방식을 골라 주세요')
  const f = roomFields(b)
  if (owner === 'host') decent(f.title)
  const hostHash = owner === 'host' ? hashPass(text(b.hostPassword, '방장 비밀번호', 100, 6)) : null
  const code = newRoomCode()
  const id = Number(
    run(
      'INSERT INTO rooms(code, screen_key, title, pass_hash, mode, capacity, live, seconds, grace, close_all, created_at, owner, host_hash, active_at, creator, easy) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      code, randomBytes(16).toString('hex'), f.title, f.password ? hashPass(f.password) : null, b.mode, f.capacity, f.live, f.seconds, f.grace, f.closeAll, Date.now(), owner, hostHash, Date.now(), creator, f.easy,
    ).lastInsertRowid,
  )
  bumpStat('rooms')
  audit('방 만듦', { 방: id, 번호: code, 이름: f.title, 방식: b.mode, 실시간공개: !!f.live, 만든이: owner === 'host' ? '방장' : '관리자' })
  return id
}
const created = new Map() // 열쇠 → { n, until }: 한 시간에 몇 번 했는지 (방 만들기 · 신고)
const REASONS = ['부적절한 내용', '괴롭힘 · 따돌림', '사칭 · 속임', '기타']
const DUMMY_HASH = hashPass(randomBytes(8).toString('hex')) // 없는 아이디도 같은 시간이 걸리게

async function api(req, res, url) {
  const path = url.pathname
  const m = req.method
  const ip = clientIp(req)
  if (m !== 'GET' && !sameSite(req)) throw new Bad(403, '다른 사이트에서 온 요청은 받지 않아요')
  const ok = (obj = { ok: true }, headers) => json(res, 200, obj, headers)

  if (path === '/api/org' && m === 'GET') return ok(org())

  // ── 참여자 ──
  // 방 번호를 넣으면 그 방에 들어갈 때 무엇이 필요한지만 알려 줘요 (필요 없는 칸은 화면에 안 나오게).
  // 번호를 마구 찍어 방을 찾는 것은 틀린 횟수를 세어 막아요.
  // 결과 확인: 마감 때 받은 코드를 넣으면, 지금 저장된 결과가 그때와 같은지 알려 줘요 (누구나)
  if (path === '/api/verify' && m === 'GET') {
    const wide = `join|${ip}`
    guard(wide)
    const typed = cleanCode(url.searchParams.get('code'))
    const code = `${typed.slice(0, 4)}-${typed.slice(4, 8)}-${typed.slice(8, 12)}`
    const it = typed.length === 12 ? get('SELECT i.*, r.title AS room_title FROM items i JOIN rooms r ON r.id=i.room_id WHERE i.proof=?', code) : null
    if (!it) {
      failed(wide, JOIN_LOCK_AFTER * 5, JOIN_LOCK_MS)
      throw new Bad(404, '이 코드로 남은 결과가 없어요. 코드를 다시 확인해 주세요. 방이 지워졌으면 확인할 수 없어요.')
    }
    return ok({
      same: proofOf(it.id) === it.proof,
      // 이 마감이 기록에도 남아 있고 기록이 온전한지 (기록 끝을 잘라내면 여기서 드러나요)
      logged: !!get("SELECT 1 AS x FROM audit WHERE action IN ('주제 마감','안건 마감') AND detail LIKE ?", `%"확인코드":"${it.proof}"%`) && auditIntactSoon(),
      room: it.room_title,
      title: it.title,
      practice: !!it.practice,
      options: all('SELECT label, votes FROM options WHERE item_id=? ORDER BY pos', it.id).map((o) => ({ label: o.label, votes: o.votes })),
      voted: it.voted,
      eligible: it.eligible,
      abstain: it.abstain,
      closedAt: it.closed_at,
      outcome: outcomeOf(it),
    })
  }

  if (path === '/api/room' && m === 'GET') {
    const wide = `join|${ip}`
    guard(wide)
    const room = roomByCode(url.searchParams.get('code'))
    if (!room) {
      failed(wide, JOIN_LOCK_AFTER * 5, JOIN_LOCK_MS)
      throw new Bad(404, '없는 방 번호예요. 다시 확인해 주세요.')
    }
    return ok({ title: room.title, needPass: !!room.pass_hash, needCode: room.mode === 'strict' })
  }

  if (path === '/api/join' && m === 'POST') {
    const b = await body(req)
    const code = String(b.room ?? '').replace(/\D/g, '').slice(0, 6)
    const key = `join|${ip}|${code}`
    const wide = `join|${ip}` // 방 번호를 바꿔 가며 찍어 보는 것도 막아요 (같은 주소에서 틀린 횟수를 통틀어 세요)
    guard(key)
    guard(wide)
    const room = roomByCode(code)
    // 방이 없을 때와 비밀번호가 틀렸을 때를 같은 말로 답해요 (방 번호를 떠보지 못하게)
    const wrong = () => {
      failed(key, JOIN_LOCK_AFTER, JOIN_LOCK_MS)
      failed(wide, JOIN_LOCK_AFTER * 5, JOIN_LOCK_MS)
      return new Bad(401, '방 번호 · 비밀번호 · 입장 코드를 다시 확인해 주세요')
    }
    if (!room) throw wrong()
    if (room.pass_hash && !(typeof b.password === 'string' && b.password.length <= 100 && (await checkPass(b.password, room.pass_hash)))) throw wrong()

    const mine = voterOf(req)
    if (mine?.room_id === room.id && room.mode === 'simple') return ok()

    const token = randomBytes(32).toString('hex')
    const expires = Date.now() + VOTER_SESSION_MS
    if (room.mode === 'strict') {
      const entry = get('SELECT * FROM codes WHERE room_id=? AND code=?', room.id, cleanCode(b.entryCode))
      if (!entry) throw wrong()
      if (entry.voter_id) {
        // 입장 코드는 한 번만 써요. 이미 쓴 코드는, 그 코드로 들어와 있는 바로 그 기기만 그대로 이어 가요.
        if (mine?.id === entry.voter_id) return ok()
        // 다른 기기에서 다시 넣으면 막아요 (코드를 훔쳐보거나 사진 찍어 가도 남의 자리를 빼앗지 못해요).
        // 진행자가 실물 코드를 보고 ‘다시 열기’를 해 준 경우에만 한 번 더 들어올 수 있고, 들어오면 다시 닫혀요. 픽 기록은 그대로라 한 번만 픽해요.
        if (!entry.reopen) {
          failed(key, JOIN_LOCK_AFTER, JOIN_LOCK_MS) // 쓴 코드를 마구 넣어 보는 것도 틀린 횟수로 세요
          failed(wide, JOIN_LOCK_AFTER * 5, JOIN_LOCK_MS)
          throw new Bad(409, '이미 쓴 입장 코드예요. 진행자에게 이 코드를 보여 주면 다시 열어 줘요.')
        }
        tx(() => {
          run('UPDATE voters SET token_hash=?, expires_at=? WHERE id=?', sha(token), expires, entry.voter_id)
          run('UPDATE codes SET reopen=0 WHERE room_id=? AND code=?', room.id, entry.code)
        })
      } else {
        if (room.locked) throw new Bad(403, room.closed ? '끝난 방이에요' : '입장이 마감됐어요. 진행자에게 알려 주세요.')
        tx(() => {
          const id = Number(run('INSERT INTO voters(room_id, token_hash, expires_at) VALUES(?,?,?)', room.id, sha(token), expires).lastInsertRowid)
          if (!room.rehearsal) bumpStat('voters')
          run('UPDATE codes SET voter_id=? WHERE room_id=? AND code=?', id, room.id, entry.code)
        })
      }
    } else {
      if (room.locked) throw new Bad(403, room.closed ? '끝난 방이에요' : '입장이 마감됐어요. 진행자에게 알려 주세요.')
      if (room.capacity && joinedCount(room.id) >= room.capacity) throw new Bad(403, '정원이 찼어요. 진행자에게 알려 주세요.')
      run('INSERT INTO voters(room_id, token_hash, expires_at) VALUES(?,?,?)', room.id, sha(token), expires)
      if (!room.rehearsal) bumpStat('voters')
    }
    fails.delete(key)
    const me = get('SELECT id FROM voters WHERE token_hash=?', sha(token))
    seen(room.id, me.id).lastSeen = Date.now() // 막 들어온 사람은 화면이 연결될 때까지 자리에 있는 것으로 봐요
    ping(room.id)
    return ok({ ok: true }, { 'Set-Cookie': setCookie(req, 'mp_voter', token, VOTER_SESSION_MS, 'Lax') })
  }

  if (path === '/api/me' && m === 'GET') {
    const v = voterOf(req)
    const room = v && roomById(v.room_id)
    if (!room) return json(res, 401, { error: '입장이 필요해요' })
    return ok(roomView(room, { voterId: v.id }))
  }

  if (path === '/api/leave' && m === 'POST') {
    const v = voterOf(req)
    const room = v && roomById(v.room_id)
    if (room && !room.closed) throw new Bad(409, '진행 중인 방에서는 나갈 수 없어요')
    return ok({ ok: true }, { 'Set-Cookie': setCookie(req, 'mp_voter', '', 0, 'Lax') })
  }

  // 조용한 손들기: 질문 있어요 · 더 설명해 주세요 (같은 것을 다시 누르면 내려요)
  if (path === '/api/hand' && m === 'POST') {
    const v = voterOf(req)
    if (!v) throw new Bad(401, '입장이 필요해요')
    const kind = (await body(req)).kind
    if (![null, 'question', 'more'].includes(kind)) throw new Bad(400, '알 수 없는 손이에요')
    // 한 사람이 마구 눌러 방 전체를 계속 다시 읽게 만들지 못하게: 1.5초에 한 번
    const last = handAt.get(v.id) ?? 0
    if (Date.now() - last < 1500) throw new Bad(429, '조금 천천히 눌러 주세요')
    if (handAt.size >= 20_000) handAt.clear()
    handAt.set(v.id, Date.now())
    let mine = hands.get(v.room_id)
    if (!mine) hands.set(v.room_id, (mine = new Map()))
    if (kind) mine.set(v.id, kind)
    else mine.delete(v.id)
    ping(v.room_id)
    return ok()
  }

  if (path === '/api/vote' && m === 'POST') {
    const v = voterOf(req)
    if (!v) throw new Bad(401, '입장이 필요해요')
    const b = await body(req)
    const item = get('SELECT * FROM items WHERE id=? AND room_id=?', int(b.item, '주제', 1, 2 ** 31), v.room_id)
    if (!item) throw new Bad(404, '없는 주제예요')
    if (!Array.isArray(b.options) || b.options.length > item.max_pick || new Set(b.options).size !== b.options.length) throw new Bad(400, `${item.max_pick}개까지 고를 수 있어요`)
    const valid = new Set(all('SELECT id FROM options WHERE item_id=?', item.id).map((o) => o.id))
    if (!b.options.every((id) => Number.isInteger(id) && valid.has(id))) throw new Bad(400, '없는 선택지예요')
    tx(() => {
      // 열려 있는지는 저장하는 그 순간에 다시 봐요
      const now = get('SELECT status, closes_at, paused FROM items WHERE id=?', item.id)
      if (now.status !== 'open' || (now.closes_at && Date.now() >= now.closes_at)) throw new Bad(409, '마감된 주제예요')
      if (now.paused) throw new Bad(409, '진행자가 잠깐 멈췄어요. 다시 시작하면 고를 수 있어요.')
      if (get('SELECT 1 x FROM participation WHERE item_id=? AND voter_id=?', item.id, v.id)) throw new Bad(409, '이미 픽했어요')
      run('INSERT INTO participation(item_id, voter_id) VALUES(?,?)', item.id, v.id) // 겹치면 PRIMARY KEY 가 한 번 더 막아요
      // 무엇을 골랐는지는 숫자만 올려요. 누가 골랐는지와 이어지는 것은 어디에도 남지 않아요.
      if (b.options.length === 0) run('UPDATE items SET abstain=abstain+1 WHERE id=?', item.id)
      else for (const id of b.options) run('UPDATE options SET votes=votes+1 WHERE id=?', id)
    })
    if (roomById(v.room_id).live) ping(v.room_id)
    else tally(v.room_id)
    return ok()
  }

  // 확인 요청: 마감 뒤 정한 시간 동안, 그 방 참여자가 주제마다 한 번. 익명으로 진행자에게 전해져요.
  if (path === '/api/object' && m === 'POST') {
    const v = voterOf(req)
    if (!v) throw new Bad(401, '입장이 필요해요')
    const b = await body(req)
    const item = get("SELECT * FROM items WHERE id=? AND room_id=? AND status='closed'", int(b.item, '주제', 1, 2 ** 31), v.room_id)
    if (!item) throw new Bad(404, '마감된 주제가 아니에요')
    if (!OBJECT_MS || Date.now() > item.closed_at + OBJECT_MS) throw new Bad(409, '확인 요청을 받는 시간이 지났어요')
    const note = text(b.note, '확인할 내용', 300, 5)
    if (get('SELECT 1 x FROM objections WHERE item_id=? AND voter_id=?', item.id, v.id)) throw new Bad(409, '이 주제에는 이미 확인 요청을 보냈어요')
    run('INSERT INTO objections(item_id, voter_id, note, at) VALUES(?,?,?,?)', item.id, v.id, note, Date.now())
    ping(v.room_id)
    return ok()
  }

  // 신고: 방에 들어온 사람이 한 방에 한 번. 관리자 화면에 모여요.
  if (path === '/api/report' && m === 'POST') {
    const v = voterOf(req)
    const room = v && roomById(v.room_id)
    if (!room) throw new Bad(401, '입장이 필요해요')
    const b = await body(req)
    if (!REASONS.includes(b.reason)) throw new Bad(400, '신고하는 까닭을 골라 주세요')
    const note = b.note ? text(b.note, '자세한 내용', 300) : ''
    if (get('SELECT 1 x FROM reports WHERE room_id=? AND voter_id=?', room.id, v.id)) throw new Bad(409, '이 방은 이미 신고했어요. 관리자가 확인할 거예요.')
    if (overHour(`report|${ip}`, 5)) throw new Bad(429, '신고를 너무 많이 했어요. 나중에 다시 해 주세요.')
    run('INSERT INTO reports(room_id, room_code, room_title, reason, note, at, voter_id) VALUES(?,?,?,?,?,?,?)', room.id, room.code, room.title, b.reason, note, Date.now(), v.id)
    bumpHour(`report|${ip}`)
    return ok()
  }

  // 오류 제보 · 바라는 점: 누구나, 한 주소에서 한 시간에 5번까지
  if (path === '/api/feedback' && m === 'POST') {
    const b = await body(req)
    if (!['오류', '바라는 점'].includes(b.kind)) throw new Bad(400, '오류인지 바라는 점인지 골라 주세요')
    const note = text(b.note, '내용', 500, 5)
    if (overHour(`feedback|${ip}`, 5)) throw new Bad(429, '너무 많이 보냈어요. 나중에 다시 해 주세요.')
    if (get('SELECT COUNT(*) n FROM feedback').n >= 2000) throw new Bad(503, '지금은 제보를 받을 수 없어요. 운영자에게 직접 알려 주세요.')
    const page = typeof b.page === 'string' && /^\/[\w\-/]{0,60}$/.test(b.page) ? b.page : '' // 주소의 길(방 번호 · 열쇠가 든 꼬리는 빼고)만
    run('INSERT INTO feedback(at, kind, note, page, ua) VALUES(?,?,?,?,?)', Date.now(), b.kind, note, page, String(req.headers['user-agent'] ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 160))
    bumpHour(`feedback|${ip}`)
    return ok()
  }

  if (path === '/api/observe' && m === 'GET') {
    const room = roomByCode(url.searchParams.get('room'))
    const k = url.searchParams.get('k')
    if (!room?.observer_key || typeof k !== 'string' || !same(k, room.observer_key)) throw new Bad(403, '볼 수 없는 방이에요')
    const mark = `"방":${room.id}`
    return ok({
      ...roomView(room),
      intact: auditIntactSoon(),
      ...auditMark(),
      log: all('SELECT at, action, detail FROM audit WHERE detail LIKE ? OR detail LIKE ? ORDER BY id DESC LIMIT 200', `%${mark},%`, `%${mark}}%`).map((r) => {
        const { 누가, 주소, ...rest } = JSON.parse(r.detail) // 누가 · 어디서는 빼고 한 일만
        // 관리자 계정 이름은 밖에 보이지 않게 ‘운영자’로 (방장 · 공동 진행자는 그대로)
        return { at: r.at, action: r.action, by: !누가 ? null : ['방장', '공동 진행자'].includes(누가) ? 누가 : '운영자', detail: rest }
      }),
    })
  }

  // ── 실시간 · 큰 화면 ──
  if ((path === '/api/events' || path === '/api/screen') && m === 'GET') {
    const room = roomByCode(url.searchParams.get('room'))
    const k = url.searchParams.get('k')
    const v = voterOf(req)
    const asScreen = !!room && typeof k === 'string' && (same(k, room.screen_key) || (!!room.observer_key && same(k, room.observer_key) && path === '/api/events'))
    const asVoter = !!room && v?.room_id === room.id
    const asBoss = isAdmin(req) || (!!room && hostOf(req)?.roomId === room.id)
    if (!room || !(asScreen || asVoter || asBoss)) throw new Bad(403, '볼 수 없는 방이에요')
    if (path === '/api/screen') {
      if (!asScreen && !asBoss) throw new Bad(403, '볼 수 없는 방이에요')
      return ok({ ...roomView(room), siteUrl: SITE_URL })
    }
    return openStream(req, res, room, asVoter && !asScreen ? v.id : null)
  }

  // ── 관리자 ──
  if (path === '/api/admin/session' && m === 'GET') {
    const a = ENABLED ? adminOf(req) : null
    return ok({ enabled: ENABLED, authed: !!a, name: a?.name ?? null, top: !!a?.top })
  }

  if (path === '/api/admin/login' && m === 'POST') {
    if (!ENABLED) throw new Bad(503, '관리자 비밀번호가 정해지지 않았어요. .env 의 ADMIN_PASSWORD 를 8자 이상으로 넣고 다시 띄워 주세요.')
    const key = `admin|${ip}`
    guard(key)
    const b = await body(req)
    // 아이디 · 비밀번호를 둘 다 끝까지 견줘요 (어느 쪽이 틀렸는지 시간으로 새지 않게)
    const typed = typeof b.id === 'string' && typeof b.password === 'string' && b.id.length <= 40 && b.password.length <= 100
    const top = typed && [same(b.id, ADMIN_ID), same(b.password, ADMIN_PASSWORD)].every(Boolean)
    // 더한 관리자: 없는 아이디여도 같은 계산을 해서 걸리는 시간으로 아이디가 있는지 알 수 없게 해요
    const extra = typed && !top ? get('SELECT * FROM admins WHERE name=?', b.id) : null
    const good = top || (typed && (await checkPass(b.password, extra?.pass_hash ?? DUMMY_HASH)) && !!extra)
    if (!good) {
      failed(key, LOCK_AFTER, LOCK_MS)
      audit('관리자 로그인 실패', { 주소: ip })
      throw new Bad(401, '아이디나 비밀번호가 달라요')
    }
    fails.delete(key)
    const token = randomBytes(32).toString('hex')
    adminSessions.set(sha(token), { until: Date.now() + ADMIN_SESSION_MS, name: top ? ADMIN_ID : extra.name, top })
    audit('관리자 로그인', { 누가: top ? ADMIN_ID : extra.name, 주소: ip })
    return ok({ ok: true }, { 'Set-Cookie': setCookie(req, 'mp_admin', token, ADMIN_SESSION_MS, 'Strict') })
  }

  if (path === '/api/admin/logout' && m === 'POST') {
    const t = cookieOf(req, 'mp_admin')
    if (t) adminSessions.delete(sha(t))
    return ok({ ok: true }, { 'Set-Cookie': setCookie(req, 'mp_admin', '', 0, 'Strict') })
  }

  // ── 방장: 누구나 방 만들기 · 방장으로 들어가기 ──
  if (path === '/api/host/session' && m === 'GET') {
    const h = hostOf(req)
    const there = h && roomById(h.roomId)
    return ok({ roomId: there ? h.roomId : null, role: there ? h.role : null })
  }

  if (path === '/api/host/create' && m === 'POST') {
    if (!PUBLIC_ROOMS) throw new Bad(403, '지금은 관리자만 방을 만들 수 있어요')
    const b0 = await body(req)
    const creator = creatorOf(ip)
    if (get('SELECT 1 x FROM blocks WHERE creator=? AND (until IS NULL OR until > ?)', creator, Date.now())) throw new Bad(403, '이 접속 주소에서는 방을 만들 수 없어요. 관리자에게 문의해 주세요.')
    if (overHour(ip, ROOMS_PER_HOUR)) throw new Bad(429, '방을 너무 많이 만들었어요. 한 시간 뒤에 다시 해 주세요.')
    if (get("SELECT COUNT(*) n FROM rooms WHERE owner='host'").n >= MAX_PUBLIC_ROOMS) throw new Bad(503, '지금은 방이 가득 찼어요. 나중에 다시 해 주세요.')
    const id = actor.run('방장', () => createRoom(b0, 'host', creator))
    bumpHour(ip)
    return ok({ id }, hostCookie(req, id))
  }

  if (path === '/api/host/login' && m === 'POST') {
    const b = await body(req)
    const code = String(b.room ?? '').replace(/\D/g, '').slice(0, 6)
    const key = `host|${ip}|${code}`
    guard(key)
    const room = roomByCode(code)
    // 방장 비밀번호면 방장, 공동 진행자 비밀번호면 공동 진행자로 들어가요 (둘 다 끝까지 견줘요)
    const pw = typeof b.hostPassword === 'string' && b.hostPassword.length <= 100 ? b.hostPassword : null
    const asHost = !!pw && (await checkPass(pw, room?.host_hash ?? DUMMY_HASH)) && !!room?.host_hash
    const asCo = !!pw && (await checkPass(pw, room?.cohost_hash ?? DUMMY_HASH)) && !!room?.cohost_hash
    if (!asHost && !asCo) {
      failed(key, LOCK_AFTER, LOCK_MS)
      throw new Bad(401, '방 번호나 비밀번호를 다시 확인해 주세요')
    }
    fails.delete(key)
    return ok({ id: room.id, role: asHost ? 'host' : 'cohost' }, hostCookie(req, room.id, asHost ? 'host' : 'cohost'))
  }

  if (path === '/api/host/logout' && m === 'POST') {
    const t = cookieOf(req, 'mp_host')
    if (t) hostSessions.delete(sha(t))
    return ok({ ok: true }, { 'Set-Cookie': setCookie(req, 'mp_host', '', 0, 'Strict') })
  }

  if (!path.startsWith('/api/admin/')) throw new Bad(404, '없는 주소예요')
  // 여기부터는 관리자, 또는 자기 방을 다루는 방장만. 방장은 방 · 주제 주소에서 자기 방일 때만 지나가요.
  const me = ENABLED ? adminOf(req) : null
  const admin = !!me
  const hs = hostOf(req)
  if (!admin && !hs) throw new Bad(401, '로그인이 필요해요')
  actor.enterWith(admin ? me.name : hs.role === 'host' ? '방장' : '공동 진행자')
  const adminOnly = () => {
    if (!admin) throw new Bad(403, '관리자만 할 수 있어요')
  }
  const topOnly = () => {
    if (!me?.top) throw new Bad(403, '최고 관리자만 할 수 있어요')
  }
  /** 이 방을 진행할 수 있는지. 누구로서인지 돌려줘요: 'admin' · 'host' · 'cohost' */
  const mayManage = (room) => {
    if (admin) return 'admin'
    if (hs.roomId !== room.id) throw new Bad(403, '이 방의 진행자만 할 수 있어요')
    return hs.role
  }
  /** 방 지우기 · 끝내기 · 설정 바꾸기는 방장(과 관리자)만. 공동 진행자는 주제 진행만 해요. */
  const ownerOnly = (room) => {
    if (mayManage(room) === 'cohost') throw new Bad(403, '방장만 할 수 있어요')
  }

  // ── 관리자 여러 명 (최고 관리자만 더하고 빼요) ──
  if (path === '/api/admin/admins' && m === 'GET') {
    topOnly()
    return ok({ top: ADMIN_ID, admins: all('SELECT id, name, created_at AS createdAt FROM admins ORDER BY id') })
  }
  if (path === '/api/admin/admins' && m === 'POST') {
    topOnly()
    const b = await body(req)
    const name = text(b.name, '아이디', 30, 2)
    if (!/^[\w가-힣.-]+$/.test(name)) throw new Bad(400, '아이디는 글자 · 숫자 · . - _ 만 쓸 수 있어요')
    if (same(name, ADMIN_ID) || get('SELECT 1 x FROM admins WHERE name=?', name)) throw new Bad(409, '이미 있는 아이디예요')
    run('INSERT INTO admins(name, pass_hash, created_at) VALUES(?,?,?)', name, hashPass(text(b.password, '비밀번호', 100, 8)), Date.now())
    audit('관리자 더함', { 아이디: name })
    return ok()
  }
  let r0
  if ((r0 = /^\/api\/admin\/admins\/(\d+)$/.exec(path)) && m === 'DELETE') {
    topOnly()
    const a = get('SELECT * FROM admins WHERE id=?', Number(r0[1]))
    if (!a) throw new Bad(404, '없는 관리자예요')
    run('DELETE FROM admins WHERE id=?', a.id)
    for (const [t, x] of adminSessions) if (x.name === a.name && !x.top) adminSessions.delete(t)
    audit('관리자 뺌', { 아이디: a.name })
    return ok()
  }

  // ── 한눈에 보기 (대시보드 + 서버 상태) ──
  if (path === '/api/admin/overview' && m === 'GET') {
    adminOnly()
    const now = Date.now()
    const files = backupFiles()
    return ok({
      live: all("SELECT i.id, i.title, i.closes_at AS closesAt, r.id AS roomId, r.title AS room, r.code FROM items i JOIN rooms r ON r.id=i.room_id WHERE i.status='open' ORDER BY i.opened_at").map((x) => {
        const room = roomById(x.roomId)
        return { ...x, voted: votedCount(x.id), joined: joinedCount(x.roomId), present: all('SELECT id FROM voters WHERE room_id=?', x.roomId).filter((v) => isPresent(room, v.id, now)).length }
      }),
      scheduled: all("SELECT i.title, i.open_at AS openAt, r.id AS roomId, r.title AS room FROM items i JOIN rooms r ON r.id=i.room_id WHERE i.status='draft' AND i.open_at IS NOT NULL ORDER BY i.open_at LIMIT 10"),
      rooms: get('SELECT COUNT(*) total, SUM(closed=0 AND archived=0) active, SUM(archived) archived FROM rooms'),
      today: get('SELECT * FROM stats WHERE day=?', today()) ?? { rooms: 0, voters: 0, items: 0, votes: 0 },
      reportsOpen: get('SELECT COUNT(*) n FROM reports WHERE handled=0').n,
      expiring: all("SELECT id, title, code, active_at + ? AS expiresAt FROM rooms WHERE owner='host' AND archived=0 AND active_at + ? < ? ORDER BY active_at LIMIT 10", KEEP_DAYS * 86_400_000, KEEP_DAYS * 86_400_000, now + 2 * 86_400_000),
      server: { version: VERSION, node: process.version, upSince: BOOT, connections: streamCount, maxConnections: MAX_STREAMS, dbBytes: statSync(DB_FILE).size, backups: files.length, lastBackup: files.at(-1) ?? null, publicRooms: PUBLIC_ROOMS, keepDays: KEEP_DAYS, https: isHttps(req), auditIntact: auditIntact() },
    })
  }
  if (path === '/api/admin/stats' && m === 'GET') {
    adminOnly()
    return ok({ days: all('SELECT * FROM stats ORDER BY day DESC LIMIT 90').reverse() })
  }

  // 더한 관리자가 자기 비밀번호 바꾸기 (최고 관리자는 .env 에서)
  if (path === '/api/admin/password' && m === 'POST') {
    adminOnly()
    if (me.top) throw new Bad(400, '최고 관리자의 비밀번호는 .env 의 ADMIN_PASSWORD 에서 바꿔요')
    const b = await body(req)
    const mine = get('SELECT * FROM admins WHERE name=?', me.name)
    if (!mine || typeof b.current !== 'string' || b.current.length > 100 || !(await checkPass(b.current, mine.pass_hash))) {
      failed(`admin|${ip}`, LOCK_AFTER, LOCK_MS)
      throw new Bad(401, '지금 비밀번호가 달라요')
    }
    run('UPDATE admins SET pass_hash=? WHERE id=?', hashPass(text(b.next, '새 비밀번호', 100, 8)), mine.id)
    audit('관리자 비밀번호 바꿈', {})
    return ok()
  }

  // ── 백업: 지금 만들기 · 내려받기 · 되돌리기 (저장 파일 전체라 최고 관리자만) ──
  if (path === '/api/admin/backups' && m === 'GET') {
    adminOnly()
    return ok({ keepDays: BACKUP_KEEP, files: backupFiles().reverse().map((name) => ({ name, bytes: statSync(join(BACKUPS, name)).size, at: statSync(join(BACKUPS, name)).mtimeMs })) })
  }
  if (path === '/api/admin/backups' && m === 'POST') {
    topOnly()
    const name = backup(true)
    audit('백업 만듦', { 파일: name })
    return ok({ name })
  }
  if ((r0 = /^\/api\/admin\/backups\/(mypick-[\d-]+\.db)(\/restore)?$/.exec(path))) {
    topOnly()
    const file = join(BACKUPS, r0[1])
    if (!BACKUP_NAME.test(r0[1]) || !existsSync(file)) throw new Bad(404, '없는 백업이에요')
    if (!r0[2] && m === 'GET') {
      audit('백업 내려받음', { 파일: r0[1] })
      res.writeHead(200, { ...SECURITY, 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store', 'Content-Length': statSync(file).size, 'Content-Disposition': `attachment; filename="${r0[1]}"` })
      return createReadStream(file).pipe(res)
    }
    if (r0[2] && m === 'POST') {
      // 고른 백업을 ‘기다리는 파일’로 놓고 서버를 끄면, 다시 켜질 때 그것으로 바뀌어요 (도커가 바로 다시 켜요). 지금 파일은 backups/before-restore-… 로 남아요.
      copyFileSync(file, PENDING)
      writeFileSync(PENDING + '.txt', `${r0[1]} (${me.name})`)
      console.log(`백업으로 되돌려요: ${r0[1]} — 서버를 다시 켭니다`)
      json(res, 200, { ok: true, restarting: true })
      setTimeout(() => process.exit(0), 400)
      return
    }
  }

  // ── 주제 묶음: 관리자들이 어느 기기에서나 같이 써요 (방장은 자기 브라우저 · 파일로) ──
  if (path === '/api/admin/bundles' && m === 'GET') {
    adminOnly()
    return ok({ bundles: all('SELECT id, name, items FROM bundles ORDER BY updated_at DESC').map((x) => ({ id: x.id, name: x.name, items: JSON.parse(x.items) })) })
  }
  if (path === '/api/admin/bundles' && m === 'POST') {
    adminOnly()
    const b = await body(req)
    const name = text(b.name, '묶음 이름', 40)
    if (!Array.isArray(b.items) || !b.items.length || b.items.length > 50) throw new Bad(400, '주제는 1개부터 50개까지 담을 수 있어요')
    const items = b.items.map((it) => itemFields(it, { owner: 'admin', seconds: DEFAULT_SECONDS })) // 모양을 한 번 걸러서 저장해요
    if (!get('SELECT 1 x FROM bundles WHERE name=?', name) && get('SELECT COUNT(*) n FROM bundles').n >= 100) throw new Bad(400, '묶음은 100개까지 저장할 수 있어요')
    run('INSERT INTO bundles(name, items, updated_at) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET items=excluded.items, updated_at=excluded.updated_at', name, JSON.stringify(items), Date.now())
    return ok()
  }
  if ((r0 = /^\/api\/admin\/bundles\/(\d+)$/.exec(path)) && m === 'DELETE') {
    adminOnly()
    run('DELETE FROM bundles WHERE id=?', Number(r0[1]))
    return ok()
  }

  // ── 신고 · 막을 낱말 · 막은 곳 ──
  if ((r0 = /^\/api\/admin\/feedback\/(\d+)$/.exec(path)) && m === 'DELETE') {
    adminOnly()
    run('DELETE FROM feedback WHERE id=?', Number(r0[1]))
    return ok()
  }
  if (path === '/api/admin/reports' && m === 'GET') {
    adminOnly()
    return ok({
      open: get('SELECT COUNT(*) n FROM reports WHERE handled=0').n,
      reports: all('SELECT id, room_id AS roomId, room_code AS roomCode, room_title AS roomTitle, reason, note, at, handled FROM reports ORDER BY handled, id DESC LIMIT 200').map((x) => ({ ...x, handled: !!x.handled })),
      banned: setting('banned'),
      feedback: all('SELECT id, at, kind, note, page, ua FROM feedback ORDER BY id DESC LIMIT 200'),
      blocks: all('SELECT creator, at, why, until FROM blocks WHERE until IS NULL OR until > ? ORDER BY at DESC', Date.now()),
    })
  }
  if ((r0 = /^\/api\/admin\/reports\/(\d+)\/handle$/.exec(path)) && m === 'POST') {
    adminOnly()
    run('UPDATE reports SET handled=1 WHERE id=?', Number(r0[1]))
    return ok()
  }
  // 신고 지우기: 확인을 마친 신고를 운영자가 지워요 (개인정보 처리방침의 ‘신고는 운영자가 지울 때까지’). 지운 일은 기록에 남아요 (내용은 빼고)
  if ((r0 = /^\/api\/admin\/reports\/(\d+)$/.exec(path)) && m === 'DELETE') {
    adminOnly()
    const gone = run('DELETE FROM reports WHERE id=? AND handled=1', Number(r0[1])).changes
    if (!gone) throw new Bad(409, '‘확인했어요’를 누른 신고만 지울 수 있어요')
    audit('신고 지움', { 신고: Number(r0[1]) })
    return ok()
  }
  if (path === '/api/admin/banned' && m === 'PUT') {
    adminOnly()
    const words = String((await body(req)).words ?? '').slice(0, 4000)
    setSetting('banned', words)
    audit('막을 낱말 바꿈', { 개수: words.split('\n').filter((w) => w.trim().length >= 2).length })
    return ok()
  }
  if ((r0 = /^\/api\/admin\/blocks\/([a-f0-9]{32})$/.exec(path)) && m === 'DELETE') {
    adminOnly()
    run('DELETE FROM blocks WHERE creator=?', r0[1])
    audit('막은 곳 풂', {})
    return ok()
  }

  if (path === '/api/admin/defaults' && m === 'GET') return ok({ seconds: DEFAULT_SECONDS, grace: DEFAULT_GRACE, maxLogoMb: MAX_LOGO / 1024 / 1024, siteUrl: SITE_URL })

  if (path === '/api/admin/org' && m === 'PUT') {
    adminOnly()
    const name = text((await body(req)).name, '기관 이름', 40)
    setSetting('org', name)
    audit('기관 이름 바꿈', { 이름: name })
    return ok(org())
  }

  if (path === '/api/admin/logo' && m === 'POST') {
    adminOnly()
    const buf = await readRaw(req, MAX_LOGO).catch(() => {
      throw new Bad(413, `사진이 너무 커요 (${MAX_LOGO / 1024 / 1024}MB 까지)`)
    })
    const kind = imageKind(buf)
    if (!kind) throw new Bad(415, 'PNG · JPG · WebP 사진만 올릴 수 있어요')
    await dropLogo()
    const name = `logo-${randomBytes(8).toString('hex')}.${kind}` // 이름은 서버가 지어요 (올린 이름은 쓰지 않아요)
    await writeFile(join(UPLOADS, name), buf)
    setSetting('logo', `/uploads/${name}`)
    audit('기관 로고 바꿈', {})
    return ok(org())
  }

  if (path === '/api/admin/logo' && m === 'DELETE') {
    adminOnly()
    await dropLogo()
    audit('기관 로고 지움', {})
    return ok(org())
  }

  // 적어 둔 기록 지문이 지금 기록 안에 있는지 (?m=지문)
  if (path === '/api/admin/audit/mark' && m === 'GET') {
    adminOnly()
    const typed = String(url.searchParams.get('m') ?? '').replace(/[^0-9a-f]/gi, '').toLowerCase()
    if (typed.length !== 12) throw new Bad(400, '지문은 12자리예요 (예: 3FA2-9C01-77BE)')
    const row = get('SELECT id, at FROM audit WHERE hash LIKE ?', `${typed}%`)
    return ok({ found: !!row, at: row?.at ?? null, pos: row ? get('SELECT COUNT(*) AS n FROM audit WHERE id<=?', row.id).n : 0, intact: auditIntact(), ...auditMark() })
  }

  // 기록 보기 · 찾기 (?q=글자 &from= &to= 밀리초) · 내려받기(.csv)
  if ((path === '/api/admin/audit' || path === '/api/admin/audit.csv') && m === 'GET') {
    adminOnly()
    const q = `%${String(url.searchParams.get('q') ?? '').slice(0, 60).replace(/[%_]/g, '')}%`
    const from = Number(url.searchParams.get('from')) || 0
    const to = Number(url.searchParams.get('to')) || 9e15
    const csv = path.endsWith('.csv')
    const rows = all(`SELECT id, at, action, detail FROM audit WHERE (action LIKE ? OR detail LIKE ?) AND at BETWEEN ? AND ? ORDER BY id DESC LIMIT ${csv ? 20_000 : 500}`, q, q, from, to)
    if (!csv) return ok({ intact: auditIntact(), ...auditMark(), sealed: !!AUDIT_SECRET, rows: rows.map((r) => ({ ...r, detail: JSON.parse(r.detail) })) })
    res.writeHead(200, { ...SECURITY, 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Disposition': 'attachment; filename="mypick-기록.csv"'.replace('기록', 'audit') })
    return res.end('\ufeff' + [['번호', '때', '한 일', '누가', '자세히'], ...rows.map((r) => [r.id, new Date(r.at).toISOString(), r.action, JSON.parse(r.detail).누가 ?? '', r.detail])].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n')
  }

  if (path === '/api/admin/rooms' && m === 'GET') {
    adminOnly()
    return ok({
      rooms: all('SELECT * FROM rooms ORDER BY id DESC').map((r) => ({ id: r.id, code: r.code, title: r.title, mode: r.mode, createdAt: r.created_at, owner: r.owner, expiresAt: r.owner === 'host' && !r.archived ? r.active_at + KEEP_DAYS * 86_400_000 : null, archived: !!r.archived, rehearsal: !!r.rehearsal, tone: r.tone, liveItem: get("SELECT title FROM items WHERE room_id=? AND status='open'", r.id)?.title ?? null, present: (presence.get(r.id) ? [...presence.get(r.id).values()].filter((p) => p.conns > 0).length : 0), closed: !!r.closed, joined: joinedCount(r.id), items: get('SELECT COUNT(*) n FROM items WHERE room_id=?', r.id).n })),
    })
  }

  if (path === '/api/admin/rooms' && m === 'POST') {
    adminOnly()
    return ok({ id: createRoom(await body(req), 'admin') })
  }

  let r
  if ((r = /^\/api\/admin\/rooms\/(\d+)$/.exec(path))) {
    const room = roomById(r[1])
    if (!room) throw new Bad(404, '없는 방이에요')
    const role = mayManage(room)
    if (m === 'GET') return ok(roomView(room, { admin: true, role }))
    if (m === 'PUT') {
      ownerOnly(room)
      const b = await body(req)
      const f = roomFields(b)
      // 픽이 열려 있는 동안에는 받은 픽 공개 방식을 못 바꿔요 (도중에 켜서 엿보지 못하게)
      if (f.live !== room.live && get("SELECT 1 x FROM items WHERE room_id=? AND status='open'", room.id)) throw new Bad(409, '픽이 열려 있는 동안에는 결과 공개 방식을 바꿀 수 없어요')
      const pass = b.clearPassword ? null : f.password ? hashPass(f.password) : room.pass_hash
      run('UPDATE rooms SET title=?, pass_hash=?, capacity=?, live=?, seconds=?, grace=?, close_all=?, easy=? WHERE id=?', f.title, pass, f.capacity, f.live, f.seconds, f.grace, f.closeAll, f.easy, room.id)
      audit('방 설정 바꿈', { 방: room.id, 이름: f.title, 실시간공개: !!f.live, 정원: f.capacity, 비밀번호바꿈: pass !== room.pass_hash })
      ping(room.id)
      return ok()
    }
    if (m === 'DELETE') {
      ownerOnly(room)
      deleteRoom(room, '방 지움')
      return ok()
    }
  }

  // 결과 내려받기 (CSV). 누가 무엇을 골랐는지는 애초에 없으니 숫자만 나와요.
  if ((r = /^\/api\/admin\/rooms\/(\d+)\/results\.csv$/.exec(path)) && m === 'GET') {
    const room = roomById(r[1])
    if (!room) throw new Bad(404, '없는 방이에요')
    mayManage(room)
    const rows = [['방 이름', room.title], ['방 번호', room.code], ['내려받은 때', new Date().toISOString()], [], ['주제', '선택지', '받은 픽', '픽한 사람', '들어온 사람', '건너뜀', '마감 까닭', '통과 여부', '결과 확인 코드']]
    for (const it of all("SELECT * FROM items WHERE room_id=? AND status='closed' ORDER BY pos, id", room.id)) {
      const verdict = { pass: '통과', fail: '통과 못 함' }[outcomeOf(it)] ?? ''
      for (const o of all('SELECT label, votes FROM options WHERE item_id=? ORDER BY pos', it.id)) rows.push([it.practice ? `(연습) ${it.title}` : it.title, o.label, o.votes, it.voted, it.eligible, it.abstain, it.reason, verdict, it.proof])
    }
    res.writeHead(200, { ...SECURITY, 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="mypick-${room.code}.csv"` })
    return res.end('\ufeff' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n')
  }

  if ((r = /^\/api\/admin\/rooms\/(\d+)\/(lock|close|codes|items|cohost|block|clone|archive|keep|screen|order|logo|rehearse|hands)$/.exec(path))) {
    const room = roomById(r[1])
    if (!room) throw new Bad(404, '없는 방이에요')
    mayManage(room)
    const what = r[2]

    if (what === 'lock' && m === 'POST') {
      if (room.closed) throw new Bad(409, '끝난 방이에요')
      const locked = bool((await body(req)).locked)
      run('UPDATE rooms SET locked=? WHERE id=?', locked, room.id)
      audit(locked ? '입장 마감' : '입장 다시 엶', { 방: room.id, 들어온사람: joinedCount(room.id) })
      ping(room.id)
      return ok()
    }

    // 방 복제
    if (what === 'clone' && m === 'POST') {
      adminOnly()
      const made = cloneRoom(room, `${room.title} (복사)`)
      bumpStat('rooms')
      audit('방 복제', { 방: made.id, 번호: made.code, 원래방: room.id, 이름: room.title })
      return ok({ id: made.id })
    }

    // 리허설: 똑같은 연습 방을 만들고 가짜 참여자 10명을 넣어요. 방장이면 그 방으로 옮겨 가요.
    if (what === 'rehearse' && m === 'POST') {
      ownerOnly(room)
      if (room.rehearsal) throw new Bad(409, '리허설 방에서는 또 만들 수 없어요')
      for (const old of all('SELECT * FROM rooms WHERE rehearsal=?', room.id)) deleteRoom(old, '리허설 방 지움')
      const made = cloneRoom(room, `${room.title} (리허설)`, { owner: room.owner, rehearsal: room.id })
      for (let i = 0; i < 10; i++) run('INSERT INTO voters(room_id, token_hash, expires_at, bot) VALUES(?,?,?,1)', made.id, sha(randomBytes(32).toString('hex')), Date.now() + 86_400_000)
      audit('리허설 방 만듦', { 방: made.id, 번호: made.code, 원래방: room.id })
      return ok({ id: made.id }, admin ? undefined : hostCookie(req, made.id, 'host'))
    }
    // 리허설 끝내기: 리허설 방을 지우고 원래 방으로 돌아가요
    if (what === 'rehearse' && m === 'DELETE') {
      ownerOnly(room)
      if (!room.rehearsal) throw new Bad(409, '리허설 방이 아니에요')
      const origin = roomById(room.rehearsal)
      deleteRoom(room, '리허설 방 지움')
      return ok({ id: origin?.id ?? null }, !admin && origin ? hostCookie(req, origin.id, 'host') : undefined)
    }

    // 보관함: 끝난 방을 목록에서 치워 두되 결과는 남겨요. 보관한 방은 자동으로 지워지지 않아요.
    if (what === 'archive' && m === 'POST') {
      adminOnly()
      const archived = bool((await body(req)).archived)
      if (archived && !room.closed) throw new Bad(409, '끝낸 방만 보관할 수 있어요. 먼저 ‘방 끝내기’를 눌러 주세요.')
      run('UPDATE rooms SET archived=? WHERE id=?', archived, room.id)
      if (!archived) touch(room.id)
      audit(archived ? '방 보관' : '방 보관 풂', { 방: room.id, 이름: room.title })
      return ok()
    }

    // 자동 삭제 미루기: 오늘부터 다시 세요
    if (what === 'keep' && m === 'POST') {
      adminOnly()
      touch(room.id)
      audit('자동 삭제 미룸', { 방: room.id, 이름: room.title })
      ping(room.id)
      return ok()
    }

    // 큰 화면에 띄울 것: 자동 · 입장 안내 · 마지막 결과 · 공지
    if (what === 'screen' && m === 'POST') {
      const b = await body(req)
      if (!['auto', 'join', 'result', 'notice'].includes(b.mode)) throw new Bad(400, '큰 화면에 띄울 것을 골라 주세요')
      const notice = b.mode === 'notice' ? text(b.notice, '공지', 120) : room.screen_notice
      if (room.owner === 'host') decent(notice)
      run('UPDATE rooms SET screen_mode=?, screen_notice=? WHERE id=?', b.mode, notice, room.id)
      ping(room.id)
      return ok()
    }

    // 주제 순서 한 번에 바꾸기 (준비 중인 주제끼리만): 지금 쓰는 자리 번호들을 새 순서대로 다시 나눠 줘요
    if (what === 'order' && m === 'POST') {
      const ids = (await body(req)).ids
      const drafts = all("SELECT id, pos FROM items WHERE room_id=? AND status='draft' ORDER BY pos, id", room.id)
      if (!Array.isArray(ids) || ids.length !== drafts.length || new Set(ids).size !== ids.length || !ids.every((id) => drafts.some((d) => d.id === id))) throw new Bad(400, '준비 중인 주제만 모두 담아 순서를 보내 주세요')
      tx(() => ids.forEach((id, i) => run('UPDATE items SET pos=? WHERE id=?', drafts[i].pos, id)))
      ping(room.id)
      return ok()
    }

    // 방마다 로고 · 색 (방장 · 관리자)
    if (what === 'logo' && (m === 'POST' || m === 'DELETE')) {
      ownerOnly(room)
      const tone = url.searchParams.get('tone')
      if (tone !== null) {
        if (!['', 'blue', 'green', 'purple', 'orange', 'pink'].includes(tone)) throw new Bad(400, '색을 골라 주세요')
        run('UPDATE rooms SET tone=? WHERE id=?', tone, room.id)
        ping(room.id)
        return ok()
      }
      let logo = null
      let buf = null
      let kind = null
      if (m === 'POST') {
        buf = await readRaw(req, MAX_LOGO).catch(() => {
          throw new Bad(413, `사진이 너무 커요 (${MAX_LOGO / 1024 / 1024}MB 까지)`)
        })
        kind = imageKind(buf)
        if (!kind) throw new Bad(415, 'PNG · JPG · WebP 사진만 올릴 수 있어요')
      }
      // 새 사진이 괜찮은 것을 확인한 뒤에 옛 사진을 지워요 (잘못된 파일을 올렸다고 있던 로고가 사라지면 안 돼요)
      if (room.logo && LOGO_NAME.test(room.logo.slice('/uploads/'.length))) rmSync(join(UPLOADS, room.logo.slice('/uploads/'.length)), { force: true })
      if (m === 'POST') {
        const name = `room-${randomBytes(8).toString('hex')}.${kind}`
        await writeFile(join(UPLOADS, name), buf)
        logo = `/uploads/${name}`
      }
      run('UPDATE rooms SET logo=? WHERE id=?', logo, room.id)
      ping(room.id)
      return ok()
    }

    // 공동 진행자 비밀번호 정하기 · 지우기 (방장 · 관리자만)
    if (what === 'cohost' && m === 'POST') {
      ownerOnly(room)
      const pw = (await body(req)).password
      run('UPDATE rooms SET cohost_hash=? WHERE id=?', pw ? hashPass(text(pw, '공동 진행자 비밀번호', 100, 6)) : null, room.id)
      if (!pw) for (const [t, h] of hostSessions) if (h.roomId === room.id && h.role === 'cohost') hostSessions.delete(t)
      audit(pw ? '공동 진행자 비밀번호 정함' : '공동 진행자 없앰', { 방: room.id })
      return ok()
    }

    // 방을 지우고, 그 방을 만든 접속 주소에서는 더 못 만들게 막아요 (관리자만)
    if (what === 'block' && m === 'POST') {
      adminOnly()
      if (!room.creator) throw new Bad(409, '누구나 만들기로 만든 방만 막을 수 있어요')
      // 기간: 1 · 7 · 30일 또는 0(계속). 학교처럼 여럿이 같은 주소를 쓰는 곳도 있으니 기본은 7일.
      const days = (await body(req)).days ?? 7
      if (![0, 1, 7, 30].includes(days)) throw new Bad(400, '막는 기간을 골라 주세요')
      run('INSERT OR REPLACE INTO blocks(creator, at, why, until) VALUES(?,?,?,?)', room.creator, Date.now(), `${room.title} (${room.code})`.slice(0, 80), days ? Date.now() + days * 86_400_000 : null)
      deleteRoom(room, '방 지움 (만든 곳 막음)')
      return ok()
    }

    if (what === 'close' && m === 'POST') {
      ownerOnly(room)
      for (const it of all("SELECT * FROM items WHERE room_id=? AND status='open'", room.id)) closeItem(it, '진행자가 마감')
      run('UPDATE rooms SET closed=1, locked=1 WHERE id=?', room.id)
      touch(room.id)
      audit('방 끝냄', { 방: room.id })
      ping(room.id)
      return ok()
    }

    // 든 손 모두 내리기 (대답을 마친 뒤)
    if (what === 'hands' && m === 'DELETE') {
      hands.delete(room.id)
      ping(room.id)
      return ok()
    }
    if (what === 'codes' && m === 'GET') return ok({ codes: all('SELECT code, voter_id IS NOT NULL AS used, reopen FROM codes WHERE room_id=? ORDER BY code', room.id).map((c) => ({ code: c.code, used: !!c.used, reopen: !!c.reopen })) })
    // 쓴 코드 다시 열기: 진행자가 실물 코드를 확인한 뒤 한 번 더 들어올 수 있게 해요 (들어오면 다시 닫혀요)
    if (what === 'codes' && m === 'PUT') {
      const code = cleanCode((await body(req)).code)
      const entry = get('SELECT * FROM codes WHERE room_id=? AND code=?', room.id, code)
      if (!entry) throw new Bad(404, '이 방에 없는 코드예요. 다시 확인해 주세요.')
      if (!entry.voter_id) throw new Bad(409, '아직 쓰지 않은 코드예요. 그대로 쓰면 돼요.')
      run('UPDATE codes SET reopen=1 WHERE room_id=? AND code=?', room.id, code)
      audit('입장 코드 다시 엶', { 방: room.id, 코드끝: code.slice(-3) })
      return ok()
    }
    if (what === 'codes' && m === 'POST') {
      if (room.mode !== 'strict') throw new Bad(400, '엄격 방식 방에서만 입장 코드를 만들 수 있어요')
      const count = int((await body(req)).count, '만들 개수', 1, 500)
      if (get('SELECT COUNT(*) n FROM codes WHERE room_id=?', room.id).n + count > 5000) throw new Bad(400, '입장 코드는 방마다 5000개까지 만들 수 있어요')
      tx(() => {
        for (let i = 0; i < count; ) i += Number(run('INSERT OR IGNORE INTO codes(room_id, code) VALUES(?,?)', room.id, newCode()).changes)
      })
      audit('입장 코드 만듦', { 방: room.id, 개수: count })
      return ok()
    }

    if (what === 'items' && m === 'POST') {
      if (room.closed) throw new Bad(409, '끝난 방에는 주제를 더할 수 없어요')
      const f = itemFields(await body(req), room)
      const id = addItem(room.id, f)
      ping(room.id)
      return ok({ id })
    }
  }

  if ((r = /^\/api\/admin\/items\/(\d+)(?:\/(open|close|copy|runoff|extend|move|schedule|memo|nudge|pause|resume))?$/.exec(path))) {
    const item = get('SELECT * FROM items WHERE id=?', Number(r[1]))
    if (!item) throw new Bad(404, '없는 주제예요')
    const room = roomById(item.room_id)
    mayManage(room)
    const act = r[2]

    if (!act && (m === 'PUT' || m === 'DELETE')) {
      // 공정성: 한 번 연 주제는 고치거나 지울 수 없어요
      if (item.status !== 'draft') throw new Bad(409, '이미 열었던 주제는 고치거나 지울 수 없어요')
      if (m === 'DELETE') run('DELETE FROM items WHERE id=?', item.id)
      else {
        const f = itemFields(await body(req), room)
        tx(() => {
          run('UPDATE items SET title=?, note=?, max_pick=?, seconds=?, rule=?, practice=?, quorum=?, basis=?, shuffle=? WHERE id=?', f.title, f.note, f.maxPick, f.seconds, f.rule, f.practice, f.quorum, f.basis, f.shuffle, item.id)
          run('DELETE FROM options WHERE item_id=?', item.id)
          f.options.forEach((label, i) => run('INSERT INTO options(item_id, pos, label) VALUES(?,?,?)', item.id, i, label))
        })
      }
      return ok()
    }

    if (act === 'open' && m === 'POST') {
      if (room.closed) throw new Bad(409, '끝난 방이에요')
      if (item.status !== 'draft') throw new Bad(409, '이미 열었던 주제예요. 다시 하려면 ‘복사’로 새 주제를 만들어 주세요.')
      if (item.quorum && joinedCount(room.id) < item.quorum) throw new Bad(409, `최소 참여 인원 ${item.quorum}명이 안 됐어요 (지금 들어온 사람 ${joinedCount(room.id)}명)`)
      if (get("SELECT 1 x FROM items WHERE room_id=? AND status='open'", room.id)) throw new Bad(409, '열려 있는 주제를 먼저 마감해 주세요')
      openItem(item, room, '직접')
      return ok()
    }

    // 쉬어 가기: 남은 시간을 그대로 얼리고, 그동안은 픽을 받지 않아요 (설명을 더 할 때). 다시 시작하면 남은 시간부터 이어져요.
    if (act === 'pause' && m === 'POST') {
      if (item.status !== 'open' || item.paused) throw new Bad(409, '열려 있고 진행 중인 주제만 멈출 수 있어요')
      const left = item.closes_at ? Math.max(1000, item.closes_at - Date.now()) : null
      run("UPDATE items SET paused=1, paused_left=?, closes_at=NULL WHERE id=? AND status='open'", left, item.id)
      audit('주제 멈춤', { 방: room.id, 주제: item.id, 제목: item.title, 남은초: left === null ? null : Math.round(left / 1000) })
      ping(room.id)
      return ok()
    }
    if (act === 'resume' && m === 'POST') {
      if (item.status !== 'open' || !item.paused) throw new Bad(409, '멈춘 주제가 아니에요')
      run("UPDATE items SET paused=0, closes_at=?, paused_left=NULL WHERE id=? AND status='open'", item.paused_left === null ? null : Date.now() + item.paused_left, item.id)
      audit('주제 다시 시작', { 방: room.id, 주제: item.id, 제목: item.title })
      ping(room.id)
      return ok()
    }

    if (act === 'close' && m === 'POST') {
      if (item.status !== 'open') throw new Bad(409, '열려 있는 주제가 아니에요')
      closeItem(item, '진행자가 마감')
      return ok()
    }

    const labels = () => all('SELECT label, votes FROM options WHERE item_id=? ORDER BY pos', item.id)
    const base = { note: item.note, maxPick: item.max_pick, seconds: item.seconds, rule: item.rule, practice: item.practice, quorum: item.quorum, basis: item.basis, shuffle: item.shuffle }

    if (act === 'copy' && m === 'POST') {
      if (room.closed) throw new Bad(409, '끝난 방이에요')
      addItem(room.id, { ...base, title: `${item.title} (다시)`.slice(0, 100), options: labels().map((o) => o.label) })
      ping(room.id)
      return ok()
    }

    // 다시 고르기: 가장 많이 받은 선택지가 둘 이상(동점)일 때, 그 선택지들만으로 새 주제를 만들어요
    if (act === 'runoff' && m === 'POST') {
      if (room.closed) throw new Bad(409, '끝난 방이에요')
      if (item.status !== 'closed') throw new Bad(409, '마감된 주제에서만 동점 가리기를 만들 수 있어요')
      const opts = labels()
      const top = Math.max(0, ...opts.map((o) => o.votes))
      const tied = opts.filter((o) => o.votes === top)
      if (top === 0 || tied.length < 2) throw new Bad(409, '동점이 아니에요')
      addItem(room.id, { ...base, maxPick: 1, rule: 'none', title: `${item.title} (동점 가리기)`.slice(0, 100), options: tied.map((o) => o.label) })
      ping(room.id)
      return ok()
    }

    // 시간 연장: 열려 있는 동안만. 누가 언제 늘렸는지 기록에 남아요.
    if (act === 'extend' && m === 'POST') {
      const add = int((await body(req)).seconds, '늘릴 시간', 10, 600)
      if (item.status !== 'open' || !(item.closes_at || item.paused_left)) throw new Bad(409, '제한 시간이 있는 열린 주제만 늘릴 수 있어요')
      if (item.seconds + add > 7200) throw new Bad(409, '더는 늘릴 수 없어요')
      if (item.paused) run("UPDATE items SET paused_left=paused_left+?, seconds=seconds+? WHERE id=? AND status='open'", add * 1000, add, item.id)
      else run("UPDATE items SET closes_at=closes_at+?, seconds=seconds+? WHERE id=? AND status='open'", add * 1000, add, item.id)
      audit('시간 연장', { 방: room.id, 주제: item.id, 제목: item.title, 늘린초: add })
      ping(room.id)
      return ok()
    }

    // 진행자 메모: 진행자만 봐요. 연 뒤에도 고칠 수 있어요 (픽 내용이 아니라서요).
    if (act === 'memo' && m === 'POST') {
      const memo = String((await body(req)).memo ?? '').replace(/[\u0000-\u0008\u000b-\u001f]/g, ' ').slice(0, 1000)
      run('UPDATE items SET memo=? WHERE id=?', memo, item.id)
      return ok()
    }

    // 참여 독려: 아직 픽하지 않은 사람의 화면에만 알림이 떠요. 누가 안 했는지는 진행자도 몰라요.
    if (act === 'nudge' && m === 'POST') {
      if (item.status !== 'open') throw new Bad(409, '열려 있는 주제가 아니에요')
      if (item.nudge_at && Date.now() - item.nudge_at < 20_000) throw new Bad(429, '방금 알렸어요. 잠시 뒤에 다시 해 주세요.')
      run('UPDATE items SET nudge_at=? WHERE id=?', Date.now(), item.id)
      ping(room.id)
      return ok()
    }

    // 예약: at 여는 때 · closeAt 마감 때. 보낸 것만 바꾸고, null 이면 그 예약을 지워요.
    if (act === 'schedule' && m === 'POST') {
      const b = await body(req)
      if (item.status !== 'draft') throw new Bad(409, '열지 않은 주제만 예약할 수 있어요')
      if (room.closed) throw new Bad(409, '끝난 방이에요')
      const days = room.owner === 'host' ? KEEP_DAYS : 30
      const at = 'at' in b ? b.at : item.open_at
      const closeAt = 'closeAt' in b ? b.closeAt : item.close_at
      for (const [t, name] of [[at, '여는 때'], [closeAt, '마감 때']]) {
        if (t === null) continue
        if (!Number.isInteger(t) || t <= Date.now()) throw new Bad(400, `${name}: 지금보다 뒤의 시각으로 정해 주세요`)
        if (t > Date.now() + days * 86_400_000) throw new Bad(400, `${name}: ${days}일 안으로 정해 주세요`)
      }
      if (at !== null && closeAt !== null && closeAt <= at) throw new Bad(400, '마감 때는 여는 때보다 뒤여야 해요')
      if (at !== null || closeAt !== null) touch(room.id)
      run('UPDATE items SET open_at=?, close_at=? WHERE id=?', at, closeAt, item.id)
      const iso = (t) => (t ? new Date(t).toISOString() : '없음')
      audit(at || closeAt ? '주제 예약' : '주제 예약 취소', { 방: room.id, 주제: item.id, 제목: item.title, 여는때: iso(at), 마감때: iso(closeAt) })
      ping(room.id)
      return ok()
    }

    // 순서 바꾸기: 아직 열지 않은 주제끼리만 (이미 한 픽의 순서는 그대로 남아야 해요)
    if (act === 'move' && m === 'POST') {
      const up = (await body(req)).dir === 'up'
      if (item.status !== 'draft') throw new Bad(409, '열지 않은 주제만 순서를 바꿀 수 있어요')
      const other = get(`SELECT * FROM items WHERE room_id=? AND status='draft' AND pos ${up ? '<' : '>'} ? ORDER BY pos ${up ? 'DESC' : 'ASC'} LIMIT 1`, room.id, item.pos)
      if (other)
        tx(() => {
          run('UPDATE items SET pos=? WHERE id=?', other.pos, item.id)
          run('UPDATE items SET pos=? WHERE id=?', item.pos, other.id)
        })
      ping(room.id)
      return ok()
    }
  }

  throw new Bad(404, '없는 주소예요')
}

// ── 화면 파일 ─────────────────────────────────────────────
// 화면 파일은 한 번 줄여 두고 다시 써요 (파일이 바뀌면 새로 줄여요)
const packed = new Map() // 파일 + 방식 → { mtime, out, extra }
async function serveFile(req, res, file, cache) {
  const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream'
  const st = await stat(file)
  const texty = /^(text|application\/(json|manifest))|svg/.test(type)
  let out, extra
  const key = `${file}|${/\bbr\b/.test(res.enc || '') ? 'br' : /\bgzip\b/.test(res.enc || '') ? 'gz' : ''}`
  const hit = packed.get(key)
  if (hit && hit.mtime === st.mtimeMs) ({ out, extra } = hit)
  else {
    const data = await readFile(file)
    ;[out, extra] = texty ? pack(res, data, true) : [data, {}]
    if (texty && packed.size < 500) packed.set(key, { mtime: st.mtimeMs, out, extra })
  }
  res.writeHead(200, { ...SECURITY, 'Content-Type': type, 'Cache-Control': cache, ...extra })
  res.end(req.method === 'HEAD' ? undefined : out)
}

async function staticFile(req, res, path) {
  let rel
  try {
    rel = decodeURIComponent(path)
  } catch {
    throw new Bad(400, '잘못된 주소예요')
  }
  const file = resolve(STATIC, '.' + rel)
  if (file !== STATIC && !file.startsWith(STATIC + sep)) throw new Bad(403, '열 수 없어요') // ../ 막기
  const st = rel === '/' ? null : await stat(file).catch(() => null)
  if (st?.isFile()) return serveFile(req, res, file, rel.startsWith('/assets/') || rel.startsWith('/fonts/pretendard/') ? 'public, max-age=31536000, immutable' : 'no-cache')
  if (extname(rel)) throw new Bad(404, '없는 파일이에요')
  // 알고 있는 화면 주소만 200 으로 (/ · /m · /new · /host · /admin · /screen/방번호)
  const known = /^\/(m|new|host|remote|guide|about|feedback|verify|terms|privacy|admin|(screen|observe)\/\d{6})?\/?$/.test(rel)
  const [html, extra] = pack(res, await readFile(join(STATIC, 'index.html')))
  res.writeHead(known ? 200 : 404, { ...SECURITY, 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache', ...extra })
  res.end(req.method === 'HEAD' ? undefined : html)
}

const server = createServer(async (req, res) => {
  res.enc = String(req.headers['accept-encoding'] || '')
  if (isHttps(req)) res.setHeader('Strict-Transport-Security', 'max-age=15552000') // HTTPS 로 한 번 온 브라우저는 계속 HTTPS 로만
  try {
    const url = new URL(req.url, 'http://x')
    const path = url.pathname
    if (path === '/healthz') return json(res, 200, { ok: true })
    if (path.startsWith('/api/')) return await api(req, res, url)
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new Bad(405, '할 수 없는 요청이에요')
    if (path.startsWith('/uploads/')) {
      const name = path.slice('/uploads/'.length)
      if (!LOGO_NAME.test(name) || !existsSync(join(UPLOADS, name))) throw new Bad(404, '없는 사진이에요')
      return await serveFile(req, res, join(UPLOADS, name), 'public, max-age=31536000, immutable')
    }
    if (API_ONLY) throw new Bad(404, '없는 주소예요')
    return await staticFile(req, res, path)
  } catch (e) {
    if (!(e instanceof Bad)) console.error(e) // 픽 내용은 어디에도 찍지 않아요
    if (!res.headersSent) json(res, e instanceof Bad ? e.status : 500, { error: e instanceof Bad ? e.message : '서버에서 문제가 생겼어요' })
    else res.end()
  }
})

// 아주 느리게 보내 연결을 붙잡아 두는 요청을 끊어요
server.headersTimeout = 15_000
server.requestTimeout = 30_000

if (restoredFrom) audit('백업으로 되돌림', { 파일: restoredFrom })

server.listen(LISTEN, () => {
  console.log(`My Pick 서버: http://localhost:${LISTEN}${API_ONLY ? ' (api 만)' : ''} · 저장 ${DATA}`)
  if (!ENABLED) console.warn('⚠ ADMIN_PASSWORD 가 없거나 8자보다 짧아서 관리자 로그인이 꺼져 있어요 (.env 에 넣어 주세요)')
})
