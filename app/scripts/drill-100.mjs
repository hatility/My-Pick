// 100명 모의 진행: 관리자가 엄격 방식(입장 코드) 방을 열고, 100명(프로그램 97 + 진짜 브라우저 3)이 주제 9개를 진행해요.
// 거의 모든 기능을 써 보면서 숫자 · 응답을 견주고, 화면 사진을 남겨요. 끝나면 시험용 방 · 신고 · 제보를 지워요.
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'

const base = process.env.DRILL_URL || 'http://localhost:8082'
const out = '../docs/스크린샷/100명 시험'
mkdirSync(out, { recursive: true })
const { ADMIN_ID = 'admin', ADMIN_PASSWORD } = process.env
if (!ADMIN_PASSWORD) throw new Error('.env 에 ADMIN_PASSWORD 가 있어야 해요')
const TITLE = '100명 모의 진행 (자동 시험)'
const MARK = '[자동 시험 100명]'

const H = { 'X-Requested-With': 'mypick', 'Content-Type': 'application/json' }
async function call(cookie, method, path, body, headers) {
  const t = performance.now()
  const res = await fetch(base + path, { method, headers: { ...(method === 'GET' ? {} : H), cookie: cookie || '', ...headers }, body: body === undefined ? undefined : body instanceof Buffer ? body : JSON.stringify(body) })
  const set = res.headers.get('set-cookie')
  const type = res.headers.get('content-type') || ''
  const data = type.includes('json') ? await res.json().catch(() => null) : await res.text()
  return { status: res.status, data, cookie: set ? set.split(';')[0] : cookie, ms: performance.now() - t }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pct = (list, p) => Math.round([...list].sort((a, b) => a - b)[Math.min(list.length - 1, Math.floor(list.length * p))])

const problems = []
const passed = []
const check = (label, cond, detail = '') => {
  if (cond) passed.push(label)
  else problems.push(`${label}${detail ? ` → ${detail}` : ''}`)
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${cond || !detail ? '' : ` → ${detail}`}`)
  return cond
}
const step = (t) => console.log(`\n■ ${t}`)
const timing = {}

// ── 브라우저 ──
const b = await chromium.launch({ channel: 'chrome' })
const consoleErrors = []
const open = async (name, options, cookies = []) => {
  const ctx = await b.newContext({ locale: 'ko-KR', ...options })
  await ctx.addInitScript(() => {
    new MutationObserver(() => document.querySelector('dialog.ask[open] .ask-ok')?.click()).observe(document, { childList: true, subtree: true })
  })
  if (cookies.length) await ctx.addCookies(cookies)
  const page = await ctx.newPage()
  page.on('dialog', (d) => d.accept())
  page.on('pageerror', (e) => consoleErrors.push(`${name}: 화면 오류 ${String(e.message).slice(0, 160)}`))
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`${name}: ${m.text().slice(0, 160)}`)
  })
  return page
}
const PC = { viewport: { width: 1440, height: 900 } }
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
const TABLET = { viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1.5 }
const TV = { viewport: { width: 1920, height: 1080 } }

const photos = []
async function shot(page, name, caption, options = {}) {
  await page.waitForTimeout(options.wait ?? 1200)
  const file = `${String(photos.length + 1).padStart(2, '0')} ${name}.png`
  try {
    if (options.fullPage) await page.evaluate(() => scrollTo(0, 0))
    await page.screenshot({ path: `${out}/${file}`, fullPage: !!options.fullPage })
    photos.push([file, caption])
    console.log(`  📷 ${file}`)
  } catch (e) {
    problems.push(`사진 실패 ${name}: ${String(e.message).slice(0, 100)}`)
  }
}
/** 화면이 옆으로 넘치는지 */
const overflow = async (page, name) => {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
  check(`${name}: 옆으로 넘치지 않아요`, over <= 1, `${over}px 넘침`)
}

// ── 관리자 ──
const admin = (await call('', 'POST', '/api/admin/login', { id: ADMIN_ID, password: ADMIN_PASSWORD })).cookie
if (!admin) throw new Error('관리자 로그인이 안 돼요')
const adminCookie = { name: 'mp_admin', value: admin.split('=')[1], url: base }

let roomId = null
const extraRooms = []
const hold = new AbortController()
const streams = []
try {
  step('1. 방 만들기 · 준비 (관리자)')
  check('로그인 없이 관리자 API 를 부르면 막혀요', (await call('', 'GET', '/api/admin/rooms')).status === 401)
  const made = await call(admin, 'POST', '/api/admin/rooms', { title: TITLE, mode: 'strict', seconds: 60, grace: 5, closeAll: true, live: false })
  check('방 만들기', made.status === 200, JSON.stringify(made.data))
  roomId = made.data.id
  const room = `/api/admin/rooms/${roomId}`
  const state = async () => (await call(admin, 'GET', room)).data
  const itemOf = async (id) => (await state()).items.find((i) => i.id === id)
  const first = await state()
  const code = first.room.code
  const { screenKey, observerKey } = first.admin
  check('큰 화면 · 지켜보기 열쇠가 있어요', !!screenKey && !!observerKey)

  check('입장 코드 110개 만들기', (await call(admin, 'POST', `${room}/codes`, { count: 110 })).status === 200)
  const codes = (await call(admin, 'GET', `${room}/codes`)).data.codes.map((c) => c.code)
  check('입장 코드가 110개 · 겹치지 않아요', codes.length === 110 && new Set(codes).size === 110, `${codes.length}개`)

  // 로고 · 색
  const tmp = await open('로고', { viewport: { width: 300, height: 300 } })
  await tmp.setContent('<div style="width:256px;height:256px;display:grid;place-items:center;background:#14213d;color:#fff;font:700 96px sans-serif;border-radius:48px">100</div>')
  const png = await tmp.locator('div').screenshot()
  await tmp.context().close()
  check('방 로고 올리기 (PNG)', (await call(admin, 'POST', `${room}/logo`, png, { 'Content-Type': 'image/png' })).status === 200)
  const svgTry = await call(admin, 'POST', `${room}/logo`, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), { 'Content-Type': 'image/svg+xml' })
  check('SVG 로고는 거절해요 (415)', svgTry.status === 415, `${svgTry.status}`)
  check('거절된 뒤에도 있던 로고가 남아 있어요', (await state()).admin.hasLogo === true)
  check('방 색 바꾸기', (await call(admin, 'POST', `${room}/logo?tone=blue`)).status === 200 && (await state()).room.tone === 'blue')

  // 공동 진행자
  check('공동 진행자 비밀번호 정하기', (await call(admin, 'POST', `${room}/cohost`, { password: 'cohost-1234' })).status === 200)
  const co = await call('', 'POST', '/api/host/login', { room: code, hostPassword: 'cohost-1234' })
  check('공동 진행자로 들어가기', co.status === 200 && co.data.role === 'cohost', JSON.stringify(co.data))
  const coCookie = co.cookie
  check('공동 진행자는 방 설정을 못 바꿔요', [401, 403].includes((await call(coCookie, 'PUT', room, { title: '바꿔치기', seconds: 60, grace: 5 })).status))
  check('공동 진행자는 방을 못 지워요', [401, 403].includes((await call(coCookie, 'DELETE', room)).status))
  check('공동 진행자 비밀번호가 틀리면 막혀요', (await call('', 'POST', '/api/host/login', { room: code, hostPassword: 'wrong-pass-1' })).status === 401)

  // 주제 준비
  const add = async (body) => {
    const r = await call(admin, 'POST', `${room}/items`, body)
    if (r.status !== 200) problems.push(`주제 만들기 실패 ${body.title}: ${JSON.stringify(r.data)}`)
    return r.data?.id
  }
  const T = {}
  T.practice = await add({ title: '(연습) 지금 기분은 어때요?', note: '연습이라 결과에 안 들어가요. 누르는 법만 익혀 봐요.', options: ['좋아요', '보통이에요', '졸려요'], practice: true, seconds: 40 })
  T.major = await add({ title: '봄 체육대회를 5월 둘째 주에 열까요?', note: '절반을 넘으면 통과해요.', options: ['좋아요', '아니에요'], rule: 'majority', basis: 'voted', quorum: 80, seconds: 60 })
  T.two = await add({ title: '동아리 발표회를 저녁 시간으로 옮길까요?', note: '들어온 사람의 3분의 2가 좋다고 해야 통과해요.', options: ['옮겨요', '그대로 둬요'], rule: 'two_thirds', basis: 'joined', seconds: 60 })
  T.multi = await add({ title: '축제 부스를 두 개까지 골라 주세요', options: ['떡볶이 가게', '사진 찍는 곳', '보드게임 방', '노래 무대', '벼룩시장'], maxPick: 2, shuffle: true, seconds: 60 })
  T.tie = await add({ title: '단체 티셔츠 색을 골라 주세요', options: ['하늘색', '연두색', '노란색', '흰색'], seconds: 60 })
  T.timeout = await add({ title: '빠르게 묻기: 쉬는 시간을 5분 늘릴까요?', options: ['늘려요', '그대로요'], rule: 'majority', basis: 'valid', seconds: 12 })
  T.sched = await add({ title: '예약 주제: 다음 모임 요일', options: ['월요일', '수요일', '금요일'], seconds: 0 })
  T.live = await add({ title: '실시간 공개: 간식은 무엇으로 할까요?', options: ['과일', '빵', '김밥'], seconds: 60 })
  T.spare = await add({ title: '지울 주제', options: ['가', '나'] })
  check('주제 9개 만들기', Object.values(T).every(Boolean))
  check('선택지가 하나뿐이면 거절', (await call(admin, 'POST', `${room}/items`, { title: '하나뿐', options: ['가'] })).status === 400)
  check('같은 선택지가 둘이면 거절', (await call(admin, 'POST', `${room}/items`, { title: '겹침', options: ['가', '가'] })).status === 400)
  check('제목이 100자를 넘으면 거절', (await call(admin, 'POST', `${room}/items`, { title: '가'.repeat(101), options: ['가', '나'] })).status === 400)
  check('주제 고치기', (await call(admin, 'PUT', `/api/admin/items/${T.spare}`, { title: '지울 주제 (고침)', options: ['가', '나', '다'] })).status === 200 && (await itemOf(T.spare)).options.length === 3)
  check('주제 위로 옮기기', (await call(admin, 'POST', `/api/admin/items/${T.spare}/move`, { dir: 'up' })).status === 200)
  const drafts = (await state()).items.filter((i) => i.status === 'draft').map((i) => i.id)
  const wanted = [T.practice, T.major, T.two, T.multi, T.tie, T.timeout, T.sched, T.live, T.spare]
  check('주제 순서 한 번에 바꾸기', drafts.length === 9 && (await call(admin, 'POST', `${room}/order`, { ids: wanted })).status === 200 && (await state()).items.map((i) => i.id).join() === wanted.join())
  check('주제 복사', (await call(admin, 'POST', `/api/admin/items/${T.spare}/copy`)).status === 200)
  const copyId = (await state()).items.find((i) => i.title.endsWith('(다시)'))?.id
  check('복사한 주제 · 지울 주제 지우기', !!copyId && (await call(admin, 'DELETE', `/api/admin/items/${copyId}`)).status === 200 && (await call(admin, 'DELETE', `/api/admin/items/${T.spare}`)).status === 200 && (await state()).items.length === 8)
  check('진행자 메모 남기기', (await call(admin, 'POST', `/api/admin/items/${T.major}/memo`, { memo: '설명 뒤에 1분 주기. 질문이 나오면 잠깐 멈추기.' })).status === 200 && (await itemOf(T.major)).memo.includes('잠깐 멈추기'))
  check('지난 시각으로는 예약 못 해요', (await call(admin, 'POST', `/api/admin/items/${T.sched}/schedule`, { at: Date.now() - 1000 })).status === 400)

  // 화면들 열기
  const adminPage = await open('관리자', PC, [adminCookie])
  await adminPage.goto(`${base}/admin#room-${roomId}`)
  const tab = async (name) => adminPage.locator('.room-tabs').getByRole('button', { name, exact: true }).click({ timeout: 4000 }).catch((e) => problems.push(`관리자 화면 ‘${name}’ 탭을 못 눌렀어요: ${String(e.message).slice(0, 80)}`))
  await tab('준비')
  await shot(adminPage, '관리자 - 준비 (주제 8개)', '방을 만들고 주제 8개 · 입장 코드 110개 · 로고 · 공동 진행자를 준비했어요.', { fullPage: true })
  await overflow(adminPage, '관리자 준비')
  const screen = await open('큰 화면', TV)
  await screen.goto(`${base}/screen/${code}?k=${screenKey}`)
  check('큰 화면에 입장 안내 띄우기', (await call(admin, 'POST', `${room}/screen`, { mode: 'join' })).status === 200)
  await shot(screen, '큰 화면 - 입장 안내', '아직 아무도 없을 때 큰 화면. 방 번호 · QR 을 보여 줘요.')
  check('큰 화면 열쇠가 틀리면 못 봐요', (await call('', 'GET', `/api/screen?room=${code}&k=${'0'.repeat(32)}`)).status === 403)

  step('2. 100명 입장')
  check('없는 입장 코드는 거절 (401)', (await call('', 'POST', '/api/join', { room: code, entryCode: 'ZZZZ9999' })).status === 401)
  check('입장 코드 없이는 못 들어와요', (await call('', 'POST', '/api/join', { room: code })).status === 401)
  const bots = []
  const joinMs = []
  let t0 = performance.now()
  for (let i = 0; i < 97; i += 25) {
    const batch = await Promise.all(codes.slice(i, Math.min(97, i + 25)).map((c) => call('', 'POST', '/api/join', { room: code, entryCode: c })))
    batch.forEach((r, k) => {
      if (r.status !== 200) problems.push(`입장 실패 ${i + k}: ${JSON.stringify(r.data)}`)
      joinMs.push(r.ms)
      bots.push({ cookie: r.cookie, code: codes[i + k], ctrl: null })
    })
  }
  const listen = async (bot) => {
    bot.ctrl = new AbortController()
    const res = await fetch(`${base}/api/events?room=${code}`, { headers: { cookie: bot.cookie }, signal: bot.ctrl.signal })
    if (res.status !== 200) problems.push(`실시간 연결 실패 ${res.status}`)
    ;(async () => {
      try {
        for await (const _ of res.body);
      } catch {
        /* 끊을 때 */
      }
    })()
  }
  await Promise.all(bots.map(listen))
  streams.push(() => bots.forEach((x) => x.ctrl?.abort()))
  timing.join = `97명 입장 + 실시간 연결 ${Math.round(performance.now() - t0)}ms (한 명 가운데값 ${pct(joinMs, 0.5)}ms · 느린 쪽 95% ${pct(joinMs, 0.95)}ms)`
  // 진짜 브라우저 3대
  const phone = await open('휴대폰 참여자', PHONE)
  const tablet = await open('태블릿 참여자', TABLET)
  const desk = await open('PC 참여자', { viewport: { width: 1280, height: 800 } })
  await Promise.all([phone.goto(`${base}/?room=${code}&code=${codes[97]}`), tablet.goto(`${base}/?room=${code}&code=${codes[98]}`), desk.goto(`${base}/?room=${code}&code=${codes[99]}`)])
  await sleep(2500)
  let s = await state()
  if (s.joined !== 100) {
    // 주소만으로 저절로 들어오지 않으면 들어가기 버튼을 눌러 줘요
    for (const p of [phone, tablet, desk]) await p.getByRole('button', { name: /들어가기|입장/ }).first().click({ timeout: 3000 }).catch(() => {})
    await sleep(2000)
    s = await state()
  }
  check('들어온 사람 100명', s.joined === 100, `${s.joined}명`)
  check('지금 접속 100명', s.present === 100, `${s.present}명`)
  const browserCookie = async (page) => `mp_voter=${(await page.context().cookies()).find((c) => c.name === 'mp_voter')?.value}`
  const browsers = [
    { page: phone, name: '휴대폰' },
    { page: tablet, name: '태블릿' },
    { page: desk, name: 'PC' },
  ]
  for (const x of browsers) x.cookie = await browserCookie(x.page)
  check('휴대폰은 /m 화면으로 넘어가요', new URL(phone.url()).pathname.startsWith('/m'), phone.url())
  await shot(phone, '휴대폰 - 기다리는 화면', '입장 코드로 들어온 참여자가 첫 주제를 기다려요.')
  await overflow(phone, '휴대폰 기다림')
  await shot(tablet, '태블릿 - 기다리는 화면', '태블릿 참여자.')
  await overflow(tablet, '태블릿 기다림')

  // 입장 코드: 한 번만 · 다시 열기
  const stolen = await call('', 'POST', '/api/join', { room: code, entryCode: bots[5].code })
  check('이미 쓴 입장 코드를 다른 기기에서 넣으면 막혀요 (409)', stolen.status === 409, `${stolen.status} ${JSON.stringify(stolen.data)}`)
  check('안 쓴 코드는 다시 열 수 없어요 (409)', (await call(admin, 'PUT', `${room}/codes`, { code: codes[105] })).status === 409)
  check('없는 코드 다시 열기는 404', (await call(admin, 'PUT', `${room}/codes`, { code: 'ZZZZ9999' })).status === 404)
  check('쓴 코드 다시 열기 (진행자)', (await call(admin, 'PUT', `${room}/codes`, { code: bots[5].code })).status === 200)
  const again = await call('', 'POST', '/api/join', { room: code, entryCode: bots[5].code })
  check('다시 연 코드로 새 기기에서 들어와요', again.status === 200 && !!again.cookie)
  check('옛 기기는 끊겨요 (401)', (await call(bots[5].cookie, 'GET', '/api/me')).status === 401)
  bots[5].ctrl.abort()
  bots[5].cookie = again.cookie
  await listen(bots[5])
  check('다시 들어오면 코드가 또 닫혀요 (409)', (await call('', 'POST', '/api/join', { room: code, entryCode: bots[5].code })).status === 409)
  check('다시 들어와도 사람 수는 100명 그대로', (await state()).joined === 100)
  // 입장 마감
  check('입장 마감', (await call(admin, 'POST', `${room}/lock`, { locked: true })).status === 200)
  check('입장 마감 뒤 새 코드는 못 들어와요 (403)', (await call('', 'POST', '/api/join', { room: code, entryCode: codes[106] })).status === 403)
  check('입장 다시 열기', (await call(admin, 'POST', `${room}/lock`, { locked: false })).status === 200)
  await tab('진행')
  await shot(adminPage, '관리자 - 진행 (100명 입장)', '100명이 모두 들어온 뒤의 진행 화면.', { fullPage: true })
  await shot(screen, '큰 화면 - 100명 입장', '큰 화면에 들어온 사람 수가 보여요.')
  await call(admin, 'POST', `${room}/screen`, { mode: 'notice', notice: '곧 시작해요. 휴대폰 화면을 켜 두세요!' })
  await shot(screen, '큰 화면 - 공지', '진행자가 큰 화면에 공지를 띄웠어요.')
  await call(admin, 'POST', `${room}/screen`, { mode: 'auto' })

  // ── 픽 도우미 ──
  const optsOf = async (id) => (await itemOf(id)).options
  /** bots 가운데 plan 이 고른 사람만 픽해요. plan(i) → 선택지 번호 배열 · [] 건너뛰기 · null 안 함 */
  async function voteAll(itemId, plan, { spread = 1500, who = bots } = {}) {
    const opts = await optsOf(itemId)
    const want = opts.map(() => 0)
    let skipped = 0
    let done = 0
    const ms = []
    await Promise.all(
      who.map(async (bot) => {
        const i = bots.indexOf(bot)
        const picks = plan(i)
        if (picks === null) return
        await sleep(Math.random() * spread)
        const r = await call(bot.cookie, 'POST', '/api/vote', { item: itemId, options: picks.map((k) => opts[k].id) })
        if (r.status !== 200) return problems.push(`픽 실패 (주제 ${itemId}, ${i}번): ${r.status} ${JSON.stringify(r.data)}`)
        ms.push(r.ms)
        done++
        if (picks.length === 0) skipped++
        else picks.forEach((k) => want[k]++)
      }),
    )
    return { want, skipped, done, ms }
  }
  const voteMs = []
  const merge = (a, bb) => ({ want: a.want.map((n, i) => n + bb.want[i]), skipped: a.skipped + bb.skipped, done: a.done + bb.done })
  /** 브라우저에서 직접 눌러 픽해요 */
  async function uiVote(x, labels) {
    try {
      for (const l of labels) await x.page.locator('.row', { hasText: l }).first().locator('input').check({ timeout: 5000 })
      await x.page.getByRole('button', { name: /^(픽하기|이걸로 할래요)$/ }).click({ timeout: 5000 })
      await x.page.getByRole('button', { name: /^(픽 확정|네, 정했어요)$/ }).click({ timeout: 5000 })
      await x.page.waitForTimeout(400)
      return true
    } catch (e) {
      problems.push(`${x.name} 화면에서 픽하지 못했어요 (${labels.join(', ')}): ${String(e.message).split('\n')[0].slice(0, 120)}`)
      return false
    }
  }
  const waitClosed = async (id, ms = 20000) => {
    const until = Date.now() + ms
    let it
    while (Date.now() < until) {
      it = await itemOf(id)
      if (it.status === 'closed') return it
      await sleep(200)
    }
    return it
  }
  const openItem = async (id) => {
    const r = await call(admin, 'POST', `/api/admin/items/${id}/open`)
    check(`주제 열기: ${(await itemOf(id)).title.slice(0, 20)}`, r.status === 200, JSON.stringify(r.data))
  }
  /** 마감 결과가 보낸 픽과 맞는지 */
  const tallyOk = (it, exp, label) => {
    const got = it.options.map((o) => o.votes)
    check(`${label}: 받은 픽이 정확해요 (${exp.want.join(' / ')})`, got.join() === exp.want.join(), `받은 것 ${got.join(' / ')}`)
    check(`${label}: 픽한 사람 ${exp.done} · 건너뜀 ${exp.skipped}`, it.voted === exp.done && it.abstain === exp.skipped, `픽 ${it.voted} · 건너뜀 ${it.abstain}`)
    check(`${label}: 결과 확인 코드가 있어요`, /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(it.proof ?? ''), String(it.proof))
  }

  step('3. 연습 주제 (100명이 한꺼번에)')
  await openItem(T.practice)
  await sleep(600)
  await shot(phone, '휴대폰 - 픽 카드 (연습)', '주제가 열리면 휴대폰에 픽 카드가 떠요.')
  await overflow(phone, '휴대폰 픽 카드')
  await shot(tablet, '태블릿 - 픽 카드 (연습)', '태블릿의 픽 카드.')
  t0 = performance.now()
  let res = await voteAll(T.practice, (i) => [i % 3], { spread: 2500 })
  voteMs.push(...res.ms)
  await shot(screen, '큰 화면 - 진행 중 (97명 픽함)', '프로그램 97명이 픽한 뒤. 남은 사람 수가 보여요.', { wait: 300 })
  await shot(adminPage, '관리자 - 진행 중 (97 · 100)', '관리자 화면의 참여율.', { wait: 300 })
  const dup = await call(bots[0].cookie, 'POST', '/api/vote', { item: T.practice, options: [(await optsOf(T.practice))[1].id] })
  check('두 번 픽하면 막혀요 (409)', dup.status === 409)
  const ui1 = await Promise.all([uiVote(browsers[0], ['좋아요']), uiVote(browsers[1], ['보통이에요']), uiVote(browsers[2], ['졸려요'])])
  if (ui1[0]) res.want[0]++, res.done++
  if (ui1[1]) res.want[1]++, res.done++
  if (ui1[2]) res.want[2]++, res.done++
  let it = await waitClosed(T.practice, 8000)
  check('모두 픽하면 저절로 마감돼요', it.status === 'closed' && it.reason === '모두 픽함', `${it.status} · ${it.reason}`)
  tallyOk(it, res, '연습')
  check('연습 주제 표시', it.practice === true)
  await shot(phone, '휴대폰 - 결과 (연습)', '마감되면 결과가 바로 보여요.')
  await shot(screen, '큰 화면 - 결과 (연습)', '큰 화면의 결과 막대.')
  await overflow(screen, '큰 화면 결과')

  step('4. 절반 넘으면 통과: 잠깐 멈추기 · 손들기 · 시간 늘리기 · 독려')
  await openItem(T.major)
  check('주제가 열려 있을 때 다른 주제는 못 열어요 (409)', (await call(admin, 'POST', `/api/admin/items/${T.two}/open`)).status === 409)
  check('열린 주제는 고칠 수 없어요 (409)', (await call(admin, 'PUT', `/api/admin/items/${T.major}`, { title: '바꿔치기', options: ['가', '나'] })).status === 409)
  res = await voteAll(T.major, (i) => (i < 40 ? [i < 26 ? 0 : 1] : null))
  voteMs.push(...res.ms)
  // 키보드로 잠깐 멈추기 (스페이스)
  await adminPage.evaluate(() => document.activeElement?.blur())
  await adminPage.keyboard.press('Space')
  await sleep(700)
  let cur = await itemOf(T.major)
  if (!check('관리자 화면: 스페이스 키로 잠깐 멈추기', cur.paused === true)) await call(admin, 'POST', `/api/admin/items/${T.major}/pause`)
  cur = await itemOf(T.major)
  check('멈추면 남은 시간이 얼어요', cur.paused && cur.closesAt === null && cur.pausedLeft > 0, JSON.stringify({ p: cur.paused, c: cur.closesAt, l: cur.pausedLeft }))
  const paused = await call(bots[50].cookie, 'POST', '/api/vote', { item: T.major, options: [cur.options[0].id] })
  check('멈춘 동안에는 픽을 받지 않아요 (409)', paused.status === 409, `${paused.status}`)
  // 손들기
  const hands = await Promise.all([...bots.slice(40, 47).map((x) => call(x.cookie, 'POST', '/api/hand', { kind: 'question' })), ...bots.slice(47, 51).map((x) => call(x.cookie, 'POST', '/api/hand', { kind: 'more' }))])
  check('손들기 11명', hands.every((r) => r.status === 200))
  s = await state()
  check('진행자에게 질문 7 · 더 설명 4 로 보여요', s.hands.question === 7 && s.hands.more === 4, JSON.stringify(s.hands))
  check('손들기를 연달아 누르면 천천히 (429)', (await call(bots[40].cookie, 'POST', '/api/hand', { kind: 'more' })).status === 429)
  check('참여자에게는 내 손만 보여요', (await call(bots[41].cookie, 'GET', '/api/me')).data.myHand === 'question' && (await call(bots[60].cookie, 'GET', '/api/me')).data.hands === undefined)
  // 휴대폰에서 직접 손들기
  await phone.getByRole('button', { name: /질문/ }).first().click({ timeout: 4000 }).catch((e) => problems.push(`휴대폰에서 ‘질문 있어요’ 를 못 눌렀어요: ${String(e.message).split('\n')[0].slice(0, 100)}`))
  await sleep(500)
  check('휴대폰에서 손을 들면 8명이 돼요', (await state()).hands.question === 8, JSON.stringify((await state()).hands))
  await shot(phone, '휴대폰 - 잠깐 멈춤 · 손들기', '진행자가 멈춘 동안의 휴대폰 화면. ‘질문 있어요’ 를 눌렀어요.')
  await shot(screen, '큰 화면 - 잠깐 멈춤', '큰 화면의 멈춤 표시.')
  await shot(adminPage, '관리자 - 멈춤 · 든 손', '관리자 화면: 멈춘 주제와 든 손 수.', { fullPage: true })
  // 리모컨 (공동 진행자, 휴대폰)
  const remote = await open('리모컨', PHONE, [{ name: 'mp_host', value: coCookie.split('=')[1], url: base }])
  await remote.goto(`${base}/remote`)
  await shot(remote, '리모컨 - 공동 진행자 (멈춤 · 든 손)', '공동 진행자가 휴대폰 리모컨으로 보는 화면.')
  await overflow(remote, '리모컨')
  check('공동 진행자가 든 손을 모두 내려요', (await call(coCookie, 'DELETE', `${room}/hands`)).status === 200 && (await state()).hands.question === 0)
  // 다시 시작 · 시간 늘리기 (T 키)
  await adminPage.evaluate(() => document.activeElement?.blur())
  await adminPage.keyboard.press('Space')
  await sleep(700)
  cur = await itemOf(T.major)
  if (!check('관리자 화면: 스페이스 키로 다시 시작', cur.paused === false && cur.closesAt > Date.now())) await call(admin, 'POST', `/api/admin/items/${T.major}/resume`)
  const before = (await itemOf(T.major)).closesAt
  await adminPage.keyboard.press('KeyT')
  await sleep(700)
  cur = await itemOf(T.major)
  if (!check('관리자 화면: T 키로 30초 늘리기', cur.closesAt - before === 30000, `${cur.closesAt - before}ms`)) await call(admin, 'POST', `/api/admin/items/${T.major}/extend`, { seconds: 30 })
  check('공동 진행자도 시간을 늘릴 수 있어요', (await call(coCookie, 'POST', `/api/admin/items/${T.major}/extend`, { seconds: 10 })).status === 200)
  check('독려 알림 보내기', (await call(admin, 'POST', `/api/admin/items/${T.major}/nudge`)).status === 200)
  check('독려는 20초에 한 번 (429)', (await call(admin, 'POST', `/api/admin/items/${T.major}/nudge`)).status === 429)
  await shot(phone, '휴대폰 - 독려 알림', '아직 픽하지 않은 사람에게만 뜨는 알림.')
  // 나머지: 좋아요 30 · 아니에요 15 · 건너뛰기 12 (bots 40~96) + 브라우저 3명
  const rest = await voteAll(T.major, (i) => (i < 40 ? null : i < 70 ? [0] : i < 85 ? [1] : []))
  voteMs.push(...rest.ms)
  res = merge(res, rest)
  const ui2 = await Promise.all([uiVote(browsers[0], ['좋아요']), uiVote(browsers[1], ['좋아요']), uiVote(browsers[2], ['아니에요'])])
  if (ui2[0]) res.want[0]++, res.done++
  if (ui2[1]) res.want[0]++, res.done++
  if (ui2[2]) res.want[1]++, res.done++
  it = await waitClosed(T.major, 8000)
  check('절반 넘으면 통과: 저절로 마감', it.status === 'closed' && it.reason === '모두 픽함', `${it.status} · ${it.reason}`)
  tallyOk(it, res, '절반 통과')
  check(`좋아요 ${res.want[0]} / 픽한 사람 ${res.done} → 통과`, it.outcome === 'pass', String(it.outcome))
  await shot(screen, '큰 화면 - 통과', '절반을 넘어 ‘통과’ 로 나와요.')
  await shot(phone, '휴대폰 - 통과 결과', '휴대폰의 결과와 통과 표시.')
  await shot(tablet, '태블릿 - 통과 결과', '태블릿의 결과.')

  step('5. 3분의 2 · 들어온 사람 기준: 10명이 자리를 비움')
  bots.slice(87, 97).forEach((x) => x.ctrl.abort())
  await sleep(6500) // 기다리는 시간(5초)이 지나야 자리에 없는 것으로 봐요
  s = await state()
  check('10명이 나가면 접속 90명으로 보여요', s.present === 90, `${s.present}명`)
  await shot(adminPage, '관리자 - 접속 90 · 100', '10명이 자리를 비웠을 때.', { wait: 300 })
  await openItem(T.two)
  res = await voteAll(T.two, (i) => (i >= 87 ? null : i < 60 ? [0] : [1]))
  voteMs.push(...res.ms)
  const ui3 = await Promise.all([uiVote(browsers[0], ['옮겨요']), uiVote(browsers[1], ['옮겨요']), uiVote(browsers[2], ['그대로 둬요'])])
  if (ui3[0]) res.want[0]++, res.done++
  if (ui3[1]) res.want[0]++, res.done++
  if (ui3[2]) res.want[1]++, res.done++
  it = await waitClosed(T.two, 8000)
  check('자리에 있는 90명이 다 픽하면 저절로 마감돼요', it.status === 'closed' && it.reason === '모두 픽함', `${it.status} · ${it.reason}`)
  tallyOk(it, res, '3분의 2')
  check('참여 대상은 들어온 100명 그대로', it.eligible === 100, `${it.eligible}`)
  check(`옮겨요 ${res.want[0]} / 들어온 100명 → 3분의 2 가 안 돼 통과 못 함`, it.outcome === 'fail', String(it.outcome))
  await shot(screen, '큰 화면 - 통과 못 함', '들어온 사람 100명 기준 3분의 2 에 못 미쳐 ‘통과 못 함’.')
  const late = await call(bots[90].cookie, 'POST', '/api/vote', { item: T.two, options: [it.options[0].id] })
  check('마감 뒤에 온 픽은 막혀요 (409)', late.status === 409)
  await Promise.all(bots.slice(87, 97).map(listen))
  await sleep(800)
  check('다시 들어오면 접속 100명', (await state()).present === 100, `${(await state()).present}`)

  step('6. 여러 개 고르기 (2개까지 · 순서 섞기) · 진행자가 마감')
  await openItem(T.multi)
  const mo = await optsOf(T.multi)
  check('3개를 고르면 거절 (400)', (await call(bots[0].cookie, 'POST', '/api/vote', { item: T.multi, options: [mo[0].id, mo[1].id, mo[2].id] })).status === 400)
  check('같은 것을 두 번 고르면 거절 (400)', (await call(bots[0].cookie, 'POST', '/api/vote', { item: T.multi, options: [mo[0].id, mo[0].id] })).status === 400)
  check('없는 선택지는 거절 (400)', (await call(bots[0].cookie, 'POST', '/api/vote', { item: T.multi, options: [999999999] })).status === 400)
  check('다른 주제의 선택지는 거절 (400)', (await call(bots[0].cookie, 'POST', '/api/vote', { item: T.multi, options: [it.options[0].id] })).status === 400)
  const o1 = (await call(bots[1].cookie, 'GET', '/api/me')).data.items.find((x) => x.id === T.multi).options.map((o) => o.label).join()
  const o2 = (await call(bots[2].cookie, 'GET', '/api/me')).data.items.find((x) => x.id === T.multi).options.map((o) => o.label).join()
  const o3 = (await call(bots[3].cookie, 'GET', '/api/me')).data.items.find((x) => x.id === T.multi).options.map((o) => o.label).join()
  check('사람마다 선택지 순서가 달라요 (섞기)', new Set([o1, o2, o3]).size > 1, o1)
  check('열려 있는 동안 참여자에게 받은 픽 수는 안 보여요', (await call(bots[1].cookie, 'GET', '/api/me')).data.items.find((x) => x.id === T.multi).options.every((o) => o.votes === undefined))
  await shot(phone, '휴대폰 - 여러 개 고르기', '2개까지 고르는 픽 카드.')
  res = await voteAll(T.multi, (i) => (i >= 82 ? null : i % 7 === 0 ? [] : i % 2 ? [i % 5, (i + 2) % 5] : [i % 5]))
  voteMs.push(...res.ms)

  // ── 뒷문 찾기: 픽이 열려 있고 이미 82명이 고른 지금, 어떤 자격으로도 받은 픽 숫자를 볼 수 없어야 해요
  {
    const deep = (node, id) => {
      if (!node || typeof node !== 'object') return null
      if (!Array.isArray(node) && node.id === id && Array.isArray(node.options)) return node
      for (const v of Object.values(node)) {
        const hit = deep(v, id)
        if (hit) return hit
      }
      return null
    }
    const tries = [
      ['참여자 (픽한 사람) /api/me', bots[1].cookie, '/api/me'],
      ['참여자 (안 픽한 사람) /api/me', bots[90].cookie, '/api/me'],
      ['큰 화면 열쇠 /api/screen', '', `/api/screen?room=${code}&k=${screenKey}`],
      ['지켜보기 열쇠 /api/observe', '', `/api/observe?room=${code}&k=${observerKey}`],
      ['공동 진행자 방 자료', coCookie, room],
      ['관리자 방 자료', admin, room],
      ['관리자 한눈에', admin, '/api/admin/overview'],
      ['관리자 통계', admin, '/api/admin/stats'],
      ['관리자 기록', admin, '/api/admin/audit'],
      ['관리자 방 목록', admin, '/api/admin/rooms'],
    ]
    let leaks = 0
    for (const [name, cookie, url] of tries) {
      const r = await call(cookie, 'GET', url)
      const itm = deep(r.data, T.multi)
      const shown = itm && (itm.options.some((o) => o.votes !== undefined) || (itm.abstain !== null && itm.abstain !== undefined) || itm.outcome || itm.proof)
      const raw = JSON.stringify(r.data ?? '')
      // 기록은 예전 방들의 마감 결과도 담고 있으니, 지금 열려 있는 이 주제의 줄에 숫자(결과 · 픽)가 있는지만 봐요
      const logged = name === '관리자 기록' && (r.data?.rows ?? []).some((x) => x.detail?.주제 === T.multi && ('결과' in x.detail || '픽' in x.detail))
      if (shown || logged) {
        leaks++
        problems.push(`뒷문: ${name} 에서 열려 있는 주제의 받은 픽이 보여요 → ${JSON.stringify(itm?.options)}`)
      }
    }
    check(`열려 있는 동안: 참여자 · 큰 화면 · 지켜보기 · 공동 진행자 · 관리자 어느 쪽 응답 ${tries.length}곳에도 받은 픽 · 건너뜀 수가 없어요`, leaks === 0)
    const csvMid = await call(admin, 'GET', `${room}/results.csv`)
    check('열려 있는 동안: 결과 CSV 에 이 주제가 없어요', !String(csvMid.data).includes('축제 부스'))
    check('열려 있는 동안: 마감 전에는 결과 확인 코드가 없어 /api/verify 로도 못 봐요', (await itemOf(T.multi)).proof === null && (await call('', 'GET', '/api/verify?code=AAAA-BBBB-CCCC')).status === 404)
    const list = (await call(admin, 'GET', '/api/admin/backups')).data
    const mk = await call(admin, 'POST', '/api/admin/backups')
    check('열려 있는 동안: 최고 관리자도 백업을 새로 못 만들어요 (409)', mk.status === 409, `${mk.status}`)
    if (list?.files?.[0]) {
      const dl = await call(admin, 'GET', `/api/admin/backups/${list.files[0].name}`)
      check('열려 있는 동안: 최고 관리자도 백업을 못 내려받아요 (409)', dl.status === 409, `${dl.status}`)
    }
    // 실시간 알림에 실려 오는 것: 사람 수뿐인지 2초 동안 들어 봐요
    const ctl = new AbortController()
    const es = await fetch(`${base}/api/events?room=${code}&k=${observerKey}`, { signal: ctl.signal })
    let heard = ''
    ;(async () => {
      try {
        for await (const ch of es.body) heard += Buffer.from(ch).toString()
      } catch {
        /* 끊을 때 */
      }
    })()
    await call(bots[95].cookie, 'POST', '/api/vote', { item: T.multi, options: [mo[0].id] })
    res.want[0]++
    res.done++
    await sleep(2000)
    ctl.abort()
    const lines = heard.split('\n').filter((l) => l.startsWith('data:') && l !== 'data: 1')
    check('실시간 알림에는 사람 수만 실려요 (무엇을 골랐는지 없음)', lines.every((l) => /^data: \{"j":\d+,"p":\d+,"v":\{("\d+":\d+,?)*\}\}$/.test(l)), lines.slice(0, 2).join(' | '))
    // 상태를 바꾸는 요청은 사이트 화면에서 온 것만 (다른 사이트가 대신 보내지 못해요)
    const forged = await fetch(`${base}/api/vote`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: bots[96].cookie, Origin: 'https://evil.example' , 'X-Requested-With': 'mypick'}, body: JSON.stringify({ item: T.multi, options: [mo[0].id] }) })
    const bare = await fetch(`${base}/api/vote`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: bots[96].cookie }, body: JSON.stringify({ item: T.multi, options: [mo[0].id] }) })
    check('다른 사이트에서 대신 보낸 픽은 거절돼요 (403)', forged.status === 403 && bare.status === 403, `${forged.status} · ${bare.status}`)
  }
  const ui4 = await Promise.all([uiVote(browsers[0], ['떡볶이 가게', '노래 무대']), uiVote(browsers[1], ['보드게임 방'])])
  if (ui4[0]) res.want[0]++, res.want[3]++, res.done++
  if (ui4[1]) res.want[2]++, res.done++
  await shot(adminPage, '관리자 - 여러 개 고르기 진행 중', '아직 15명쯤 남았을 때.', { wait: 300 })
  await adminPage.evaluate(() => document.activeElement?.blur())
  await adminPage.keyboard.press('KeyM')
  await sleep(900)
  cur = await itemOf(T.multi)
  if (!check('관리자 화면: M 키로 마감', cur.status === 'closed')) await call(admin, 'POST', `/api/admin/items/${T.multi}/close`)
  it = await waitClosed(T.multi, 4000)
  check('진행자가 마감: 마감 까닭', it.reason === '진행자가 마감', it.reason)
  tallyOk(it, res, '여러 개 고르기')
  check('받은 픽의 합 = 고른 개수의 합', it.options.reduce((n, o) => n + o.votes, 0) === res.want.reduce((n, v) => n + v, 0))
  await shot(screen, '큰 화면 - 여러 개 고르기 결과', '여러 개 고르기 결과.')
  await shot(desk, 'PC 참여자 - 못 픽하고 마감됨', 'PC 참여자는 픽하지 않은 채 마감됐어요.')

  step('7. 동점 → 동점 가리기')
  check('동점이 아닌 주제는 동점 가리기를 못 만들어요 (409)', (await call(admin, 'POST', `/api/admin/items/${T.major}/runoff`)).status === 409)
  await openItem(T.tie)
  res = await voteAll(T.tie, (i) => [i < 36 ? 0 : i < 72 ? 1 : i < 88 ? 2 : 3]) // 36 / 36 / 16 / 9
  voteMs.push(...res.ms)
  const ui5 = await Promise.all([uiVote(browsers[0], ['하늘색']), uiVote(browsers[1], ['연두색']), uiVote(browsers[2], ['흰색'])])
  if (ui5[0]) res.want[0]++, res.done++
  if (ui5[1]) res.want[1]++, res.done++
  if (ui5[2]) res.want[3]++, res.done++
  it = await waitClosed(T.tie, 8000)
  tallyOk(it, res, '동점')
  await shot(screen, '큰 화면 - 동점', '하늘색과 연두색이 37 대 37 로 동점.')
  await shot(adminPage, '관리자 - 동점 결과', '관리자 화면에 ‘동점 가리기’ 가 나와요.', { fullPage: true })
  check('동점 가리기 만들기', (await call(admin, 'POST', `/api/admin/items/${T.tie}/runoff`)).status === 200)
  const run = (await state()).items.find((i) => i.title.includes('동점 가리기'))
  check('동점 가리기에는 1등 둘만 들어가요', run?.options.map((o) => o.label).join() === '하늘색,연두색', run?.options.map((o) => o.label).join())
  // 동점 가리기를 맨 앞으로 (준비 중인 것끼리)
  const d2 = (await state()).items.filter((i) => i.status === 'draft').map((i) => i.id)
  await call(admin, 'POST', `${room}/order`, { ids: [run.id, ...d2.filter((x) => x !== run.id)] })
  await openItem(run.id)
  res = await voteAll(run.id, (i) => [i < 50 ? 0 : 1])
  voteMs.push(...res.ms)
  const ui6 = await Promise.all([uiVote(browsers[0], ['하늘색']), uiVote(browsers[1], ['연두색']), uiVote(browsers[2], ['하늘색'])])
  if (ui6[0]) res.want[0]++, res.done++
  if (ui6[1]) res.want[1]++, res.done++
  if (ui6[2]) res.want[0]++, res.done++
  it = await waitClosed(run.id, 8000)
  tallyOk(it, res, '동점 가리기')
  await shot(screen, '큰 화면 - 동점 가리기 결과', '동점 가리기 결과.')

  step('8. 시간이 끝나 마감 (12초 · 60명만)')
  await openItem(T.timeout)
  res = await voteAll(T.timeout, (i) => (i >= 60 ? null : i < 28 ? [0] : i < 50 ? [1] : []), { spread: 3000 })
  voteMs.push(...res.ms)
  await shot(screen, '큰 화면 - 시간이 얼마 안 남음', '시간이 줄어드는 큰 화면.', { wait: 2500 })
  await shot(phone, '휴대폰 - 시간이 얼마 안 남음', '아직 픽하지 않은 휴대폰.', { wait: 200 })
  it = await waitClosed(T.timeout, 16000)
  check('시간이 끝나면 저절로 마감돼요', it.status === 'closed' && it.reason === '시간이 끝남', `${it.status} · ${it.reason}`)
  tallyOk(it, res, '시간 끝')
  check('늘려요 28 / 실제로 고른 50 → 절반 넘어 통과 (건너뜀 10 은 빼요)', it.outcome === 'pass', String(it.outcome))
  await shot(phone, '휴대폰 - 못 픽하고 시간이 끝남', '픽하지 못하고 마감된 사람의 화면.')

  step('9. 예약: 저절로 열리고 저절로 마감')
  const at = Date.now() + 4000
  const sc = await call(admin, 'POST', `/api/admin/items/${T.sched}/schedule`, { at, closeAt: at + 9000 })
  check('예약하기 (4초 뒤 열고 9초 뒤 마감)', sc.status === 200, JSON.stringify(sc.data))
  await shot(phone, '휴대폰 - 예약된 주제 기다림', '다음 주제가 열리는 때를 알려 줘요.', { wait: 500 })
  await sleep(4500)
  cur = await itemOf(T.sched)
  check('예약한 때에 저절로 열려요', cur.status === 'open', cur.status)
  res = await voteAll(T.sched, (i) => [i % 3], { spread: 1000 })
  voteMs.push(...res.ms)
  const ui7 = await Promise.all([uiVote(browsers[0], ['월요일']), uiVote(browsers[1], ['수요일']), uiVote(browsers[2], ['금요일'])])
  if (ui7[0]) res.want[0]++, res.done++
  if (ui7[1]) res.want[1]++, res.done++
  if (ui7[2]) res.want[2]++, res.done++
  await sleep(1500)
  cur = await itemOf(T.sched)
  check('마감 때를 정한 주제는 모두 픽해도 그때까지 열려 있어요', cur.status === 'open', cur.status)
  it = await waitClosed(T.sched, 12000)
  check('예약한 때에 저절로 마감돼요', it.status === 'closed', `${it.status} · ${it.reason}`)
  console.log(`    (마감 까닭: ${it.reason})`)
  tallyOk(it, res, '예약')

  step('10. 방 설정 바꾸기: 실시간 공개 · 쉬운 말')
  const put = await call(admin, 'PUT', room, { title: TITLE, seconds: 60, grace: 5, closeAll: true, live: true, easy: true })
  check('방 설정 바꾸기 (실시간 공개 · 쉬운 말)', put.status === 200 && (await state()).room.live === true && (await state()).room.easy === true, JSON.stringify(put.data))
  await openItem(T.live)
  check('열려 있는 동안에는 공개 방식을 못 바꿔요 (409)', (await call(admin, 'PUT', room, { title: TITLE, seconds: 60, grace: 5, live: false, easy: true })).status === 409)
  res = await voteAll(T.live, (i) => (i >= 70 ? null : [i < 30 ? 0 : i < 55 ? 1 : 2]))
  voteMs.push(...res.ms)
  const live = (await call(bots[80].cookie, 'GET', '/api/me')).data.items.find((x) => x.id === T.live)
  check('실시간 공개: 열려 있는 동안 참여자에게 받은 픽이 보여요', live.revealed === true && live.options.map((o) => o.votes).join() === '30,25,15', live.options.map((o) => o.votes).join())
  await shot(phone, '휴대폰 - 쉬운 말 · 실시간 공개', '쉬운 말 모드(큰 글자)와 실시간 공개.')
  await overflow(phone, '휴대폰 쉬운 말')
  await shot(screen, '큰 화면 - 실시간 공개 진행 중', '픽이 들어오는 대로 막대가 움직여요.', { wait: 300 })
  const rest2 = await voteAll(T.live, (i) => (i < 70 ? null : [i % 3]))
  voteMs.push(...rest2.ms)
  res = merge(res, rest2)
  const ui8 = await Promise.all([uiVote(browsers[0], ['과일']), uiVote(browsers[1], ['빵']), uiVote(browsers[2], ['김밥'])])
  if (ui8[0]) res.want[0]++, res.done++
  if (ui8[1]) res.want[1]++, res.done++
  if (ui8[2]) res.want[2]++, res.done++
  it = await waitClosed(T.live, 8000)
  tallyOk(it, res, '실시간 공개')

  step('11. 마감 뒤: 확인 요청 · 신고 · 오류 제보 · 결과 확인')
  const ob = await Promise.all(bots.slice(0, 3).map((x, i) => call(x.cookie, 'POST', '/api/object', { item: T.tie, note: `${MARK} 숫자를 한 번 더 확인해 주세요 (${i + 1})` })))
  check('확인 요청 3건', ob.every((r) => r.status === 200), ob.map((r) => r.status).join())
  check('같은 주제에 두 번은 못 보내요 (409)', (await call(bots[0].cookie, 'POST', '/api/object', { item: T.tie, note: `${MARK} 한 번 더` })).status === 409)
  check('너무 짧은 확인 요청은 거절 (400)', (await call(bots[4].cookie, 'POST', '/api/object', { item: T.tie, note: '가' })).status === 400)
  const tieNow = await itemOf(T.tie)
  check('진행자에게 확인 요청 내용이 보여요', tieNow.objections === 3 && tieNow.objectionNotes.length === 3)
  check('참여자에게는 건수만 보여요', (await call(bots[9].cookie, 'GET', '/api/me')).data.items.find((x) => x.id === T.tie).objectionNotes === undefined)
  const rp = await Promise.all([call(bots[10].cookie, 'POST', '/api/report', { reason: '기타', note: `${MARK} 신고 시험이에요` }), call(bots[11].cookie, 'POST', '/api/report', { reason: '부적절한 내용' })])
  check('신고 2건', rp.every((r) => r.status === 200), rp.map((r) => `${r.status} ${JSON.stringify(r.data)}`).join())
  check('같은 방을 두 번 신고하면 막혀요 (409)', (await call(bots[10].cookie, 'POST', '/api/report', { reason: '기타' })).status === 409)
  const fb = await call('', 'POST', '/api/feedback', { kind: '오류', note: `${MARK} 제보 시험이에요. 지워도 돼요.`, page: '/m' })
  check('오류 제보 보내기', fb.status === 200, JSON.stringify(fb.data))
  // 결과 확인 코드
  const closed = (await state()).items.filter((i) => i.status === 'closed')
  check('마감된 주제 9개', closed.length === 9, `${closed.length}`)
  let allSame = true
  for (const c of closed) {
    const v = await call('', 'GET', `/api/verify?code=${c.proof}`)
    if (!(v.status === 200 && v.data.same && v.data.logged && v.data.voted === c.voted)) {
      allSame = false
      problems.push(`결과 확인 실패 (${c.title}): ${JSON.stringify(v.data)}`)
    }
  }
  check('주제 9개 모두 결과 확인 코드로 맞게 확인돼요 (기록에도 남음)', allSame)
  check('결과 확인 코드가 서로 달라요', new Set(closed.map((c) => c.proof)).size === closed.length)
  const verify = await open('결과 확인', PC)
  await verify.goto(`${base}/verify`)
  await verify.locator('input').first().fill(closed.find((c) => c.id === T.major).proof)
  await verify.locator('input').first().press('Enter')
  await shot(verify, '결과 확인 - 확인 코드로 보기', '누구나 확인 코드로 결과가 그대로인지 볼 수 있어요.', { fullPage: true })
  await overflow(verify, '결과 확인')
  // 지켜보기
  const ov = await call('', 'GET', `/api/observe?room=${code}&k=${observerKey}`)
  check('지켜보기 화면 자료', ov.status === 200, `${ov.status}`)
  check('지켜보기 열쇠가 틀리면 못 봐요', (await call('', 'GET', `/api/observe?room=${code}&k=${'1'.repeat(32)}`)).status === 403)
  const observe = await open('지켜보기', PC)
  await observe.goto(`${base}/observe/${code}?k=${observerKey}`)
  await shot(observe, '지켜보기 - 결과와 기록', '지켜보는 사람 화면: 결과와 이 방의 기록.', { fullPage: true })
  await overflow(observe, '지켜보기')
  // 결과 내려받기 · 기록
  const csv = await call(admin, 'GET', `${room}/results.csv`)
  const lines = String(csv.data).trim().split('\r\n')
  const optionRows = closed.reduce((n, c) => n + c.options.length, 0)
  check('결과 CSV: 선택지 줄 수가 맞아요', csv.status === 200 && lines.length === 5 + optionRows, `${lines.length}줄 (기대 ${5 + optionRows})`)
  const au = await call(admin, 'GET', '/api/admin/audit')
  check('기록이 처음부터 끝까지 이어져 있어요', au.status === 200 && au.data.intact === true, JSON.stringify({ intact: au.data?.intact, sealed: au.data?.sealed }))
  const mine = au.data.rows.filter((r) => r.detail?.방 === roomId)
  console.log(`    (이 방의 기록 ${mine.length}줄: ${[...new Set(mine.map((r) => r.action))].join(' · ')})`)
  check('주제 마감 9번이 기록에 남았어요', mine.filter((r) => r.action === '주제 마감').length === 9, `${mine.filter((r) => r.action === '주제 마감').length}`)
  await shot(phone, '휴대폰 - 모든 주제가 끝난 뒤', '준비된 주제가 모두 끝난 뒤의 휴대폰 화면.', { fullPage: true })
  await shot(tablet, '태블릿 - 모든 주제가 끝난 뒤', '태블릿 화면.', { fullPage: true })
  await tab('진행')
  await shot(adminPage, '관리자 - 모든 주제 마감 (확인 요청 3건)', '주제 9개가 모두 끝난 관리자 화면.', { fullPage: true })
  await overflow(adminPage, '관리자 결과')
  await call(admin, 'POST', `${room}/screen`, { mode: 'result' })
  await shot(screen, '큰 화면 - 마지막 결과', '큰 화면에 마지막 결과를 띄워 뒀어요.')
  await tab('설정')
  await shot(adminPage, '관리자 - 방 설정', '방 설정 · 꾸미기 · 공동 진행자.', { fullPage: true })
  // 관리자 신고 탭
  const adm2 = await open('관리자 신고', PC, [adminCookie])
  await adm2.goto(`${base}/admin`)
  await adm2.locator('.ad-tabs').getByRole('button', { name: /신고/ }).click({ timeout: 4000 }).catch(() => problems.push('관리자 ‘신고’ 탭을 못 눌렀어요'))
  await shot(adm2, '관리자 - 신고 2건', '참여자가 보낸 신고가 관리자에게 모여요.', { fullPage: true })
  await adm2.locator('.ad-tabs').getByRole('button', { name: '통계', exact: true }).click({ timeout: 4000 }).catch(() => {})
  await shot(adm2, '관리자 - 통계', '오늘 통계.', { fullPage: true })

  step('12. 리허설 · 방 복제 · 방 끝내기 · 보관')
  const reh = await call(admin, 'POST', `${room}/rehearse`)
  check('리허설 방 만들기 (가짜 참여자 10명)', reh.status === 200 && (await call(admin, 'GET', `/api/admin/rooms/${reh.data.id}`)).data.joined === 10, JSON.stringify(reh.data))
  if (reh.data?.id) {
    extraRooms.push(reh.data.id)
    check('리허설 끝내기', (await call(admin, 'DELETE', `/api/admin/rooms/${reh.data.id}/rehearse`)).status === 200)
  }
  const cl = await call(admin, 'POST', `${room}/clone`)
  if (check('방 복제', cl.status === 200)) {
    extraRooms.push(cl.data.id)
    const c2 = (await call(admin, 'GET', `/api/admin/rooms/${cl.data.id}`)).data
    check('복제한 방: 주제는 그대로 · 사람과 결과는 비어 있어요', c2.items.length === 9 && c2.joined === 0 && c2.items.every((i) => i.status === 'draft'), `주제 ${c2.items.length} · 사람 ${c2.joined}`)
    check('복제한 방은 방 번호가 달라요', c2.room.code !== code)
  }
  check('진행 중인 방에서는 못 나가요 (409)', (await call(bots[20].cookie, 'POST', '/api/leave')).status === 409)
  check('끝나지 않은 방은 보관 못 해요 (409)', (await call(admin, 'POST', `${room}/archive`, { archived: true })).status === 409)
  check('방 끝내기', (await call(admin, 'POST', `${room}/close`)).status === 200)
  check('끝난 방에는 못 들어와요 (403)', (await call('', 'POST', '/api/join', { room: code, entryCode: codes[107] })).status === 403)
  check('끝난 방에는 주제를 못 더해요 (409)', (await call(admin, 'POST', `${room}/items`, { title: '더하기', options: ['가', '나'] })).status === 409)
  await shot(phone, '휴대폰 - 방이 끝난 뒤', '방이 끝나면 참여자 화면에 알려 줘요.', { fullPage: true })
  await shot(screen, '큰 화면 - 방이 끝난 뒤', '방이 끝난 큰 화면.')
  check('끝난 방에서는 나갈 수 있어요', (await call(bots[20].cookie, 'POST', '/api/leave')).status === 200)
  check('방 보관 · 보관 풀기', (await call(admin, 'POST', `${room}/archive`, { archived: true })).status === 200 && (await call(admin, 'POST', `${room}/archive`, { archived: false })).status === 200)
  const fin = await state()
  check('끝까지 들어온 사람 100명 그대로', fin.joined === 100, `${fin.joined}`)

  timing.vote = `픽 ${voteMs.length}번: 가운데값 ${pct(voteMs, 0.5)}ms · 느린 쪽 95% ${pct(voteMs, 0.95)}ms · 가장 느린 ${Math.round(Math.max(...voteMs))}ms`
} catch (e) {
  problems.push(`시험이 중간에 멈췄어요: ${e.stack?.split('\n').slice(0, 3).join(' | ')}`)
  console.error(e)
} finally {
  hold.abort()
  streams.forEach((f) => f())
  step('정리')
  // 내가 만든 신고 · 제보 · 방만 지워요
  const rep = (await call(admin, 'GET', '/api/admin/reports')).data
  for (const r of rep?.reports?.filter((x) => x.roomTitle === TITLE) ?? []) {
    await call(admin, 'POST', `/api/admin/reports/${r.id}/handle`)
    await call(admin, 'DELETE', `/api/admin/reports/${r.id}`)
  }
  for (const f of rep?.feedback?.filter((x) => x.note.startsWith(MARK)) ?? []) await call(admin, 'DELETE', `/api/admin/feedback/${f.id}`)
  for (const id of extraRooms) await call(admin, 'DELETE', `/api/admin/rooms/${id}`)
  if (roomId) await call(admin, 'DELETE', `/api/admin/rooms/${roomId}`)
  const left = (await call(admin, 'GET', '/api/admin/rooms')).data
  const names = JSON.stringify(left).includes(TITLE)
  console.log(names ? '  ✗ 시험용 방이 남아 있어요' : '  ✓ 시험용 방 · 신고 · 제보를 지웠어요')
  await b.close()
}

const uniqErrors = [...new Set(consoleErrors)]
writeFileSync(`${out}/사진 목록.md`, `# 100명 모의 진행 사진\n\n${photos.map(([f, c]) => `- **${f}** — ${c}`).join('\n')}\n`)
writeFileSync(`${out}/시험 결과.json`, JSON.stringify({ passed: passed.length, problems, consoleErrors: uniqErrors, timing }, null, 2))
console.log(`\n══ 결과: 확인 ${passed.length + problems.length}개 중 통과 ${passed.length} · 문제 ${problems.length}`)
for (const p of problems) console.log(`  ✗ ${p}`)
console.log(`브라우저 콘솔 오류 ${uniqErrors.length}가지`)
for (const e of uniqErrors.slice(0, 25)) console.log(`  · ${e}`)
console.log(`속도: ${timing.join ?? ''}\n      ${timing.vote ?? ''}`)
console.log(`사진 ${photos.length}장 → ${out}`)
