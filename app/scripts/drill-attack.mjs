// 공격 시험 (npm run drill:attack): 내 컴퓨터의 개발 서버에만 돌려요. 운영 서버에 돌리지 마세요 (중간에 도커 컨테이너 my-pick-web-1 을 한 번 껐다 켜요).
// 공격 시험: 개발 서버(localhost)에만. 시험용 방 · 임시 계정만 쓰고 끝나면 지워요.
// 각 시도는 ‘막힘(좋음)’ · ‘뚫림(문제)’ · ‘알아 둘 것’ 으로 적어요.
import { chromium } from 'playwright-core'
import { writeFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import net from 'node:net'

const base = process.env.DRILL_URL || 'http://localhost:8082'
const out = '../docs/스크린샷/2000명 시험'
mkdirSync(out, { recursive: true })
const { ADMIN_ID = 'admin', ADMIN_PASSWORD } = process.env
const H = { 'X-Requested-With': 'mypick', 'Content-Type': 'application/json' }
async function call(cookie, method, path, body, headers = {}) {
  const res = await fetch(base + path, { method, headers: { ...(method === 'GET' ? {} : H), cookie: cookie || '', ...headers }, body: body === undefined ? undefined : typeof body === 'string' || body instanceof Buffer ? body : JSON.stringify(body) }).catch((e) => ({ status: 0, headers: new Headers(), text: async () => String(e.cause?.code ?? e.message) }))
  const set = res.headers.get('set-cookie')
  const txt = await res.text()
  let data = txt
  try {
    data = JSON.parse(txt)
  } catch {}
  return { status: res.status, data, cookie: set ? set.split(';')[0] : cookie, headers: res.headers }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const rows = []
const say = (kind, name, detail = '') => {
  rows.push({ kind, name, detail })
  console.log(`${kind === '막힘' ? '  ✓' : kind === '뚫림' ? '  ✗' : '  ·'} [${kind}] ${name}${detail ? ` → ${detail}` : ''}`)
}
const blocked = (name, cond, detail = '') => say(cond ? '막힘' : '뚫림', name, cond ? '' : detail)

const top = (await call('', 'POST', '/api/admin/login', { id: ADMIN_ID, password: ADMIN_PASSWORD })).cookie
const made = []
let b
try {
  const mk = async (body) => {
    const r = await call(top, 'POST', '/api/admin/rooms', { seconds: 60, grace: 5, ...body })
    made.push(r.data.id)
    const s = (await call(top, 'GET', `/api/admin/rooms/${r.data.id}`)).data
    return { id: r.data.id, path: `/api/admin/rooms/${r.data.id}`, code: s.room.code, screenKey: s.admin.screenKey, observerKey: s.admin.observerKey }
  }
  const A = await mk({ title: '공격 시험 가 (간편)', mode: 'simple' })
  const B = await mk({ title: '공격 시험 나 (엄격)', mode: 'strict' })
  await call(top, 'POST', `${B.path}/codes`, { count: 30 })
  const codes = (await call(top, 'GET', `${B.path}/codes`)).data.codes.map((c) => c.code)
  const addItem = async (R, body) => (await call(top, 'POST', `${R.path}/items`, body)).data.id
  const st = async (R) => (await call(top, 'GET', R.path)).data
  const join = async (R, extra = {}) => call('', 'POST', '/api/join', { room: R.code, ...extra })

  console.log('■ 1. 한 사람이 여러 번 픽하기')
  const i1 = await addItem(A, { title: '좋아하는 계절', options: ['봄', '여름'] })
  await call(top, 'POST', `/api/admin/items/${i1}/open`)
  const o1 = (await st(A)).items[0].options
  const v = await join(A)
  // 같은 사람이 같은 순간에 30번 보내요
  const burst = await Promise.all(Array.from({ length: 30 }, () => call(v.cookie, 'POST', '/api/vote', { item: i1, options: [o1[0].id] })))
  blocked('같은 사람이 같은 순간에 30번 픽 → 한 번만', burst.filter((r) => r.status === 200).length === 1 && (await st(A)).items[0].voted === 1, `받아진 것 ${burst.filter((r) => r.status === 200).length}`)
  // 간편 방: 쿠키를 지우고 다시 들어오면 새 사람
  let stuffed = 0
  for (let i = 0; i < 40; i++) {
    const x = await join(A)
    if (x.status === 200 && (await call(x.cookie, 'POST', '/api/vote', { item: i1, options: [o1[1].id] })).status === 200) stuffed++
  }
  say(stuffed > 1 ? '알아 둘 것' : '막힘', '간편 방: 쿠키를 지우고 다시 들어와 여러 번 픽 (몰표)', stuffed > 1 ? `한 사람이 ${stuffed}번 픽했어요. 간편 방식은 원래 사람을 구분하지 않아요. 한 사람 한 번이 중요하면 엄격 방식(입장 코드)을 써야 해요` : '')
  // 엄격 방: 같은 코드를 같은 순간에 20번
  const i2 = await addItem(B, { title: '좋아하는 과목', options: ['국어', '수학'] })
  const same = await Promise.all(Array.from({ length: 20 }, () => join(B, { entryCode: codes[0] })))
  const s2 = await st(B)
  blocked('엄격 방: 같은 입장 코드를 같은 순간에 20번 → 한 사람만', same.filter((r) => r.status === 200).length === 1 && s2.joined === 1, `성공 ${same.filter((r) => r.status === 200).length} · 들어온 사람 ${s2.joined}`)
  blocked('엄격 방: 코드 끝 글자를 바꿔 찍어 보기 → 맞는 것 말고는 안 들어와요', (await Promise.all(Array.from({ length: 8 }, (_, i) => join(B, { entryCode: codes[1].slice(0, 7) + 'ABCDEFGH'[i] })))).filter((r) => r.status === 200).length <= 1)

  console.log('■ 2. 이상한 입력')
  const weird = [
    ['아주 큰 요청 (5MB)', () => call(v.cookie, 'POST', '/api/vote', JSON.stringify({ item: i1, options: [o1[0].id], pad: 'x'.repeat(5_000_000) })), (r) => [400, 413, 0].includes(r.status)],
    ['깨진 JSON', () => call(v.cookie, 'POST', '/api/vote', '{"item":'), (r) => r.status === 400],
    ['JSON 대신 배열', () => call(v.cookie, 'POST', '/api/vote', '[1,2,3]'), (r) => r.status >= 400 && r.status < 500],
    ['주제 번호에 SQL 문장', () => call(v.cookie, 'POST', '/api/vote', { item: '1 OR 1=1', options: [o1[0].id] }), (r) => r.status >= 400 && r.status < 500],
    ['주제 번호에 아주 큰 수', () => call(v.cookie, 'POST', '/api/vote', { item: 1e308, options: [o1[0].id] }), (r) => r.status >= 400 && r.status < 500],
    ['선택지에 글자 · 소수 · 음수', () => call(v.cookie, 'POST', '/api/vote', { item: i1, options: ['a', 1.5, -1] }), (r) => r.status === 400],
    ['__proto__ 끼워 넣기', () => call('', 'POST', '/api/join', '{"room":"' + A.code + '","__proto__":{"admin":true},"constructor":{"prototype":{"top":true}}}'), (r) => r.status === 200 || r.status === 429],
    ['방 번호에 SQL 문장', () => call('', 'GET', `/api/room?code=${encodeURIComponent("1' OR '1'='1")}`), (r) => [404, 429].includes(r.status)],
    ['손들기에 이상한 값', () => call(v.cookie, 'POST', '/api/hand', { kind: { $ne: null } }), (r) => r.status === 400 || r.status === 429],
  ]
  for (const [name, fn, good] of weird) {
    const r = await fn()
    blocked(name, good(r) && r.status < 500, `${r.status} ${JSON.stringify(r.data).slice(0, 80)}`)
  }
  blocked('이상한 입력 뒤에도 관리자가 된 것은 아니에요', (await call(v.cookie, 'GET', '/api/admin/rooms')).status === 401 && (await call('', 'GET', '/api/admin/rooms')).status === 401)
  blocked('이상한 입력 뒤에도 서버는 살아 있어요', (await call('', 'GET', '/healthz')).status === 200)

  console.log('■ 3. 화면에 스크립트 심기 (XSS) · 눈속임 글자')
  const xss = `<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>`
  const i3 = (await call(top, 'POST', `${A.path}/items`, { title: `XSS ${xss}`.slice(0, 100), note: xss, options: [`"><svg onload=window.__pwned=1>`, `javascript:window.__pwned=1`, '보통 선택지'] })).data.id
  await call(top, 'POST', `${A.path}/screen`, { mode: 'notice', notice: xss.slice(0, 120) })
  await call(top, 'POST', `/api/admin/items/${i1}/close`)
  await call(v.cookie, 'POST', '/api/object', { item: i1, note: xss })
  await call(v.cookie, 'POST', '/api/report', { reason: '기타', note: xss })
  const fb = await call('', 'POST', '/api/feedback', { kind: '오류', note: `[공격 시험] ${xss}`, page: '/m' })
  await call(top, 'POST', `/api/admin/items/${i3}/open`)
  b = await chromium.launch({ channel: 'chrome' })
  const look = async (name, url, cookies = []) => {
    const ctx = await b.newContext({ locale: 'ko-KR', viewport: { width: 1280, height: 900 } })
    if (cookies.length) await ctx.addCookies(cookies)
    const page = await ctx.newPage()
    let alerted = false
    page.on('dialog', (d) => {
      alerted = true
      d.dismiss()
    })
    await page.goto(base + url)
    await page.waitForTimeout(1500)
    if (name.includes('신고')) await page.locator('.ad-tabs').getByRole('button', { name: /신고/ }).click().catch(() => {})
    await page.waitForTimeout(700)
    const pwned = await page.evaluate(() => window.__pwned === 1)
    blocked(`스크립트 심기: ${name}`, !pwned && !alerted, '심은 스크립트가 실행됐어요')
    if (name.includes('큰 화면')) await page.screenshot({ path: `${out}/14 공격 시험 - 스크립트를 심은 주제 (큰 화면).png` })
    await ctx.close()
  }
  const ac = [{ name: 'mp_admin', value: top.split('=')[1], url: base }]
  await look('큰 화면 (공지 · 주제)', `/screen/${A.code}?k=${A.screenKey}`)
  await look('지켜보기', `/observe/${A.code}?k=${A.observerKey}`)
  await look('참여자 화면', `/?room=${A.code}`, [{ name: 'mp_voter', value: v.cookie.split('=')[1], url: base }])
  await look('관리자 방 화면 (확인 요청 내용)', `/admin#room-${A.id}`, ac)
  await look('관리자 신고 · 제보 화면', '/admin', ac)
  const csp = (await call('', 'GET', '/')).headers
  say(csp.get('content-security-policy') ? '막힘' : '알아 둘 것', '보안 머리글 (CSP · 틀 안에 넣기 막기 · 형식 추측 막기)', `CSP ${csp.get('content-security-policy') ? '있음' : '없음'} · X-Frame-Options ${csp.get('x-frame-options') ?? '없음'} · nosniff ${csp.get('x-content-type-options') ?? '없음'} · Referrer-Policy ${csp.get('referrer-policy') ?? '없음'}`)
  // 눈속임: 보이지 않는 글자로 똑같아 보이는 선택지
  const zw = await call(top, 'POST', `${B.path}/items`, { title: '눈속임 시험', options: ['좋아요', '좋아요​', '좋아요 ', ' 좋아요 '] })
  say(zw.status === 200 ? '뚫림' : '막힘', '보이지 않는 글자로 똑같아 보이는 선택지 넣기', zw.status === 200 ? `받아졌어요: ${JSON.stringify((await st(B)).items.at(-1).options.map((o) => o.label))}. 화면에는 같은 ‘좋아요’ 가 여러 개로 보여 픽을 나눌 수 있어요 (진행자만 할 수 있는 일)` : '')
  const rtl = await call(top, 'POST', `${B.path}/items`, { title: '방향 뒤집기 ‮요아좋', options: ['가', '나'] })
  say(rtl.status === 200 && (await st(B)).items.at(-1).title.includes('‮') ? '알아 둘 것' : '막힘', '글자 방향을 뒤집는 문자(U+202E) 넣기', rtl.status === 200 && (await st(B)).items.at(-1).title.includes('\u202e') ? '받아져요. 제목이 거꾸로 보일 수 있어요 (진행자만 할 수 있는 일)' : '')

  console.log('■ 4. 남의 파일 · 주소 훔쳐보기')
  const raw = (path) =>
    new Promise((resolve) => {
      const s = net.connect(8082, '127.0.0.1', () => s.write(`GET ${path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`))
      let buf = ''
      s.on('data', (d) => (buf += d))
      s.on('end', () => resolve(buf))
      s.on('error', () => resolve(''))
      setTimeout(() => s.destroy(), 3000)
    })
  for (const p of ['/../../data/mypick.db', '/uploads/../../data/mypick.db', '/%2e%2e/%2e%2e/data/mypick.db', '/uploads/..%2f..%2fdata%2fmypick.db', '/assets/../../server.mjs', '/..%5c..%5cserver.mjs', '/.env', '/server.mjs', '/uploads/../.env', '/api/admin/backups/..%2f..%2fmypick.db']) {
    const r = await raw(p)
    const code = Number(r.slice(9, 12))
    blocked(`주소로 서버 파일 꺼내기 ${p}`, !/SQLite format|ADMIN_PASSWORD|createServer/.test(r) && (code !== 200 || /<!doctype html/i.test(r)), `${code}`)
  }
  blocked('백업 목록 · 내려받기는 로그인 없이 안 돼요', (await call('', 'GET', '/api/admin/backups')).status === 401 && (await call(v.cookie, 'GET', '/api/admin/backups/mypick-2026-11-27.db')).status === 401)
  blocked('기록 · 결과 CSV 는 로그인 없이 안 돼요', (await call('', 'GET', '/api/admin/audit')).status === 401 && (await call(v.cookie, 'GET', `${A.path}/results.csv`)).status === 401)
  blocked('참여자 쿠키를 관리자 쿠키 이름으로 바꿔 넣어도 안 돼요', (await call(`mp_admin=${v.cookie.split('=')[1]}`, 'GET', '/api/admin/rooms')).status === 401 && (await call(`mp_host=${v.cookie.split('=')[1]}`, 'GET', A.path)).status === 401)
  const guess = await Promise.all(Array.from({ length: 20 }, () => call('', 'GET', `/api/screen?room=${A.code}&k=${randomBytes(16).toString('hex')}`)))
  blocked('큰 화면 열쇠 20번 찍어 보기 → 모두 실패', guess.every((r) => r.status === 403))

  console.log('■ 5. 로고 올리기로 장난치기')
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('<html><script>window.__pwned=1</script></html>')])
  const up = await call(top, 'POST', `${A.path}/logo`, png, { 'Content-Type': 'image/png' })
  if (up.status === 200) {
    const logo = (await call('', 'GET', `/api/screen?room=${A.code}&k=${A.screenKey}`)).data.org.logo
    const f = await fetch(base + logo)
    say(f.headers.get('content-type')?.startsWith('image/') && f.headers.get('x-content-type-options') === 'nosniff' ? '막힘' : '뚫림', 'PNG 머리만 붙인 HTML 을 로고로 올리기', `올라가긴 해요. 받을 때 형식 ${f.headers.get('content-type')} · nosniff ${f.headers.get('x-content-type-options')}`)
  } else say('막힘', 'PNG 머리만 붙인 HTML 을 로고로 올리기', `${up.status}`)
  blocked('참여자는 로고를 못 올려요', (await call(v.cookie, 'POST', `${A.path}/logo`, png, { 'Content-Type': 'image/png' })).status === 401)

  console.log('■ 6. 관리자 계정 노리기')
  const pw = randomBytes(10).toString('hex')
  await call(top, 'POST', '/api/admin/admins', { name: 'drill-victim', password: pw })
  const vdev = (await call('', 'GET', '/api/org')).cookie
  await sleep(4500)
  const vic = await call(vdev, 'POST', '/api/admin/login', { id: 'drill-victim', password: pw })
  const list = (await call(top, 'GET', '/api/admin/admins')).data.admins
  blocked('일반 관리자는 다른 관리자를 지우거나 백업을 못 만들어요', (await call(vic.cookie, 'DELETE', `/api/admin/admins/${list[0].id}`)).status === 403 && (await call(vic.cookie, 'POST', '/api/admin/backups')).status === 403)
  for (let i = 0; i < 6; i++) await call('', 'POST', '/api/admin/login', { id: 'drill-victim', password: 'wrong-' + i })
  const after = await call(vdev, 'POST', '/api/admin/login', { id: 'drill-victim', password: pw })
  const stranger = await call('', 'POST', '/api/admin/login', { id: 'drill-victim', password: pw })
  blocked('남이 비밀번호를 6번 틀려도, 전에 로그인했던 관리자 기기는 그대로 들어가요', after.status === 200, `${after.status} ${after.data?.error ?? ''}`)
  blocked('그동안 처음 보는 기기의 로그인은 잠겨 있어요 (비밀번호 찍기 막기)', stranger.status === 429, `${stranger.status}`)
  let own = 0
  for (let i = 0; i < 6; i++) own = (await call(vdev, 'POST', '/api/admin/login', { id: 'drill-victim', password: 'x' + i })).status
  blocked('믿는 기기라도 자기가 5번 틀리면 그 기기는 잠겨요', own === 429, `${own}`)
  await call(top, 'DELETE', `/api/admin/admins/${list.find((a) => a.name === 'drill-victim').id}`)
  blocked('지운 관리자의 로그인은 바로 끊겨요', (await call(vic.cookie.split(';')[0], 'GET', '/api/admin/rooms')).status === 401)

  // 방장 · 공동 진행자 로그인도 같은 방식인지
  await call(top, 'POST', `${B.path}/cohost`, { password: 'cohost-secret-1' })
  const cdev = (await call('', 'GET', '/api/org')).cookie
  await sleep(4500)
  const co1 = await call(cdev, 'POST', '/api/host/login', { room: B.code, hostPassword: 'cohost-secret-1' })
  for (let i = 0; i < 6; i++) await call('', 'POST', '/api/host/login', { room: B.code, hostPassword: 'wrong-pass-' + i })
  const co2 = await call(cdev, 'POST', '/api/host/login', { room: B.code, hostPassword: 'cohost-secret-1' })
  const co3 = await call('', 'POST', '/api/host/login', { room: B.code, hostPassword: 'cohost-secret-1' })
  blocked('남이 공동 진행자 비밀번호를 6번 틀려도, 전에 들어왔던 진행자 기기는 그대로 들어가요', co1.status === 200 && co2.status === 200, `${co1.status} · ${co2.status}`)
  blocked('그동안 처음 보는 기기의 진행자 로그인은 잠겨 있어요', co3.status === 429, `${co3.status}`)

  console.log('■ 7. 진행 중에 서버가 꺼졌다 켜지면')
  const C = await mk({ title: '공격 시험 다 (재시작)', mode: 'simple' })
  const i7 = await addItem(C, { title: '재시작 시험', options: ['가', '나', '다'], seconds: 120 })
  const people = []
  for (let i = 0; i < 60; i++) people.push((await join(C)).cookie)
  await call(top, 'POST', `/api/admin/items/${i7}/open`)
  const o7 = (await st(C)).items[0].options
  for (let i = 0; i < 40; i++) await call(people[i], 'POST', '/api/vote', { item: i7, options: [o7[i % 3].id] })
  const before = (await st(C)).items[0]
  const tr = Date.now()
  execFileSync('docker', ['restart', 'my-pick-web-1'], { stdio: 'ignore' })
  let up2 = false
  for (let i = 0; i < 60 && !up2; i++) {
    await sleep(500)
    up2 = (await call('', 'GET', '/healthz')).status === 200
  }
  say('알아 둘 것', '서버가 꺼졌다 다시 응답하기까지', `${((Date.now() - tr) / 1000).toFixed(1)}초`)
  const top2 = (await call('', 'POST', '/api/admin/login', { id: ADMIN_ID, password: ADMIN_PASSWORD })).cookie
  const mid = (await call(top2, 'GET', C.path)).data
  const it7 = mid.items[0]
  blocked('서버가 다시 켜져도 열린 주제 · 남은 시간 · 픽한 사람 수가 그대로예요', up2 && it7.status === 'open' && it7.voted === 40 && it7.closesAt === before.closesAt && mid.joined === 60, `상태 ${it7.status} · 픽 ${it7.voted} · 사람 ${mid.joined}`)
  blocked('다시 켜진 뒤에도 참여자는 이어서 픽하고, 이미 픽한 사람은 또 못 해요', (await call(people[50], 'POST', '/api/vote', { item: i7, options: [o7[0].id] })).status === 200 && (await call(people[0], 'POST', '/api/vote', { item: i7, options: [o7[0].id] })).status === 409)
  blocked('서버가 다시 켜져도 관리자 로그인이 그대로 이어져요', (await call(top, 'GET', '/api/admin/rooms')).status === 200)
  await sleep(6000)
  const absent = (await call(top2, 'GET', C.path)).data
  const mid2 = (await call(top2, 'GET', C.path)).data.items[0]
  blocked('다시 켜진 뒤 아무도 다시 붙지 않아도(접속 0명) 주제가 일찍 마감되지 않아요', mid2.status === 'open' && absent.present === 0, `${mid2.status} · 접속 ${absent.present}`)
  if (mid2.status === 'open') await call(top2, 'POST', `/api/admin/items/${i7}/close`)
  const fin = (await call(top2, 'GET', C.path)).data.items[0]
  blocked('재시작을 거친 주제의 결과 · 확인 코드 · 기록이 맞아요', fin.options.map((o) => o.votes).join() === '15,13,13' && (await call('', 'GET', `/api/verify?code=${fin.proof}`)).data?.same === true && (await call(top2, 'GET', '/api/admin/audit')).data.intact === true, `${fin.options.map((o) => o.votes).join()} · ${fin.reason}`)
  say('알아 둘 것', '재시작 뒤 그 주제가 마감된 까닭', fin.reason)
  // 방을 진행 중에 통째로 지우면
  const i8 = await addItem(C, { title: '지우기 시험', options: ['가', '나'] })
  await call(top2, 'POST', `/api/admin/items/${i8}/open`)
  await call(top2, 'DELETE', C.path)
  const gone = await call(people[1], 'POST', '/api/vote', { item: i8, options: [1] })
  blocked('진행 중인 방을 지우면 참여자 요청은 깔끔하게 거절돼요 (서버 오류 없음)', [401, 404].includes(gone.status) && (await call('', 'GET', '/healthz')).status === 200, `${gone.status}`)

  console.log('■ 8. 같은 접속 주소 전체를 잠그기 (한 곳에서 장난)')
  const hdev = (await call('', 'GET', '/api/org')).cookie
  const adev = (await call('', 'GET', '/api/org')).cookie
  await sleep(4500)
  const t = Date.now()
  let n = 0
  let lockedAt = 0
  for (; n < 80 && !lockedAt; n++) if ((await call('', 'GET', `/api/room?code=${100000 + n}`)).status === 429) lockedAt = n
  const honest = await call(hdev, 'POST', '/api/join', { room: A.code })
  say(honest.status === 200 ? '막힘' : '뚫림', '없는 방 번호를 연달아 넣어 같은 주소의 모든 사람 입장 막기', honest.status === 200 ? `공격자는 ${lockedAt}번째에 잠겼지만, 화면을 열어 둔 정상 참여자는 그대로 들어와요` : `정상 참여자도 ${honest.status} ‘${honest.data?.error}’ 로 못 들어와요`)
  const ver = await call(hdev, 'GET', `/api/verify?code=${(await st(A)).items[0].proof}`) // 아직 있는 방의 마감된 주제로 확인해요
  say(ver.status === 200 ? '막힘' : '뚫림', '같은 잠금이 결과 확인까지 막는지', ver.status === 200 ? '' : `결과 확인도 ${ver.status}`)
  let mine = 0
  let at2 = 0
  for (let i = 0; i < 80 && !at2; i++) if ((mine = (await call(adev, 'GET', `/api/room?code=${200000 + i}`)).status) === 429) at2 = i
  blocked('기기 표시를 가진 공격자가 방 번호를 훑으면 그 기기만 잠겨요', at2 > 0 && (await call(hdev, 'GET', `/api/room?code=${A.code}`)).status === 200, `잠긴 때 ${at2}`)
  const cold = await call('', 'POST', '/api/join', { room: A.code })
  say('알아 둘 것', '화면을 열지 않고(기기 표시 없이) 바로 들어오려는 요청', cold.status === 429 ? '공격 중에는 60초 동안 막혀요. 브라우저로 들어오는 사람은 화면을 열 때 기기 표시를 받으니 해당 없어요' : `${cold.status}`)
  const fresh = (await call('', 'GET', '/api/org')).cookie
  const tooNew = await call(fresh, 'POST', '/api/join', { room: A.code })
  say('알아 둘 것', '공격 중에 화면을 막 연 사람이 4초 안에 방 번호를 넣으면', tooNew.status === 429 ? '아직 새 기기로 쳐서 막혀요. 4초 뒤에는 들어와요 (방 번호를 적는 데 보통 그보다 오래 걸려요)' : `${tooNew.status}`)
  const rep = (await call(top2, 'GET', '/api/admin/reports')).data
  for (const f of rep.feedback.filter((x) => x.note.startsWith('[공격 시험]'))) await call(top2, 'DELETE', `/api/admin/feedback/${f.id}`)
  for (const r of rep.reports.filter((x) => x.roomTitle.startsWith('공격 시험'))) {
    await call(top2, 'POST', `/api/admin/reports/${r.id}/handle`)
    await call(top2, 'DELETE', `/api/admin/reports/${r.id}`)
  }
} catch (e) {
  say('알아 둘 것', '시험이 중간에 멈췄어요', e.stack?.split('\n').slice(0, 3).join(' | '))
} finally {
  const t2 = (await call('', 'POST', '/api/admin/login', { id: ADMIN_ID, password: ADMIN_PASSWORD })).cookie
  for (const id of made) await call(t2, 'DELETE', `/api/admin/rooms/${id}`)
  for (const a of ((await call(t2, 'GET', '/api/admin/admins')).data?.admins ?? []).filter((x) => x.name.startsWith('drill-'))) await call(t2, 'DELETE', `/api/admin/admins/${a.id}`)
  console.log(JSON.stringify((await call(t2, 'GET', '/api/admin/rooms')).data).includes('공격 시험') ? '  ✗ 시험용 방이 남았어요' : '  ✓ 시험용 방 · 계정을 지웠어요')
  await b?.close()
}
writeFileSync(`${out}/공격 시험 결과.json`, JSON.stringify(rows, null, 2))
const count = (k) => rows.filter((r) => r.kind === k).length
console.log(`\n══ 공격 ${rows.length}가지: 막힘 ${count('막힘')} · 뚫림 ${count('뚫림')} · 알아 둘 것 ${count('알아 둘 것')}`)
for (const r of rows.filter((x) => x.kind !== '막힘')) console.log(`  [${r.kind}] ${r.name} → ${r.detail}`)
