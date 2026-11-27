// 2000명 실전형 시험: 방 8개(관리자 방 5 + 누구나 만든 방장 방 3)에 2000명이 제각각 들어와요.
// 사람마다 도착 시간 · 오타 · 끊김 · 다시 접속 · 두 번 누르기 · 안 고르기를 무작위(씨앗 고정)로 정해요. 모두 같은 접속 주소(학교 한 곳)에서 온다고 봐요.
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

const base = process.env.DRILL_URL || 'http://localhost:8082'
const out = '../docs/스크린샷/2000명 시험'
mkdirSync(out, { recursive: true })
const { ADMIN_ID = 'admin', ADMIN_PASSWORD } = process.env
if (!ADMIN_PASSWORD) throw new Error('.env 에 ADMIN_PASSWORD 가 있어야 해요')
const SEED = Number(process.argv[2]) || 20261127
const TOTAL = 2000
const PREFIX = '2000명 시험'
let seed = SEED
const rnd = () => {
  seed |= 0
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const pickOf = (list) => list[Math.floor(rnd() * list.length)]
const between = (a, b) => a + Math.floor(rnd() * (b - a + 1))
const H = { 'X-Requested-With': 'mypick', 'Content-Type': 'application/json' }
const statusCount = {}
const slowest = { join: [], vote: [], me: [], admin: [] }
async function call(cookie, method, path, body, kind) {
  const t = performance.now()
  let res
  try {
    res = await fetch(base + path, { method, headers: { ...(method === 'GET' ? {} : H), cookie: cookie || '' }, body: body === undefined ? undefined : JSON.stringify(body) })
  } catch (e) {
    statusCount['연결 실패'] = (statusCount['연결 실패'] ?? 0) + 1
    return { status: 0, data: null, cookie, ms: performance.now() - t }
  }
  const set = res.headers.get('set-cookie')
  const data = (res.headers.get('content-type') || '').includes('json') ? await res.json().catch(() => null) : await res.text()
  const ms = performance.now() - t
  if (kind) slowest[kind].push(ms)
  if (res.status >= 500) statusCount[`${res.status} ${path.split('?')[0]}`] = (statusCount[`${res.status} ${path.split('?')[0]}`] ?? 0) + 1
  return { status: res.status, data, cookie: set ? set.split(';')[0] : cookie, ms }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pct = (list, p) => (list.length ? Math.round([...list].sort((a, b) => a - b)[Math.min(list.length - 1, Math.floor(list.length * p))]) : 0)
const problems = []
const notes = []
let passed = 0
const check = (label, cond, detail = '') => {
  if (cond) passed++
  else problems.push(`${label}${detail ? ` → ${detail}` : ''}`)
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${cond || !detail ? '' : ` → ${detail}`}`)
  return cond
}

const top = (await call('', 'POST', '/api/admin/login', { id: ADMIN_ID, password: ADMIN_PASSWORD })).cookie
if (!top) throw new Error('관리자 로그인이 안 돼요')
const rooms = []
const aborts = new Set()
const photos = []
const stat = { typos: 0, locked: 0, lockedWaitMs: 0, joinFail: 0, noStream: 0, dropped: 0, back: 0, doubles: 0, doublesRefused: 0, lateRefused: 0, hands: 0, pollers: 0, joinTries: 0 }
let b
const t00 = performance.now()
try {
  console.log(`■ 씨앗 ${SEED} · 준비`)
  const pw = randomBytes(12).toString('hex')
  for (let i = 1; i <= 5; i++) await call(top, 'POST', '/api/admin/admins', { name: `drill-admin-${i}`, password: pw })
  const mgr = []
  for (let i = 1; i <= 5; i++) mgr.push((await call('', 'POST', '/api/admin/login', { id: `drill-admin-${i}`, password: pw })).cookie)
  // 방 크기를 무작위로 나눠요 (합 2000)
  const weights = Array.from({ length: 8 }, () => 0.5 + rnd())
  const sum = weights.reduce((a, x) => a + x, 0)
  const sizes = weights.map((w) => Math.floor((w / sum) * TOTAL))
  sizes[0] += TOTAL - sizes.reduce((a, x) => a + x, 0)
  const TOPICS = [
    ['체험 학습 장소', ['박물관', '과학관', '수목원', '놀이공원']],
    ['급식에 더 나왔으면 하는 것', ['과일', '샐러드', '면 요리', '국물 요리', '빵']],
    ['쉬는 시간을 늘릴까요?', ['좋아요', '아니에요']],
    ['학급 티셔츠 색', ['남색', '흰색', '초록색']],
    ['동아리 발표 날짜를 금요일로 할까요?', ['좋아요', '아니에요']],
    ['교실에 두고 싶은 것', ['책꽂이', '화분', '보드게임', '시계', '거울', '게시판']],
  ]
  for (let k = 0; k < 8; k++) {
    const host = k >= 5
    const strict = !host && rnd() < 0.5
    const password = rnd() < 0.4 ? `pass-${between(1000, 9999)}` : undefined
    const body = { title: `${PREFIX} ${k + 1} · ${host ? '방장 방' : strict ? '입장 코드' : '간편'}${password ? ' · 비밀번호' : ''}`, mode: strict ? 'strict' : 'simple', seconds: between(25, 40), grace: 5, closeAll: true, live: rnd() < 0.25, easy: rnd() < 0.2, password }
    let boss
    let id
    if (host) {
      const r = await call('', 'POST', '/api/host/create', { ...body, hostPassword: `host-${k}-secret` })
      if (r.status === 200) {
        id = r.data.id
        boss = r.cookie
      } else notes.push(`방장 방 ${k + 1} 만들기 ${r.status}: ${r.data?.error ?? ''} → 관리자 방으로 대신 만들었어요`)
    }
    if (!id) {
      boss = mgr[k % 5]
      id = (await call(boss, 'POST', '/api/admin/rooms', body)).data.id
    }
    const path = `/api/admin/rooms/${id}`
    const s = (await call(boss, 'GET', path)).data
    const R = { k, id, path, boss, host: host && boss.startsWith('mp_host'), strict, password, size: sizes[k], code: s.room.code, screenKey: s.admin.screenKey, observerKey: s.admin.observerKey, live: body.live, items: [], people: [], codes: [] }
    if (strict) {
      await call(boss, 'POST', `${path}/codes`, { count: Math.min(500, R.size + 10) })
      R.codes = (await call(boss, 'GET', `${path}/codes`)).data.codes.map((c) => c.code)
    }
    for (let i = 0; i < 3; i++) {
      const [title, options] = pickOf(TOPICS)
      const two = options.length === 2
      const def = { title: `${k + 1}-${i + 1}. ${title}`, options, seconds: between(20, 35), ...(two ? { rule: pickOf(['majority', 'two_thirds']), basis: pickOf(['voted', 'valid', 'joined']) } : { maxPick: rnd() < 0.4 ? 2 : 1, shuffle: rnd() < 0.5 }) }
      const r = await call(boss, 'POST', `${path}/items`, def)
      if (r.status === 200) R.items.push({ id: r.data.id, ...def })
      else problems.push(`[방 ${k + 1}] 주제 만들기 ${r.status} ${JSON.stringify(r.data)}`)
    }
    rooms.push(R)
  }
  console.log(`  방 8개: ${rooms.map((R) => `${R.k + 1}번 ${R.size}명${R.host ? '(방장)' : ''}${R.strict ? '(코드)' : ''}${R.password ? '(비번)' : ''}${R.live ? '(실시간)' : ''}`).join(' · ')}`)
  check('방 8개 · 주제 24개 준비', rooms.length === 8 && rooms.every((R) => R.items.length === 3))

  // ── 사람 2000명 ──
  const listen = async (R, p) => {
    p.ctrl = new AbortController()
    aborts.add(p.ctrl)
    try {
      const res = await fetch(`${base}/api/events?room=${R.code}`, { headers: { cookie: p.cookie }, signal: p.ctrl.signal })
      if (res.status !== 200) {
        p.stream = false
        if (res.status === 503) stat.noStream++
        else statusCount[`실시간 ${res.status}`] = (statusCount[`실시간 ${res.status}`] ?? 0) + 1
        return
      }
      p.stream = true
      ;(async () => {
        try {
          for await (const _ of res.body);
        } catch {
          /* 끊김 */
        }
      })()
    } catch {
      p.stream = false
    }
  }
  async function arrive(R, i) {
    const p = { i, joined: false, cookie: '', voted: {} }
    R.people.push(p)
    await sleep(rnd() * 20000) // 20초에 걸쳐 제각각 도착
    // 실제처럼: 먼저 화면을 열고(기기 표시를 받아요), 방 번호를 적는 데 몇 초 걸려요
    const dev = (await call('', 'GET', '/api/org')).cookie
    if (!dev) stat.noDev = (stat.noDev ?? 0) + 1
    await sleep(4500 + rnd() * 4000)
    const good = { room: R.code, password: R.password, entryCode: R.codes[i] }
    // 100명 중 4명은 처음에 한 번 틀려요 (방 번호 · 비밀번호 · 코드 오타)
    let typo = rnd() < 0.04
    for (let tries = 0; tries < 12 && !p.joined; tries++) {
      stat.joinTries++
      const body = typo ? (R.strict ? { ...good, entryCode: 'XXXX' + between(1000, 9999) } : R.password ? { ...good, password: 'typo-pass' } : { ...good, room: String(between(100000, 999999)) }) : good
      const r = await call(dev, 'POST', '/api/join', body, 'join')
      if (typo) {
        stat.typos++
        typo = false
        if (r.status === 429) {
          stat.locked++
          const wait = (Number(/(\d+)초/.exec(r.data?.error ?? '')?.[1]) || 5) * 1000 + rnd() * 1500
          stat.lockedWaitMs += wait
          await sleep(wait)
        } else await sleep(1500 + rnd() * 2500) // 다시 적는 시간
        continue
      }
      if (r.status === 200) {
        p.joined = true
        p.cookie = r.cookie
        p.joinedAt = performance.now()
      } else if (r.status === 429) {
        stat.locked++
        const wait = (Number(/(\d+)초/.exec(r.data?.error ?? '')?.[1]) || 5) * 1000 + rnd() * 1500
        stat.lockedWaitMs += wait
        await sleep(wait)
      } else {
        stat.joinFail++
        statusCount[`입장 ${r.status} ${r.data?.error ?? ''}`] = (statusCount[`입장 ${r.status} ${r.data?.error ?? ''}`] ?? 0) + 1
        await sleep(2000)
      }
    }
    if (!p.joined) return
    await call(p.cookie, 'GET', '/api/me', undefined, 'me')
    await listen(R, p)
    if (!p.stream) stat.pollers++
  }
  /** 한 사람이 주제 하나에서 하는 일 */
  async function act(R, p, item, opts, acc, secs) {
    if (!p.joined) return
    const roll = rnd()
    // 3%: 중간에 연결이 끊겼다가 (그중 3분의 2는) 다시 붙어요
    if (rnd() < 0.03 && p.stream) {
      await sleep(rnd() * secs * 400)
      p.ctrl.abort()
      aborts.delete(p.ctrl)
      p.stream = false
      stat.dropped++
      if (rnd() < 0.66) {
        await sleep(2000 + rnd() * 6000)
        await listen(R, p)
        stat.back++
      } else if (rnd() < 0.5) return // 돌아오지 않음
    }
    if (roll < 0.1) return // 10%: 안 골라요
    await sleep(500 + rnd() * rnd() * secs * 1000 * 1.15) // 대부분 빨리, 몇몇은 마감 직전 · 직후
    if (rnd() < 0.03) {
      const h = await call(p.cookie, 'POST', '/api/hand', { kind: pickOf(['question', 'more']) })
      if (h.status === 200) stat.hands++
    }
    await call(p.cookie, 'GET', '/api/me', undefined, 'me') // 화면이 상태를 다시 읽어요
    const n = roll < 0.15 ? 0 : item.maxPick === 2 && rnd() < 0.6 ? 2 : 1
    const mine = [...opts].sort(() => rnd() - 0.5).slice(0, n)
    const r = await call(p.cookie, 'POST', '/api/vote', { item: item.id, options: mine.map((o) => o.id) }, 'vote')
    if (r.status === 200) {
      acc.done++
      if (!n) acc.skipped++
      else for (const o of mine) acc.want[o.id] = (acc.want[o.id] ?? 0) + 1
      if (rnd() < 0.02) {
        stat.doubles++
        const again = await call(p.cookie, 'POST', '/api/vote', { item: item.id, options: [opts[0].id] })
        if (again.status === 409) stat.doublesRefused++
        else problems.push(`[방 ${R.k + 1}] 두 번 누른 픽이 ${again.status} 로 받아졌어요`)
      }
    } else if (r.status === 409) stat.lateRefused++
    else if (r.status === 401) acc.unauth = (acc.unauth ?? 0) + 1
    else problems.push(`[방 ${R.k + 1}] 픽 오류 ${r.status} ${JSON.stringify(r.data)}`)
  }
  /** 진행자: 방 하나의 주제 3개를 차례로 */
  async function host(R) {
    const st = async () => (await call(R.boss, 'GET', R.path, undefined, 'admin')).data
    for (const item of R.items) {
      await sleep(1500 + rnd() * 3000)
      const o = await call(R.boss, 'POST', `/api/admin/items/${item.id}/open`)
      if (o.status !== 200) {
        problems.push(`[방 ${R.k + 1}] 주제 열기 ${o.status} ${JSON.stringify(o.data)}`)
        continue
      }
      const opts = (await st()).items.find((x) => x.id === item.id).options
      const acc = { want: {}, done: 0, skipped: 0 }
      const everyone = Promise.all(R.people.map((p) => act(R, p, item, opts, acc, item.seconds)))
      // 진행자가 하는 일을 무작위로: 멈췄다 다시 시작 · 시간 늘리기 · 독려 · 일찍 마감
      const plan = rnd()
      await sleep(item.seconds * 300)
      if (plan < 0.3) {
        await call(R.boss, 'POST', `/api/admin/items/${item.id}/pause`)
        await sleep(2000 + rnd() * 3000)
        await call(R.boss, 'POST', `/api/admin/items/${item.id}/resume`)
      } else if (plan < 0.5) await call(R.boss, 'POST', `/api/admin/items/${item.id}/extend`, { seconds: 10 })
      else if (plan < 0.7) await call(R.boss, 'POST', `/api/admin/items/${item.id}/nudge`)
      await call(R.boss, 'DELETE', `${R.path}/hands`)
      if (plan > 0.85) {
        await sleep(item.seconds * 350)
        await call(R.boss, 'POST', `/api/admin/items/${item.id}/close`)
      }
      await everyone
      let it
      for (let i = 0; i < 240; i++) {
        it = (await st()).items.find((x) => x.id === item.id)
        if (it.status === 'closed') break
        await sleep(500)
      }
      if (it.status !== 'closed') {
        await call(R.boss, 'POST', `/api/admin/items/${item.id}/close`)
        it = (await st()).items.find((x) => x.id === item.id)
      }
      const got = it.options.map((x) => x.votes).join()
      const exp = it.options.map((x) => acc.want[x.id] ?? 0).join()
      item.result = { ok: got === exp && it.voted === acc.done && it.abstain === acc.skipped, got, exp, voted: it.voted, done: acc.done, reason: it.reason, proof: it.proof, eligible: it.eligible, unauth: acc.unauth ?? 0 }
      if (!item.result.ok) problems.push(`[방 ${R.k + 1}] ${item.title}: 서버 ${got} (픽 ${it.voted} · 건너뜀 ${it.abstain}) ≠ 보낸 것 ${exp} (픽 ${acc.done} · 건너뜀 ${acc.skipped})`)
      else passed++
    }
    R.final = await st()
  }

  console.log('■ 입장 (20초에 걸쳐 2000명, 100명 중 4명은 오타)')
  b = await chromium.launch({ channel: 'chrome' })
  const shot = async (page, name, wait = 1000, fullPage = false) => {
    await page.waitForTimeout(wait)
    const file = `${String(photos.length + 1).padStart(2, '0')} ${name}.png`
    await page.screenshot({ path: `${out}/${file}`, fullPage }).then(() => photos.push(file), () => {})
  }
  const pageOf = async (options, cookies = []) => {
    const ctx = await b.newContext({ locale: 'ko-KR', ...options })
    if (cookies.length) await ctx.addCookies(cookies)
    return ctx.newPage()
  }
  const big = [...rooms].sort((x, y) => y.size - x.size)[0]
  const ap = await pageOf({ viewport: { width: 1440, height: 900 } }, [{ name: 'mp_admin', value: top.split('=')[1], url: base }])
  const tv = await pageOf({ viewport: { width: 1920, height: 1080 } })
  const ob = await pageOf({ viewport: { width: 1440, height: 900 } })
  const ph = await pageOf({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  await tv.goto(`${base}/screen/${big.code}?k=${big.screenKey}`)
  await ob.goto(`${base}/observe/${big.code}?k=${big.observerKey}`)
  const tJoin = performance.now()
  const arriving = Promise.all(rooms.flatMap((R) => Array.from({ length: R.size }, (_, i) => arrive(R, i))))
  await sleep(12000)
  await shot(tv, `큰 화면 - 가장 큰 방(${big.size}명) 입장 중`, 300)
  await ap.goto(`${base}/admin`)
  await shot(ap, '관리자 - 한눈에 (입장 몰리는 중)', 1200, true)
  await arriving
  const joinSecs = Math.round((performance.now() - tJoin) / 1000)
  const joined = rooms.reduce((n, R) => n + R.people.filter((p) => p.joined).length, 0)
  check(`2000명이 모두 들어왔어요 (${joinSecs}초 걸림)`, joined === TOTAL, `${joined}명`)
  const ov = (await call(top, 'GET', '/api/admin/overview')).data
  console.log(`  실시간 연결 ${ov.server.connections} / ${ov.server.maxConnections} · 연결 자리가 없어 못 붙은 사람 ${stat.noStream}명`)
  await shot(tv, `큰 화면 - 가장 큰 방(${big.size}명) 모두 입장`, 800)

  console.log('■ 진행 (방 8개가 제각각 주제 3개씩)')
  const running = Promise.all(rooms.map((R) => host(R).catch((e) => problems.push(`[방 ${R.k + 1}] 진행 멈춤: ${e.stack?.split('\n').slice(0, 2).join(' | ')}`))))
  // 진행 중: 진짜 휴대폰 한 대가 간편 방에 들어와 직접 픽해 봐요
  const simple = rooms.find((R) => !R.strict && !R.password) ?? rooms.find((R) => !R.strict)
  await sleep(9000)
  await ph.goto(`${base}/?room=${simple.code}`)
  await ph.waitForTimeout(1500)
  if (simple.password) await ph.locator('input[type=password]').first().fill(simple.password).catch(() => {})
  await ph.getByRole('button', { name: /들어가기|입장/ }).first().click({ timeout: 3000 }).catch(() => {})
  await shot(ph, `휴대폰 - 진행 중인 방(${simple.size}명)에 늦게 들어옴`, 2000)
  const t1 = performance.now()
  const uiOk = await (async () => {
    for (let i = 0; i < 40; i++) {
      const row = ph.locator('.row input').first()
      if (await row.count()) {
        await row.check({ timeout: 2000 }).catch(() => {})
        await ph.getByRole('button', { name: /^(픽하기|이걸로 할래요)$/ }).click({ timeout: 2000 }).catch(() => {})
        const okBtn = ph.getByRole('button', { name: /^(픽 확정|네, 정했어요)$/ })
        if (await okBtn.count()) {
          await okBtn.click({ timeout: 2000 }).catch(() => {})
          return true
        }
      }
      await sleep(1000)
    }
    return false
  })()
  simple.extra = uiOk
  notes.push(uiOk ? `진짜 휴대폰이 진행 중에 ${simple.k + 1}번 방에 들어와 직접 픽했어요 (${Math.round((performance.now() - t1) / 1000)}초 안에). 이 한 표 때문에 그 방 주제 하나는 서버 숫자가 1 많게 나와요` : '진짜 휴대폰은 픽 카드를 만나지 못했어요 (들어온 때 열린 주제가 없었을 수 있어요)')
  await shot(ph, '휴대폰 - 픽한 뒤', 800)
  await shot(tv, `큰 화면 - 가장 큰 방 진행 중`, 300)
  await ob.reload()
  await shot(ob, '지켜보기 - 가장 큰 방 진행 중', 1200, true)
  await ap.reload()
  await shot(ap, '관리자 - 한눈에 (방 8개 진행 중)', 1200, true)
  await ap.goto(`${base}/admin#room-${big.id}`)
  await shot(ap, `관리자 - 가장 큰 방(${big.size}명) 진행 화면`, 1200, true)
  // 진행 중 서버 응답: 화면 파일
  const probe = []
  for (let i = 0; i < 20; i++) {
    const t = performance.now()
    await fetch(`${base}/`).then((r) => r.text())
    probe.push(performance.now() - t)
    await sleep(500)
  }
  check('진행 중에도 첫 화면이 0.5초 안에 열려요', pct(probe, 0.95) < 500, `느린 쪽 ${pct(probe, 0.95)}ms`)
  await running

  console.log('■ 끝난 뒤 확인')
  const items = rooms.flatMap((R) => R.items)
  const okItems = items.filter((i) => i.result?.ok).length
  check(`주제 ${items.length}개 모두 받은 픽이 보낸 것과 정확히 같아요 (진짜 휴대폰이 넣은 한 표는 따로 봐요)`, okItems >= items.length - (uiOk ? 1 : 0), `${okItems}개만 일치`)
  let bad = 0
  for (const it of items) {
    if (!it.result?.proof) {
      bad++
      continue
    }
    const v = await call('', 'GET', `/api/verify?code=${it.result.proof}`)
    if (!(v.status === 200 && v.data.same && v.data.logged)) bad++
  }
  check(`결과 확인 코드 ${items.length}개 모두 맞게 확인돼요`, bad === 0, `어긋난 것 ${bad}개`)
  const au = await call(top, 'GET', '/api/admin/audit')
  check('기록이 처음부터 끝까지 이어져 있어요', au.data?.intact === true)
  check('두 번 누른 픽은 모두 거절됐어요', stat.doubles === stat.doublesRefused, `${stat.doublesRefused} / ${stat.doubles}`)
  check('서버 오류(500번대)가 없어요', !Object.keys(statusCount).some((k) => /^5\d\d /.test(k)), JSON.stringify(statusCount))
  check('서버 상태 정상 (healthz)', (await call('', 'GET', '/healthz')).status === 200)
  const reasons = {}
  for (const it of items) reasons[it.result?.reason ?? '?'] = (reasons[it.result?.reason ?? '?'] ?? 0) + 1
  notes.push(`마감 까닭: ${Object.entries(reasons).map(([k, v]) => `${k} ${v}`).join(' · ')}`)
  await ob.reload()
  await shot(ob, '지켜보기 - 가장 큰 방 모든 결과', 1200, true)
  await shot(tv, '큰 화면 - 가장 큰 방 마지막 결과', 800)
  await ap.reload()
  await shot(ap, `관리자 - 가장 큰 방(${big.size}명) 결과`, 1200, true)
  await ap.goto(`${base}/admin`)
  await ap.locator('.ad-tabs').getByRole('button', { name: '통계', exact: true }).click().catch(() => {})
  await shot(ap, '관리자 - 통계', 1200, true)
} catch (e) {
  problems.push(`시험이 멈췄어요: ${e.stack?.split('\n').slice(0, 3).join(' | ')}`)
} finally {
  for (const a of aborts) a.abort()
  for (const R of rooms) await call(top, 'DELETE', `/api/admin/rooms/${R.id}`)
  const list = (await call(top, 'GET', '/api/admin/admins')).data?.admins ?? []
  for (const a of list.filter((x) => x.name.startsWith('drill-'))) await call(top, 'DELETE', `/api/admin/admins/${a.id}`)
  const left = JSON.stringify((await call(top, 'GET', '/api/admin/rooms')).data).includes(PREFIX)
  console.log(left ? '  ✗ 시험용 방이 남아 있어요' : '  ✓ 시험용 방 8개 · 임시 관리자 5명을 지웠어요')
  await b?.close()
}
const line = (k, name) => `${name} ${slowest[k].length}번: 가운데값 ${pct(slowest[k], 0.5)}ms · 느린 쪽 95% ${pct(slowest[k], 0.95)}ms · 99% ${pct(slowest[k], 0.99)}ms · 가장 느린 ${Math.round(Math.max(0, ...slowest[k]))}ms`
const timing = [line('join', '입장 요청'), line('vote', '픽 요청'), line('me', '상태 읽기'), line('admin', '진행자 화면 읽기')]
writeFileSync(`${out}/시험 결과.json`, JSON.stringify({ seed: SEED, passed, problems, notes, stat, statusCount, timing, photos, rooms: rooms.map((R) => ({ room: R.k + 1, size: R.size, host: R.host, strict: R.strict, password: !!R.password, live: R.live, items: R.items.map((i) => ({ title: i.title, ...i.result })) })) }, null, 2))
console.log(`\n══ 결과 (씨앗 ${SEED}, 모두 ${Math.round((performance.now() - t00) / 1000)}초): 확인 ${passed + problems.length}개 중 통과 ${passed} · 문제 ${problems.length}`)
for (const p of problems) console.log(`  ✗ ${p}`)
console.log('일어난 일:', JSON.stringify(stat))
console.log('눈에 띈 응답:', JSON.stringify(statusCount))
for (const n of notes) console.log(`  · ${n}`)
for (const t of timing) console.log(`  ${t}`)
console.log(`사진 ${photos.length}장 → ${out}`)
