// 검사: npm test — 임시 폴더에 서버를 띄워 공정성 · 보안 규칙이 지켜지는지 처음부터 끝까지 확인해요.
// (부르는 곳: package.json 의 "test". 실제 저장 파일은 건드리지 않아요.)
import { spawn } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'

const dir = mkdtempSync(join(tmpdir(), 'mypick-'))
const PORT = 18000 + Math.floor(Math.random() * 1000)
const base = `http://127.0.0.1:${PORT}`
const boot = () => spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.mjs', '--api-only'], {
  env: { ...process.env, PUBLIC_ROOMS_PER_HOUR: '3', PUBLIC_ROOMS: '1', ROOM_KEEP_DAYS: '7', LISTEN_PORT: PORT, DATA_DIR: dir, ADMIN_ID: 'boss', ADMIN_PASSWORD: 'correct-horse-1', LOGIN_LOCK_AFTER: '3', JOIN_LOCK_AFTER: '3', JOIN_LOCK_SECONDS: '10', TRUST_PROXY: '', AUDIT_SECRET: 'check-secret' },
  stdio: 'inherit',
})
let server = boot()
const up = async () => {
  for (let i = 0; i < 50 && !(await fetch(base + '/healthz').catch(() => null)); i++) await sleep(100)
}

/** 쿠키를 들고 다니는 작은 브라우저 */
function client() {
  let cookie = ''
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(method === 'GET' ? {} : { 'X-Requested-With': 'mypick' }), ...(body && !(body instanceof Uint8Array) ? { 'Content-Type': 'application/json' } : {}), cookie, ...headers },
      body: body instanceof Uint8Array ? body : body ? JSON.stringify(body) : undefined,
    })
    const set = res.headers.get('set-cookie')
    if (set) cookie = set.split(';')[0]
    return { status: res.status, data: await res.json().catch(() => null), set }
  }
  return { get: (p) => call('GET', p), post: (p, b, h) => call('POST', p, b ?? {}, h), put: (p, b) => call('PUT', p, b), del: (p) => call('DELETE', p), cookie: () => cookie }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let n = 0
const ok = (name) => console.log(`  ✓ ${++n}. ${name}`)

try {
  await up()

  const admin = client()
  const anon = client()

  // ── 관리자 ──
  assert.equal((await anon.get('/api/admin/rooms')).status, 401)
  assert.equal((await anon.post('/api/admin/rooms', { title: 'x', mode: 'simple', password: '1234' })).status, 401)
  ok('로그인하지 않으면 관리자 기능을 못 써요')

  assert.equal((await admin.post('/api/admin/login', { id: 'boss', password: 'wrong' })).status, 401)
  const login = await admin.post('/api/admin/login', { id: 'boss', password: 'correct-horse-1' })
  assert.equal(login.status, 200)
  assert.match(login.set, /HttpOnly; SameSite=Strict/)
  ok('관리자 로그인 (쿠키는 HttpOnly · SameSite=Strict)')

  const noHeader = await fetch(base + '/api/admin/logout', { method: 'POST', headers: { cookie: admin.cookie() } })
  assert.equal(noHeader.status, 403)
  const cross = await admin.post('/api/admin/logout', {}, { Origin: 'https://evil.example' })
  assert.equal(cross.status, 403)
  ok('다른 사이트에서 온 요청은 거부해요')

  // ── 로고 ──
  assert.equal((await admin.post('/api/admin/logo', new TextEncoder().encode('<svg onload=alert(1)>'))).status, 415)
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
  const logo = await admin.post('/api/admin/logo', png)
  assert.match(logo.data.logo, /^\/uploads\/logo-[a-f0-9]{16}\.png$/)
  assert.equal((await fetch(base + logo.data.logo)).status, 200)
  assert.equal((await anon.post('/api/admin/logo', png)).status, 401)
  ok('로고는 진짜 그림만, 관리자만 올려요')

  // ── 방 · 주제 ──
  const { data: made } = await admin.post('/api/admin/rooms', { title: '축제 준비', mode: 'simple', password: 'abcd', seconds: 0, grace: 3, live: false })
  const code = (await admin.get(`/api/admin/rooms/${made.id}`)).data.room.code
  ok('방 만들기')

  // ── 입장 ──
  const v1 = client()
  const v2 = client()
  assert.equal((await v1.post('/api/join', { room: code, password: 'nope' })).status, 401)
  assert.equal((await v1.post('/api/join', { room: code, password: 'nope' })).status, 401)
  const wrongPass = await v1.post('/api/join', { room: code, password: 'nope' })
  const noRoom = await v1.post('/api/join', { room: '000000', password: 'abcd' })
  assert.equal(wrongPass.data.error, noRoom.data.error)
  assert.equal((await v1.post('/api/join', { room: code, password: 'abcd' })).status, 429)
  ok('방 비밀번호를 여러 번 틀리면 잠겨요 (없는 방과 같은 말로 답해요)')
  assert.equal((await v2.post('/api/join', { room: code, password: 'abcd' }, { 'X-Forwarded-For': '9.9.9.9' })).status, 429)
  ok('주소를 속여 잠금을 피할 수 없어요') // TRUST_PROXY 가 꺼져 있으면 머리글을 믿지 않아요

  // 잠금은 접속 주소 + 방마다 따로예요. 다른 방으로 이어서 검사해요.
  const { data: made2 } = await admin.post('/api/admin/rooms', { title: '동아리 회의', mode: 'simple', password: 'abcd', seconds: 0, grace: 3, capacity: 3 })
  const r2 = made2.id
  const code2 = (await admin.get(`/api/admin/rooms/${r2}`)).data.room.code
  const add = async (title, extra = {}) => (await admin.post(`/api/admin/rooms/${r2}/items`, { title, options: ['찬성', '반대', '보류'], ...extra })).data.id
  const i1 = await add('회비 인상')
  const i2 = await add('간식 고르기', { maxPick: 2 })
  const i3 = await add('시간 제한', { seconds: 1 })

  const j1 = await v1.post('/api/join', { room: code2, password: 'abcd' })
  assert.equal(j1.status, 200)
  assert.match(j1.set, /HttpOnly; SameSite=Lax/)
  await v2.post('/api/join', { room: code2, password: 'abcd' })
  const before = v1.cookie()
  await v1.post('/api/join', { room: code2, password: 'abcd' })
  assert.equal(v1.cookie(), before)
  assert.equal((await admin.get(`/api/admin/rooms/${r2}`)).data.joined, 2)
  ok('새로고침 · 다시 입장해도 같은 참여자로 남아요')

  // ── 픽 ──
  let me = (await v1.get('/api/me')).data
  assert.equal(me.items.length, 0)
  ok('열지 않은 주제는 참여자에게 보이지 않아요')

  assert.equal((await v1.post('/api/vote', { item: i1, options: [] })).status, 409)
  await admin.post(`/api/admin/items/${i1}/open`)
  assert.equal((await admin.post(`/api/admin/items/${i2}/open`)).status, 409)
  ok('주제는 한 번에 하나만 열려요')

  // v2 는 화면을 열어 둔 채(연결 유지) 아직 픽하지 않아요
  const hold = new AbortController()
  const stream = await fetch(`${base}/api/events?room=${code2}`, { headers: { cookie: v2.cookie() }, signal: hold.signal })
  assert.equal(stream.status, 200)

  me = (await v1.get('/api/me')).data
  const opt = me.items[0].options
  assert.equal(opt[0].votes, undefined)
  assert.equal((await v1.post('/api/vote', { item: i1, options: [opt[0].id, opt[1].id] })).status, 400)
  assert.equal((await v1.post('/api/vote', { item: i1, options: [999999] })).status, 400)
  assert.equal((await v1.post('/api/vote', { item: i1, options: [opt[0].id] })).status, 200)
  assert.equal((await v1.post('/api/vote', { item: i1, options: [opt[1].id] })).status, 409)
  const again = await Promise.all([1, 2, 3].map(() => v1.post('/api/vote', { item: i1, options: [opt[1].id] })))
  assert.ok(again.every((r) => r.status === 409))
  ok('한 사람 한 표: 두 번째 픽은 거부돼요')

  const peek = (await admin.get(`/api/admin/rooms/${r2}`)).data.items.find((x) => x.id === i1)
  assert.equal(peek.voted, 1)
  assert.equal(peek.options[0].votes, undefined)
  ok('픽 받는 중에는 관리자도 결과를 볼 수 없어요 (몇 명 픽했는지만)')

  assert.equal((await admin.put(`/api/admin/rooms/${r2}`, { title: '동아리 회의', live: true, seconds: 0, grace: 3, capacity: 3 })).status, 409)
  ok('픽 도중에는 ‘실시간 공개’로 바꿀 수 없어요')

  await sleep(4500) // 기다리는 시간(3초)보다 길게: 연결이 살아 있는 동안에는 계속 자리에 있는 것으로 봐야 해요
  const waiting = (await admin.get(`/api/admin/rooms/${r2}`)).data
  assert.equal(waiting.items.find((x) => x.id === i1).status, 'open')
  assert.equal(waiting.present, 1) // 화면을 열어 둔 v2 만 (v1 은 연결 없이 요청만 보냈어요)
  ok('자리에 있는 사람이 아직 픽하지 않았으면 기다려요')

  hold.abort() // v2 의 접속이 끊김 → 기다리는 시간(3초) 뒤에 자동 마감
  await sleep(5500)
  const closed = (await admin.get(`/api/admin/rooms/${r2}`)).data.items.find((x) => x.id === i1)
  assert.equal(closed.status, 'closed')
  assert.equal(closed.reason, '모두 픽함')
  assert.deepEqual(closed.options.map((o) => o.votes), [1, 0, 0])
  assert.equal(closed.eligible, 2)
  ok('끊긴 사람은 몇 초 뒤 빼고 자동 마감, 결과는 마감 뒤에 공개돼요')

  assert.equal((await v2.post('/api/vote', { item: i1, options: [opt[1].id] })).status, 409)
  assert.equal((await admin.put(`/api/admin/items/${i1}`, { title: '바꿔치기', options: ['a', 'b'] })).status, 409)
  assert.equal((await admin.del(`/api/admin/items/${i1}`)).status, 409)
  assert.equal((await admin.post(`/api/admin/items/${i1}/open`)).status, 409)
  ok('마감된 주제는 픽 · 고치기 · 지우기 · 다시 열기 모두 안 돼요')

  // ── 여러 개 고르기 · 건너뜀 ──
  await admin.post(`/api/admin/items/${i2}/open`)
  const o2 = (await v1.get('/api/me')).data.items.find((x) => x.id === i2).options
  assert.equal((await v1.post('/api/vote', { item: i2, options: [o2[0].id, o2[0].id] })).status, 400)
  assert.equal((await v1.post('/api/vote', { item: i2, options: [o2[0].id, o2[2].id] })).status, 200)
  assert.equal((await v2.post('/api/vote', { item: i2, options: [] })).status, 200)
  await sleep(1800)
  const multi = (await v2.get('/api/me')).data.items.find((x) => x.id === i2)
  assert.equal(multi.status, 'closed')
  assert.deepEqual([multi.options.map((o) => o.votes), multi.abstain, multi.voted], [[1, 0, 1], 1, 2])
  ok('여러 개 고르기 · 건너뜀, 모두 픽하면 바로 마감')

  // ── 제한 시간 ──
  await admin.post(`/api/admin/items/${i3}/open`)
  await sleep(2300)
  const timed = (await v1.get('/api/me')).data.items.find((x) => x.id === i3)
  assert.equal(timed.reason, '시간이 끝남')
  assert.equal((await v1.post('/api/vote', { item: i3, options: [] })).status, 409)
  ok('제한 시간이 끝나면 자동 마감')

  // ── 정원 · 입장 마감 ──
  const v3 = client()
  const v4 = client()
  assert.equal((await v3.post('/api/join', { room: code2, password: 'abcd' })).status, 200)
  assert.match((await v4.post('/api/join', { room: code2, password: 'abcd' })).data.error, /정원/)
  await admin.put(`/api/admin/rooms/${r2}`, { title: '동아리 회의', seconds: 0, grace: 3, capacity: 0 })
  await admin.post(`/api/admin/rooms/${r2}/lock`, { locked: true })
  assert.match((await v4.post('/api/join', { room: code2, password: 'abcd' })).data.error, /입장이 마감/)
  assert.equal((await v1.get('/api/me')).status, 200)
  ok('정원이 차거나 입장을 마감하면 새로 못 들어와요 (이미 들어온 사람은 그대로)')

  // ── 엄격 방식 (1인 1입장코드) ──
  const { data: made3 } = await admin.post('/api/admin/rooms', { title: '운영진 뽑기', mode: 'strict', seconds: 0, grace: 3 })
  const r3 = made3.id
  const code3 = (await admin.get(`/api/admin/rooms/${r3}`)).data.room.code
  await admin.post(`/api/admin/rooms/${r3}/codes`, { count: 2 })
  const codes = (await admin.get(`/api/admin/rooms/${r3}/codes`)).data.codes
  assert.equal(codes.length, 2)
  const s1 = (await admin.post(`/api/admin/rooms/${r3}/items`, { title: '회장', options: ['가', '나'] })).data.id
  await admin.post(`/api/admin/items/${s1}/open`)
  const p1 = client()
  const p1b = client()
  assert.equal((await p1.post('/api/join', { room: code3, entryCode: 'ZZZZZZZZ' })).status, 401)
  assert.equal((await p1.post('/api/join', { room: code3, entryCode: codes[0].code.toLowerCase() })).status, 200)
  const so = (await p1.get('/api/me')).data.items[0].options
  assert.equal((await p1.post('/api/vote', { item: s1, options: [so[0].id] })).status, 200)
  // 입장 코드는 한 번만: 다른 기기에서 같은 코드를 넣으면 막히고, 먼저 들어온 기기는 그대로예요
  assert.equal((await p1b.post('/api/join', { room: code3, entryCode: codes[0].code })).status, 409)
  assert.equal((await p1.get('/api/me')).status, 200)
  assert.equal((await p1.post('/api/join', { room: code3, entryCode: codes[0].code })).status, 200) // 같은 기기는 그대로 이어 가요
  // 진행자가 다시 열어 주면 한 번만 더: 새 기기로 옮겨 가고(앞 기기는 끊김), 픽은 여전히 한 번, 그리고 다시 닫혀요
  assert.equal((await admin.put(`/api/admin/rooms/${r3}/codes`, { code: codes[1].code })).status, 409) // 아직 안 쓴 코드
  assert.equal((await admin.put(`/api/admin/rooms/${r3}/codes`, { code: 'ZZZZZZZZ' })).status, 404)
  assert.equal((await admin.put(`/api/admin/rooms/${r3}/codes`, { code: codes[0].code })).status, 200)
  assert.equal((await p1b.post('/api/join', { room: code3, entryCode: codes[0].code })).status, 200)
  assert.equal((await p1b.get('/api/me')).data.items[0].mine, true)
  assert.equal((await p1b.post('/api/vote', { item: s1, options: [so[1].id] })).status, 409)
  assert.equal((await p1.get('/api/me')).status, 401)
  assert.equal((await client().post('/api/join', { room: code3, entryCode: codes[0].code })).status, 409)
  assert.equal((await admin.get(`/api/admin/rooms/${r3}`)).data.joined, 1)
  ok('엄격 방식: 입장 코드는 한 번만 써요. 진행자가 다시 열어 줘야 한 번 더 들어오고, 그래도 한 표뿐이에요')

  // ── 조용한 손들기 · 쉬운 말 모드 ──
  {
    const hr = (await admin.post('/api/admin/rooms', { title: '손들기 방', mode: 'simple', seconds: 60, easy: true })).data.id
    const hroom = (await admin.get(`/api/admin/rooms/${hr}`)).data
    assert.equal(hroom.room.easy, true)
    const h1 = client()
    const h2 = client()
    for (const h of [h1, h2]) assert.equal((await h.post('/api/join', { room: hroom.room.code })).status, 200)
    assert.equal((await client().post('/api/hand', { kind: 'question' })).status, 401) // 들어온 사람만
    assert.equal((await h1.post('/api/hand', { kind: 'shout' })).status, 400)
    await h1.post('/api/hand', { kind: 'question' })
    await h2.post('/api/hand', { kind: 'more' })
    assert.equal((await h2.post('/api/hand', { kind: 'question' })).status, 429) // 마구 누르지 못하게 1.5초에 한 번
    await sleep(1600)
    await h2.post('/api/hand', { kind: 'question' }) // 바꾸면 한 사람이 하나만
    assert.deepEqual((await admin.get(`/api/admin/rooms/${hr}`)).data.hands, { question: 2, more: 0 })
    assert.equal((await h1.get('/api/me')).data.myHand, 'question')
    assert.equal((await h1.get('/api/me')).data.hands, undefined) // 참여자에게는 몇 명인지도 안 보여요
    assert.equal((await h1.post('/api/hand', { kind: null })).status, 200)
    assert.deepEqual((await admin.get(`/api/admin/rooms/${hr}`)).data.hands, { question: 1, more: 0 })
    const hi = (await admin.post(`/api/admin/rooms/${hr}/items`, { title: '손', options: ['가', '나'] })).data.id
    await admin.post(`/api/admin/items/${hi}/open`) // 주제가 열리면 손은 모두 내려가요
    assert.deepEqual((await admin.get(`/api/admin/rooms/${hr}`)).data.hands, { question: 0, more: 0 })
    await sleep(1600)
    await h2.post('/api/hand', { kind: 'more' })
    assert.equal((await admin.del(`/api/admin/rooms/${hr}/hands`)).status, 200)
    assert.equal((await h2.get('/api/me')).data.myHand, null)
    const stored = new DatabaseSync(join(dir, 'mypick.db'))
    assert.ok(!/question|"more"/.test(JSON.stringify(stored.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 20').all()))) // 저장 파일 · 기록에 남지 않아요
    stored.close()
    await admin.del(`/api/admin/rooms/${hr}`)
    ok('조용한 손들기: 진행자는 몇 명인지만, 주제가 열리면 내려가고, 어디에도 저장하지 않아요. 쉬운 말 모드는 방 설정으로')
  }

  // ── 쉬어 가기 ──
  {
    const pr = (await admin.post('/api/admin/rooms', { title: '쉬어 가기 방', mode: 'simple', seconds: 60 })).data.id
    const pcode = (await admin.get(`/api/admin/rooms/${pr}`)).data.room.code
    const pv = client()
    await pv.post('/api/join', { room: pcode })
    const pi = (await admin.post(`/api/admin/rooms/${pr}/items`, { title: '쉬어 가기', options: ['가', '나'] })).data.id
    assert.equal((await admin.post(`/api/admin/items/${pi}/pause`)).status, 409) // 열기 전에는 못 멈춰요
    await admin.post(`/api/admin/items/${pi}/open`)
    assert.equal((await admin.post(`/api/admin/items/${pi}/pause`)).status, 200)
    const paused = (await pv.get('/api/me')).data.items[0]
    assert.equal(paused.paused, true)
    assert.equal(paused.closesAt, null)
    assert.ok(paused.pausedLeft > 55_000 && paused.pausedLeft <= 60_000)
    const popts = paused.options
    assert.equal((await pv.post('/api/vote', { item: pi, options: [popts[0].id] })).status, 409) // 멈춘 동안은 픽을 받지 않아요
    assert.equal((await admin.post(`/api/admin/items/${pi}/extend`, { seconds: 30 })).status, 200) // 멈춘 채로 늘리면 남은 시간에 더해요
    const more = (await pv.get('/api/me')).data.items[0].pausedLeft
    assert.ok(more > 85_000)
    await sleep(1500) // 멈춘 동안에는 시간이 흐르지 않아요
    assert.equal((await pv.get('/api/me')).data.items[0].pausedLeft, more)
    assert.equal((await admin.post(`/api/admin/items/${pi}/resume`)).status, 200)
    const back = (await pv.get('/api/me')).data.items[0]
    assert.equal(back.paused, false)
    assert.ok(back.closesAt - Date.now() > 80_000)
    assert.equal((await admin.post(`/api/admin/items/${pi}/resume`)).status, 409)
    assert.equal((await pv.post('/api/vote', { item: pi, options: [popts[0].id] })).status, 200)
    await admin.post(`/api/admin/items/${pi}/pause`)
    await admin.post(`/api/admin/items/${pi}/close`) // 멈춘 채로 마감해도 돼요
    const shut = (await admin.get(`/api/admin/rooms/${pr}`)).data.items[0]
    assert.deepEqual([shut.status, shut.paused], ['closed', false])
    await admin.del(`/api/admin/rooms/${pr}`)
    ok('쉬어 가기: 멈추면 남은 시간이 얼고 픽을 받지 않아요. 다시 시작하면 남은 시간부터, 멈춘 채로 늘리기 · 마감도 돼요')
  }

  // ── 오류 제보 ──
  {
    const fb = client()
    assert.equal((await fb.post('/api/feedback', { kind: '칭찬', note: '아주 좋아요 좋아요' })).status, 400)
    assert.equal((await fb.post('/api/feedback', { kind: '오류', note: '짧' })).status, 400)
    assert.equal((await fb.post('/api/feedback', { kind: '오류', note: '픽하기를 눌렀는데 멈췄어요', page: '/m?room=123456&k=secret' })).status, 200) // 꼬리가 붙은 주소는 버려요
    assert.equal((await fb.post('/api/feedback', { kind: '바라는 점', note: '글자를 더 키울 수 있으면 좋겠어요', page: '/m' })).status, 200)
    assert.equal((await client().get('/api/admin/reports')).status, 401)
    const got = (await admin.get('/api/admin/reports')).data.feedback
    assert.deepEqual(got.map((f) => [f.kind, f.page]), [['바라는 점', '/m'], ['오류', '']])
    assert.equal((await client().del(`/api/admin/feedback/${got[0].id}`)).status, 401)
    assert.equal((await admin.del(`/api/admin/feedback/${got[0].id}`)).status, 200)
    for (let i = 0; i < 3; i++) await fb.post('/api/feedback', { kind: '오류', note: `한 시간에 다섯 번까지 ${i}` })
    assert.equal((await fb.post('/api/feedback', { kind: '오류', note: '여섯 번째는 막혀요' })).status, 429)
    ok('오류 제보: 누구나 보내고 관리자만 봐요. 한 시간에 다섯 번까지, 주소의 꼬리는 받지 않아요')
  }

  const key = (await admin.get(`/api/admin/rooms/${r2}`)).data.admin.screenKey
  assert.equal((await anon.get(`/api/screen?room=${code2}`)).status, 403)
  assert.equal((await anon.get(`/api/screen?room=${code2}&k=${'0'.repeat(32)}`)).status, 403)
  assert.equal((await anon.get(`/api/screen?room=${code2}&k=${key}`)).status, 200)
  assert.equal((await v1.get(`/api/screen?room=${code3}&k=${key}`)).status, 403)
  ok('큰 화면은 그 방의 열쇠가 있어야 열려요')

  // ── 비밀 보장: 저장 파일을 직접 열어 봐요 ──
  const db = new DatabaseSync(join(dir, 'mypick.db'), { readOnly: true })
  const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name)
  assert.deepEqual(cols('participation'), ['item_id', 'voter_id'])
  assert.deepEqual(cols('options'), ['id', 'item_id', 'pos', 'label', 'votes'])
  assert.ok(!/voter|token_hash/.test(JSON.stringify(db.prepare('SELECT * FROM audit').all())))
  assert.ok(db.prepare('SELECT pass_hash FROM rooms').all().every((r) => !r.pass_hash?.includes('abcd')))
  db.close()
  ok('저장 파일 어디에도 ‘누가 무엇을 골랐는지’가 없어요 (방 비밀번호도 그대로 저장하지 않아요)')

  // ── 기록 ──
  const log = (await admin.get('/api/admin/audit')).data
  assert.equal(log.intact, true)
  assert.ok(log.rows.some((r) => r.action === '주제 마감' && r.detail.이유 === '모두 픽함'))
  // 적어 둔 지문은 기록 안에서 찾을 수 있고, 결과 확인은 그 마감이 기록에 남아 있는지도 봐요
  assert.match(log.mark, /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/)
  const marked = (await admin.get(`/api/admin/audit/mark?m=${log.mark}`)).data
  assert.deepEqual([marked.found, marked.intact, marked.pos], [true, true, log.count])
  assert.equal((await admin.get('/api/admin/audit/mark?m=0000-0000-0000')).data.found, false)
  // 아직 남아 있는 방의 마감으로 봐요 (앞의 시험에서 지운 방의 결과는 확인할 수 없어요)
  const sealedCode = log.rows.find((r) => r.action === '주제 마감' && r.detail.이유 === '모두 픽함').detail.확인코드
  assert.deepEqual([(await client().get(`/api/verify?code=${sealedCode}`)).data.same, (await client().get(`/api/verify?code=${sealedCode}`)).data.logged], [true, true])
  const tamper = new DatabaseSync(join(dir, 'mypick.db'))
  tamper.exec(`UPDATE audit SET detail = replace(detail, '"픽":1', '"픽":9') WHERE action = '주제 마감'`)
  assert.equal((await admin.get('/api/admin/audit')).data.intact, false)
  // 고친 뒤 해시를 (열쇠 없이) 전부 다시 계산해 넣어도, 열쇠가 없으면 맞출 수 없어요
  const { createHash } = await import('node:crypto')
  let prevHash = ''
  for (const r of tamper.prepare('SELECT * FROM audit ORDER BY id').all()) {
    prevHash = createHash('sha256').update(`${prevHash}|${r.at}|${r.action}|${r.detail}`).digest('hex')
    tamper.prepare('UPDATE audit SET hash=? WHERE id=?').run(prevHash, r.id)
  }
  tamper.close()
  assert.equal((await admin.get('/api/admin/audit')).data.intact, false)
  assert.equal((await admin.get(`/api/admin/audit/mark?m=${log.mark}`)).data.found, false)
  assert.equal((await client().get(`/api/verify?code=${sealedCode}`)).data.logged, false)
  ok('관리 기록은 누가 고치면 바로 드러나요 (해시를 다시 계산해 넣어도, 끝을 잘라도)')

  // ── 방을 지운 뒤 새 방 ──
  const { data: old } = await admin.post('/api/admin/rooms', { title: '지울 방', mode: 'simple', password: 'abcd', seconds: 0, grace: 3 })
  const oldCode = (await admin.get(`/api/admin/rooms/${old.id}`)).data.room.code
  const g1 = client()
  await g1.post('/api/join', { room: oldCode, password: 'abcd' })
  fetch(`${base}/api/events?room=${oldCode}`, { headers: { cookie: g1.cookie() } }).catch(() => {}) // 연결을 쥔 채로
  await sleep(300)
  await admin.del(`/api/admin/rooms/${old.id}`)
  assert.equal((await g1.get('/api/me')).status, 401)
  const { data: fresh } = await admin.post('/api/admin/rooms', { title: '새 방', mode: 'simple', password: 'abcd', seconds: 0, grace: 3 })
  assert.ok(fresh.id > old.id)
  const freshCode = (await admin.get(`/api/admin/rooms/${fresh.id}`)).data.room.code
  const g2 = client()
  await g2.post('/api/join', { room: freshCode, password: 'abcd' })
  const keep = new AbortController()
  await fetch(`${base}/api/events?room=${freshCode}`, { headers: { cookie: g2.cookie() }, signal: keep.signal })
  await sleep(4000)
  assert.equal((await admin.get(`/api/admin/rooms/${fresh.id}`)).data.present, 1)
  keep.abort()
  ok('방을 지워도 번호를 다시 쓰지 않고, 새 방의 접속 인원이 틀어지지 않아요')

  // ── 방 번호로 필요한 것만 묻기 · 비밀번호 없는 방 ──
  const { data: openRoom } = await admin.post('/api/admin/rooms', { title: '열린 방', mode: 'simple', seconds: 0, grace: 3 })
  const openCode = (await admin.get(`/api/admin/rooms/${openRoom.id}`)).data.room.code
  assert.deepEqual((await anon.get(`/api/room?code=${openCode}`)).data, { title: '열린 방', needPass: false, needCode: false })
  assert.deepEqual((await anon.get(`/api/room?code=${code3}`)).data, { title: '운영진 뽑기', needPass: false, needCode: true })
  assert.equal((await anon.get(`/api/room?code=${freshCode}`)).data.needPass, true)
  assert.equal((await anon.get('/api/room?code=000000')).status, 404)
  assert.equal((await client().post('/api/join', { room: openCode })).status, 200)
  ok('방 번호를 넣으면 그 방에 필요한 것만 물어요 (비밀번호 없는 방은 번호만으로 입장)')

  // ── 통과 여부 · 다시 고르기 · 시간 연장 · 순서 · 연습 · 결과 내려받기 ──
  const va = client(), vb = client(), vc = client()
  for (const v of [va, vb, vc]) await v.post('/api/join', { room: openCode })
  const mk = async (body) => (await admin.post(`/api/admin/rooms/${openRoom.id}/items`, body)).data.id
  const runItem = async (id, picks) => {
    await admin.post(`/api/admin/items/${id}/open`)
    const o = (await va.get('/api/me')).data.items.find((x) => x.id === id).options
    await Promise.all([va, vb, vc].map((v, i) => v.post('/api/vote', { item: id, options: picks[i] === null ? [] : [o[picks[i]].id] })))
    await admin.post(`/api/admin/items/${id}/close`)
    return (await admin.get(`/api/admin/rooms/${openRoom.id}`)).data.items.find((x) => x.id === id)
  }
  const q1 = await mk({ title: '회칙 개정', options: ['찬성', '반대'], rule: 'majority' })
  const q2 = await mk({ title: '=cmd|calc', options: ['찬성', '반대'], rule: 'two_thirds', practice: true })
  const q3 = await mk({ title: '대표 뽑기', options: ['가', '나', '다'] })
  assert.equal((await runItem(q1, [0, 0, 1])).outcome, 'pass')
  const r2x = await runItem(q2, [0, 1, null])
  assert.deepEqual([r2x.outcome, r2x.practice, r2x.rule], ['fail', true, 'two_thirds']) // 3명 중 1명 찬성 → 3분의 2 에 못 미침
  assert.equal((await admin.post(`/api/admin/items/${q1}/runoff`)).status, 409) // 동점이 아니면 다시 고르기 없음
  await runItem(q3, [0, 1, null])
  assert.equal((await admin.post(`/api/admin/items/${q3}/runoff`)).status, 200)
  assert.equal((await admin.post(`/api/admin/items/${q3}/runoff`)).status, 409) // 두 번 누르거나 여럿이 눌러도 하나만
  let list = (await admin.get(`/api/admin/rooms/${openRoom.id}`)).data.items
  const final = list.at(-1)
  assert.deepEqual([final.title, final.status, final.options.map((o) => o.label)], ['대표 뽑기 (동점 가리기)', 'draft', ['가', '나']])
  ok('통과 · 통과 못 함, 동점이면 그 선택지만으로 다시 고르기')

  const q4 = await mk({ title: '시간 연장', options: ['a', 'b'], seconds: 20 })
  await admin.post(`/api/admin/items/${q4}/move`, { dir: 'up' })
  list = (await admin.get(`/api/admin/rooms/${openRoom.id}`)).data.items
  assert.deepEqual(list.slice(-2).map((x) => x.id), [q4, final.id])
  assert.equal((await admin.post(`/api/admin/items/${q3}/move`, { dir: 'up' })).status, 409) // 이미 한 픽의 순서는 못 바꿔요
  ok('열지 않은 주제끼리 순서 바꾸기')

  assert.equal((await admin.post(`/api/admin/items/${q4}/extend`, { seconds: 30 })).status, 409) // 열기 전에는 안 돼요
  await admin.post(`/api/admin/items/${q4}/open`)
  const t0 = (await va.get('/api/me')).data.items.find((x) => x.id === q4).closesAt
  assert.equal((await admin.post(`/api/admin/items/${q4}/extend`, { seconds: 30 })).status, 200)
  const t1 = (await va.get('/api/me')).data.items.find((x) => x.id === q4)
  assert.deepEqual([t1.closesAt - t0, t1.seconds], [30_000, 50])
  assert.equal((await va.post('/api/admin/items/' + q4 + '/extend', { seconds: 30 })).status, 401) // 참여자는 못 늘려요
  await admin.post(`/api/admin/items/${q4}/close`)
  ok('픽 받는 중에 시간 늘리기 (기록에 남아요)')

  const csvRes = await fetch(`${base}/api/admin/rooms/${openRoom.id}/results.csv`, { headers: { cookie: admin.cookie() } })
  const csv = Buffer.from(await csvRes.arrayBuffer()).toString('utf8') // 한글이 깨지지 않게 맨 앞에 표시(BOM)가 있어야 해요
  assert.match(csvRes.headers.get('content-disposition'), /attachment; filename="mypick-\d{6}\.csv"/)
  assert.ok(csv.startsWith('\ufeff'))
  assert.ok(csv.includes('"회칙 개정","찬성","2","3"') && csv.includes('"통과"') && csv.includes('"(연습) =cmd|calc","찬성"'))
  assert.ok(!/(^|,)"=/m.test(csv)) // 수식으로 읽힐 칸이 없어요
  assert.equal((await fetch(`${base}/api/admin/rooms/${openRoom.id}/results.csv`)).status, 401)
  ok('결과 내려받기 (CSV, 로그인한 진행자만)')

  // ── 방장: 누구나 방 만들기 ──
  const host = client()
  assert.equal((await host.post('/api/host/create', { title: '우리 반 픽', mode: 'simple', hostPassword: '123' })).status, 400)
  const mine = await host.post('/api/host/create', { title: '우리 반 픽', mode: 'simple', hostPassword: 'host-secret', seconds: 0, grace: 3 })
  assert.equal(mine.status, 200)
  assert.match(mine.set, /mp_host=[a-f0-9]{64}; Path=\/; HttpOnly; SameSite=Strict/)
  const hid = mine.data.id
  const hview = (await host.get(`/api/admin/rooms/${hid}`)).data
  assert.equal(hview.admin.owner, 'host')
  assert.ok(hview.admin.expiresAt > Date.now() + 6 * 86_400_000)
  const hi = (await host.post(`/api/admin/rooms/${hid}/items`, { title: '소풍 장소', options: ['산', '바다'] })).data.id
  assert.equal((await host.post(`/api/admin/items/${hi}/open`)).status, 200)
  assert.equal((await host.get(`/api/admin/rooms/${hid}`)).data.items[0].options[0].votes, undefined) // 방장도 픽 받는 중에는 결과를 못 봐요
  assert.equal((await host.post(`/api/admin/items/${hi}/close`)).status, 200)
  ok('방장: 가입 없이 방을 만들고 자기 방을 진행해요')

  assert.equal((await host.get(`/api/admin/rooms/${fresh.id}`)).status, 403)
  assert.equal((await host.post(`/api/admin/rooms/${fresh.id}/close`)).status, 403)
  assert.equal((await host.del(`/api/admin/rooms/${fresh.id}`)).status, 403)
  assert.equal((await host.post(`/api/admin/items/${s1}/close`)).status, 403)
  assert.equal((await host.get('/api/admin/rooms')).status, 403)
  assert.equal((await host.get('/api/admin/audit')).status, 403)
  assert.equal((await host.put('/api/admin/org', { name: '가로채기' })).status, 403)
  assert.equal((await host.post('/api/admin/logo', png)).status, 403)
  assert.equal((await host.post('/api/admin/rooms', { title: 'x', mode: 'simple' })).status, 403)
  assert.equal((await anon.get(`/api/admin/rooms/${hid}`)).status, 401)
  assert.equal((await anon.get(`/api/events?room=${hview.room.code}`)).status, 403)
  assert.equal((await fetch(`${base}/api/admin/rooms/${openRoom.id}/results.csv`, { headers: { cookie: host.cookie() } })).status, 403)
  assert.equal((await host.post(`/api/admin/items/${q4}/runoff`)).status, 403)
  ok('방장은 다른 방 · 기관 설정 · 기록을 건드릴 수 없어요')

  const again2 = client()
  assert.equal((await again2.post('/api/host/login', { room: hview.room.code, hostPassword: 'nope-nope' })).status, 401)
  assert.equal((await again2.post('/api/host/login', { room: freshCode, hostPassword: 'host-secret' })).status, 401) // 관리자가 만든 방에는 방장이 없어요
  assert.equal((await again2.post('/api/host/login', { room: hview.room.code, hostPassword: 'host-secret' })).status, 200)
  assert.equal((await again2.get('/api/host/session')).data.roomId, hid)
  ok('방 번호 + 방장 비밀번호로 다른 기기에서 다시 들어와요')

  // ── 공동 진행자 ──
  assert.equal((await host.post(`/api/admin/rooms/${hid}/cohost`, { password: 'co-secret' })).status, 200)
  const co = client()
  const coIn = await co.post('/api/host/login', { room: hview.room.code, hostPassword: 'co-secret' })
  assert.deepEqual([coIn.status, coIn.data.role], [200, 'cohost'])
  assert.equal((await co.get(`/api/admin/rooms/${hid}`)).data.admin.role, 'cohost')
  assert.equal((await co.post(`/api/admin/rooms/${hid}/items`, { title: '공동 진행자가 더한 주제', options: ['가', '나'] })).status, 200)
  assert.equal((await co.post(`/api/admin/rooms/${hid}/lock`, { locked: false })).status, 200)
  assert.equal((await co.del(`/api/admin/rooms/${hid}`)).status, 403)
  assert.equal((await co.post(`/api/admin/rooms/${hid}/close`)).status, 403)
  assert.equal((await co.put(`/api/admin/rooms/${hid}`, { title: '가로채기' })).status, 403)
  assert.equal((await co.post(`/api/admin/rooms/${hid}/cohost`, { password: 'mine-now' })).status, 403)
  assert.equal((await host.post(`/api/admin/rooms/${hid}/cohost`, { password: null })).status, 200)
  assert.equal((await co.get(`/api/admin/rooms/${hid}`)).status, 401) // 없애면 공동 진행자는 바로 끊겨요
  ok('공동 진행자: 주제 진행은 되고, 방 지우기 · 끝내기 · 설정은 방장만')

  await host.post('/api/host/create', { title: '둘', mode: 'simple', hostPassword: 'host-secret' })
  const third = (await host.post('/api/host/create', { title: '셋', mode: 'simple', hostPassword: 'host-secret' })).data.id
  assert.equal((await host.post('/api/host/create', { title: '넷', mode: 'simple', hostPassword: 'host-secret' })).status, 429)
  ok('한 곳에서 방을 너무 많이 만들면 막아요')

  // ── 예약 열기 ──
  const sch = await mk({ title: '예약 주제', options: ['a', 'b'], seconds: 0 })
  assert.equal((await admin.post(`/api/admin/items/${sch}/schedule`, { at: Date.now() - 1000 })).status, 400)
  assert.equal((await admin.post(`/api/admin/items/${sch}/schedule`, { at: Date.now() + 40 * 86_400_000 })).status, 400)
  const at = Date.now() + 1500
  assert.equal((await admin.post(`/api/admin/items/${sch}/schedule`, { at })).status, 200)
  assert.equal((await va.get('/api/me')).data.nextOpenAt, at) // 기다리는 사람에게 열리는 때가 보여요
  await sleep(3200)
  const opened = (await admin.get(`/api/admin/rooms/${openRoom.id}`)).data.items.find((x) => x.id === sch)
  assert.deepEqual([opened.status, opened.openAt], ['open', null])
  assert.ok((await admin.get('/api/admin/audit')).data.rows.some((r) => r.action === '주제 엶' && r.detail.방법 === '예약'))
  await admin.post(`/api/admin/items/${sch}/close`)
  ok('예약 열기: 정한 때에 주제가 저절로 열려요')

  // 예약 마감: 정한 때까지 열어 둬요 (제한 시간이 없어도, 누가 먼저 픽해도 일찍 닫지 않아요)
  const span = await mk({ title: '며칠짜리 픽', options: ['a', 'b'], seconds: 0 })
  assert.equal((await admin.post(`/api/admin/items/${span}/schedule`, { at: Date.now() + 5000, closeAt: Date.now() + 2000 })).status, 400)
  const closeAt = Date.now() + 4200
  assert.equal((await admin.post(`/api/admin/items/${span}/schedule`, { at: Date.now() + 1000, closeAt })).status, 200)
  await sleep(2300)
  const spanOpts = (await va.get('/api/me')).data.items.find((x) => x.id === span)
  assert.deepEqual([spanOpts.status, spanOpts.closesAt], ['open', closeAt])
  await va.post('/api/vote', { item: span, options: [spanOpts.options[0].id] })
  await sleep(1300) // 보통 방이면 ‘모두 픽함’으로 닫혔을 시간
  assert.equal((await va.get('/api/me')).data.items.find((x) => x.id === span).status, 'open')
  await sleep(1800)
  const spanDone = (await va.get('/api/me')).data.items.find((x) => x.id === span)
  assert.deepEqual([spanDone.status, spanDone.reason, spanDone.voted], ['closed', '시간이 끝남', 1])
  ok('예약 마감: 정한 때까지 열어 두고 그때 저절로 마감해요')

  // ── 주제 묶음 (관리자는 서버에 저장) ──
  const bundle = { name: '정기 회의', items: [{ title: '결과 정리 승인', options: ['찬성', '반대'], rule: 'majority' }, { title: '다음 달 일정', options: ['첫째 주', '둘째 주'] }] }
  assert.equal((await admin.post('/api/admin/bundles', bundle)).status, 200)
  assert.equal((await admin.post('/api/admin/bundles', { name: '빈 묶음', items: [] })).status, 400)
  assert.equal((await admin.post('/api/admin/bundles', { name: '이상한 묶음', items: [{ title: 'x', options: ['하나뿐'] }] })).status, 400)
  const kept = (await admin.get('/api/admin/bundles')).data.bundles
  assert.deepEqual([kept.length, kept[0].name, kept[0].items[0].rule, kept[0].items[1].maxPick], [1, '정기 회의', 'majority', 1])
  assert.equal((await host.get('/api/admin/bundles')).status, 403)
  await admin.del(`/api/admin/bundles/${kept[0].id}`)
  assert.equal((await admin.get('/api/admin/bundles')).data.bundles.length, 0)
  ok('주제 묶음: 관리자는 서버에 저장해 어느 기기에서나 써요')

  // ── 관리자 여러 명 ──
  assert.equal((await admin.post('/api/admin/admins', { name: 'teacher', password: 'short' })).status, 400)
  assert.equal((await admin.post('/api/admin/admins', { name: 'boss', password: 'teach-pass-1' })).status, 409)
  assert.equal((await admin.post('/api/admin/admins', { name: 'teacher', password: 'teach-pass-1' })).status, 200)
  const second = client()
  assert.equal((await second.post('/api/admin/login', { id: 'teacher', password: 'nope-nope-1' })).status, 401)
  assert.equal((await second.post('/api/admin/login', { id: 'teacher', password: 'teach-pass-1' })).status, 200)
  assert.deepEqual((({ name, top }) => [name, top])((await second.get('/api/admin/session')).data), ['teacher', false])
  const byTeacher = (await second.post('/api/admin/rooms', { title: '선생님이 만든 방', mode: 'simple' })).data.id
  assert.equal((await second.get('/api/admin/admins')).status, 403)
  assert.equal((await second.post('/api/admin/admins', { name: 'friend', password: 'friend-pass-1' })).status, 403)
  const rows = (await admin.get('/api/admin/audit')).data.rows
  assert.ok(rows.some((r) => r.action === '방 만듦' && r.detail.방 === byTeacher && r.detail.누가 === 'teacher'))
  assert.ok(rows.some((r) => r.action === '방 만듦' && r.detail.누가 === 'boss'))
  const tid = (await admin.get('/api/admin/admins')).data.admins.find((a) => a.name === 'teacher').id
  assert.equal((await admin.del(`/api/admin/admins/${tid}`)).status, 200)
  assert.equal((await second.get('/api/admin/rooms')).status, 401) // 빼면 바로 로그아웃돼요
  ok('관리자 여러 명: 최고 관리자만 더하고 빼요, 기록에 누가 했는지 남아요')

  // ── 신고 · 막을 낱말 · 막기 ──
  assert.equal((await anon.post('/api/report', { reason: '기타' })).status, 401)
  assert.equal((await va.post('/api/report', { reason: '그냥' })).status, 400)
  assert.equal((await va.post('/api/report', { reason: '부적절한 내용', note: '주제 제목이 이상해요' })).status, 200)
  assert.equal((await va.post('/api/report', { reason: '기타' })).status, 409)
  let rep0 = (await admin.get('/api/admin/reports')).data
  assert.deepEqual([rep0.open, rep0.reports[0].roomTitle, rep0.reports[0].reason], [1, '열린 방', '부적절한 내용'])
  assert.equal((await host.get('/api/admin/reports')).status, 403)
  const firstReport = rep0.reports[0].id
  assert.equal((await admin.del(`/api/admin/reports/${firstReport}`)).status, 409) // 확인하기 전에는 못 지워요
  await admin.post(`/api/admin/reports/${firstReport}/handle`)
  assert.equal((await admin.get('/api/admin/reports')).data.open, 0)
  assert.equal((await host.del(`/api/admin/reports/${firstReport}`)).status, 403)
  assert.equal((await admin.del(`/api/admin/reports/${firstReport}`)).status, 200)
  assert.equal((await admin.get('/api/admin/reports')).data.reports.some((r) => r.id === firstReport), false)
  ok('신고: 방에 들어온 사람이 한 번, 관리자 화면에 모이고, 확인한 신고는 지울 수 있어요')

  await admin.put('/api/admin/banned', { words: '바보\n나쁜 말' })
  assert.equal((await again2.post(`/api/admin/rooms/${hid}/items`, { title: '누가 바 보인가', options: ['가', '나'] })).status, 400)
  assert.equal((await again2.post(`/api/admin/rooms/${hid}/items`, { title: '좋은 주제', options: ['가', '나쁜말'] })).status, 400)
  assert.equal((await again2.post(`/api/admin/rooms/${hid}/items`, { title: '바.보~ 같은', options: ['가', '나'] })).status, 400) // 사이에 기호를 넣어도 걸러요
  assert.equal((await again2.post(`/api/admin/rooms/${hid}/items`, { title: 'ㅂr보', options: ['가', '나'] })).status, 200) // 글자를 바꿔 쓴 것까지는 못 걸러요
  assert.equal((await again2.post(`/api/admin/rooms/${hid}/items`, { title: '좋은 주제', options: ['가', '나'] })).status, 200)
  assert.equal((await admin.post(`/api/admin/rooms/${openRoom.id}/items`, { title: '바보 같은 질문은 없다', options: ['가', '나'] })).status, 200) // 관리자 방은 거르지 않아요
  ok('막을 낱말: 누구나 만드는 방의 이름 · 주제에서 걸러요')

  assert.equal((await host.post(`/api/admin/rooms/${third}/block`)).status, 403)
  assert.equal((await admin.post(`/api/admin/rooms/${openRoom.id}/block`)).status, 409) // 관리자가 만든 방은 막을 대상이 없어요
  assert.equal((await admin.post(`/api/admin/rooms/${third}/block`, { days: 3 })).status, 400)
  assert.equal((await admin.post(`/api/admin/rooms/${third}/block`, { days: 1 })).status, 200)
  assert.equal((await admin.get(`/api/admin/rooms/${third}`)).status, 404)
  assert.match((await client().post('/api/host/create', { title: '또 만들기', mode: 'simple', hostPassword: 'host-secret' })).data.error, /만들 수 없어요/)
  rep0 = (await admin.get('/api/admin/reports')).data
  assert.equal(rep0.blocks.length, 1)
  assert.ok(rep0.blocks[0].until > Date.now() + 23 * 3_600_000 && rep0.blocks[0].until < Date.now() + 25 * 3_600_000) // 하루 뒤 저절로 풀려요
  assert.ok(!JSON.stringify(rep0.blocks).includes('127.0.0.1')) // 접속 주소를 그대로 두지 않아요
  await admin.del(`/api/admin/blocks/${rep0.blocks[0].creator}`)
  assert.equal((await client().post('/api/host/create', { title: '또 만들기', mode: 'simple', hostPassword: 'host-secret' })).status, 429) // 풀리면 원래 한도로
  ok('막기: 문제 방을 지우고, 만든 곳에서는 더 못 만들게')

  // ── 최소 참여 인원 · 통과를 따질 기준 인원 ──
  const valid = await runItem(await mk({ title: '기준 인원: 실제로 고른 사람', options: ['찬성', '반대'], rule: 'majority', basis: 'valid' }), [0, null, null])
  assert.deepEqual([valid.outcome, valid.basis, valid.abstain], ['pass', 'valid', 2]) // 유효표 1표 중 찬성 1
  const whole = await runItem(await mk({ title: '기준 인원: 들어온 사람 전체', options: ['찬성', '반대'], rule: 'majority', basis: 'joined' }), [0, 0, null])
  assert.deepEqual([whole.outcome, whole.eligible], ['fail', 4]) // 들어온 4명 중 찬성 2 → 절반 넘게 아님
  const needs = await mk({ title: '최소 참여 인원 99명', options: ['a', 'b'], quorum: 99 })
  assert.match((await admin.post(`/api/admin/items/${needs}/open`)).data.error, /최소 참여 인원 99명/)
  await admin.del(`/api/admin/items/${needs}`)
  ok('최소 참여 인원가 안 되면 못 열고, 통과 기준의 기준 인원(픽한 사람 · 유효표 · 전체)를 골라요')

  // ── 진행: 메모 · 순서 한 번에 · 독려 · 큰 화면 조종 ──
  await admin.post(`/api/admin/items/${q1}/memo`, { memo: '의장 발언 먼저' })
  assert.equal((await admin.get(`/api/admin/rooms/${openRoom.id}`)).data.items.find((x) => x.id === q1).memo, '의장 발언 먼저')
  assert.equal((await va.get('/api/me')).data.items.find((x) => x.id === q1).memo, undefined) // 참여자에게는 안 보여요
  const d1 = await mk({ title: '순서 가', options: ['a', 'b'], seconds: 0 })
  const d2 = await mk({ title: '순서 나', options: ['a', 'b'], seconds: 0 })
  const drafts = () => admin.get(`/api/admin/rooms/${openRoom.id}`).then((r) => r.data.items.filter((x) => x.status === 'draft').map((x) => x.id))
  const before2 = await drafts()
  assert.equal((await admin.post(`/api/admin/rooms/${openRoom.id}/order`, { ids: [d1] })).status, 400)
  assert.equal((await admin.post(`/api/admin/rooms/${openRoom.id}/order`, { ids: [...before2].reverse() })).status, 200)
  assert.deepEqual(await drafts(), [...before2].reverse())
  await admin.post(`/api/admin/items/${d2}/open`)
  assert.equal((await admin.post(`/api/admin/items/${d2}/nudge`)).status, 200)
  assert.equal((await admin.post(`/api/admin/items/${d2}/nudge`)).status, 429)
  assert.ok((await va.get('/api/me')).data.items.find((x) => x.id === d2).nudgeAt > 0)
  assert.equal((await va.post(`/api/admin/items/${d2}/nudge`)).status, 401)
  await admin.post(`/api/admin/items/${d2}/close`)
  assert.equal((await admin.post(`/api/admin/rooms/${openRoom.id}/screen`, { mode: 'notice', notice: '10분 쉬어요' })).status, 200)
  const screenKey = (await admin.get(`/api/admin/rooms/${openRoom.id}`)).data.admin.screenKey
  const shown = (await anon.get(`/api/screen?room=${openCode}&k=${screenKey}`)).data.room
  assert.deepEqual([shown.screenMode, shown.notice], ['notice', '10분 쉬어요'])
  await admin.post(`/api/admin/rooms/${openRoom.id}/screen`, { mode: 'auto' })
  ok('진행자 메모 · 순서 한 번에 바꾸기 · 참여 독려 · 큰 화면 조종')

  // ── 방 관리: 복제 · 보관 · 삭제 미루기 · 방 로고와 색 ──
  const copy = (await admin.post(`/api/admin/rooms/${openRoom.id}/clone`)).data.id
  const copied = (await admin.get(`/api/admin/rooms/${copy}`)).data
  const source = (await admin.get(`/api/admin/rooms/${openRoom.id}`)).data
  assert.deepEqual([copied.room.title, copied.items.length, copied.items.every((x) => x.status === 'draft'), copied.joined], ['열린 방 (복사)', source.items.length, true, 0])
  assert.notEqual(copied.room.code, source.room.code)
  assert.equal((await admin.post(`/api/admin/rooms/${copy}/archive`, { archived: true })).status, 409) // 끝낸 방만
  await admin.post(`/api/admin/rooms/${copy}/close`)
  assert.equal((await admin.post(`/api/admin/rooms/${copy}/archive`, { archived: true })).status, 200)
  assert.equal((await admin.get('/api/admin/rooms')).data.rooms.find((x) => x.id === copy).archived, true)
  assert.equal((await again2.post(`/api/admin/rooms/${hid}/keep`)).status, 403)
  assert.equal((await admin.post(`/api/admin/rooms/${hid}/keep`)).status, 200)
  assert.equal((await again2.post(`/api/admin/rooms/${hid}/logo`, png)).status, 200) // 방장이 자기 방 로고를
  const own = (await again2.get(`/api/admin/rooms/${hid}`)).data
  assert.match(own.org.logo, /^\/uploads\/room-[a-f0-9]{16}\.png$/)
  assert.equal((await fetch(base + own.org.logo)).status, 200)
  assert.equal((await again2.post(`/api/admin/rooms/${hid}/logo?tone=rainbow`)).status, 400)
  await again2.post(`/api/admin/rooms/${hid}/logo?tone=green`)
  assert.equal((await again2.get(`/api/admin/rooms/${hid}`)).data.room.tone, 'green')
  await again2.del(`/api/admin/rooms/${hid}/logo`)
  assert.equal((await again2.get(`/api/admin/rooms/${hid}`)).data.org.logo, logo.data.logo) // 지우면 기관 로고로
  assert.equal((await fetch(base + own.org.logo)).status, 404)
  ok('방 복제 · 보관 · 삭제 미루기 · 방마다 로고와 색')

  // ── 한눈에 보기 · 통계 · 기록 찾기 · 내 비밀번호 · 백업 ──
  const over = (await admin.get('/api/admin/overview')).data
  assert.deepEqual([over.server.version, over.server.auditIntact, over.live.length], ['1.0.1', false, 0]) // 앞에서 기록을 일부러 고쳐 둔 상태
  assert.ok(over.server.dbBytes > 0 && over.rooms.total > 3 && over.today.rooms > 3)
  const stat = (await admin.get('/api/admin/stats')).data.days.at(-1)
  assert.ok(stat.votes > 5 && stat.voters > 5 && stat.items > 5)
  assert.equal((await again2.get('/api/admin/overview')).status, 403) // 방장은 못 봐요
  const found = (await admin.get(`/api/admin/audit?q=${encodeURIComponent('방 복제')}`)).data.rows
  assert.ok(found.length >= 1 && found.every((r) => r.action === '방 복제'))
  const auditCsv = await fetch(`${base}/api/admin/audit.csv?q=${encodeURIComponent('방 만듦')}`, { headers: { cookie: admin.cookie() } })
  assert.ok(Buffer.from(await auditCsv.arrayBuffer()).toString('utf8').includes('"방 만듦"'))
  await admin.post('/api/admin/admins', { name: 'helper', password: 'helper-pass-1' })
  const helper = client()
  await helper.post('/api/admin/login', { id: 'helper', password: 'helper-pass-1' })
  assert.equal((await helper.post('/api/admin/password', { current: 'wrong-wrong', next: 'new-helper-pass' })).status, 401)
  assert.equal((await helper.post('/api/admin/password', { current: 'helper-pass-1', next: 'new-helper-pass' })).status, 200)
  assert.equal((await client().post('/api/admin/login', { id: 'helper', password: 'new-helper-pass' })).status, 200)
  assert.equal((await admin.post('/api/admin/password', { current: 'correct-horse-1', next: 'another-pass-1' })).status, 400) // 최고 관리자는 .env 에서
  assert.equal((await helper.post('/api/admin/backups')).status, 403)
  assert.equal((await helper.get('/api/admin/backups')).data.files.length, 1)
  ok('한눈에 보기 · 통계 · 기록 찾기와 내려받기 · 내 비밀번호 바꾸기')

  // ── 기다리는 동안 볼거리 · 선택지 순서 섞기 ──
  const ag = (await va.get('/api/me')).data.agenda
  assert.ok(ag.total > ag.done && ag.done > 3 && typeof ag.next === 'string')
  const sh = await mk({ title: '순서 섞기', options: ['1', '2', '3', '4', '5', '6', '7', '8'], shuffle: true, seconds: 0 })
  await admin.post(`/api/admin/items/${sh}/open`)
  const seenBy = async (c) => (await c.get('/api/me')).data.items.find((x) => x.id === sh).options
  const orders = await Promise.all([va, vb, vc].map(async (c) => (await seenBy(c)).map((o) => o.label).join('')))
  assert.ok(new Set(orders).size > 1 || orders[0] !== '12345678') // 사람마다 다른 순서
  assert.equal((await seenBy(va)).map((o) => o.label).join(''), orders[0]) // 새로고침해도 같은 순서
  assert.equal((await admin.get(`/api/admin/rooms/${openRoom.id}`)).data.items.find((x) => x.id === sh).options.map((o) => o.label).join(''), '12345678')
  for (const c of [va, vb, vc]) await c.post('/api/vote', { item: sh, options: [(await seenBy(c)).find((o) => o.label === '3').id] })
  await admin.post(`/api/admin/items/${sh}/close`)
  const mixed = (await va.get('/api/me')).data.items.find((x) => x.id === sh)
  assert.deepEqual(mixed.options.map((o) => [o.label, o.votes]).slice(0, 4), [['1', 0], ['2', 0], ['3', 3], ['4', 0]]) // 결과는 원래 순서, 표는 제자리에
  ok('기다리는 동안 진행 상황이 보이고, 선택지 순서를 사람마다 섞어요 (결과는 원래 순서)')

  // ── 확인 요청 ──
  assert.equal((await anon.post('/api/object', { item: sh, note: '집계가 이상해 보여요' })).status, 401)
  assert.equal((await va.post('/api/object', { item: sh, note: '짧' })).status, 400)
  assert.equal((await va.post('/api/object', { item: sh, note: '집계가 이상해 보여요' })).status, 200)
  assert.equal((await va.post('/api/object', { item: sh, note: '한 번 더 낼게요' })).status, 409)
  const objV = (await vb.get('/api/me')).data.items.find((x) => x.id === sh)
  assert.deepEqual([objV.objections, objV.objected, objV.objectionNotes], [1, false, undefined]) // 건수는 모두에게, 내용은 진행자에게만
  assert.ok(objV.objectUntil > Date.now())
  assert.equal((await admin.get(`/api/admin/rooms/${openRoom.id}`)).data.items.find((x) => x.id === sh).objectionNotes[0].note, '집계가 이상해 보여요')
  ok('확인 요청: 마감 뒤 정한 시간 동안 참여자가 익명으로 한 번')

  // ── 지켜보는 사람 ──
  const obKey = (await admin.get(`/api/admin/rooms/${openRoom.id}`)).data.admin.observerKey
  assert.equal((await anon.get(`/api/observe?room=${openCode}&k=${'0'.repeat(32)}`)).status, 403)
  const ob = (await anon.get(`/api/observe?room=${openCode}&k=${obKey}`)).data
  assert.ok(ob.log.some((r) => r.action === '주제 마감') && ob.items.every((x) => x.memo === undefined && x.status !== 'draft'))
  assert.ok(!/127\.0\.0\.1|screenKey|objectionNotes":\[/.test(JSON.stringify(ob)))
  assert.ok(ob.log.some((r) => r.by === '운영자') && !ob.log.some((r) => r.by === 'boss')) // 관리자 계정 이름은 ‘운영자’로만 보여요
  assert.equal((await anon.get(`/api/screen?room=${openCode}&k=${obKey}`)).status, 403) // 지켜보는 사람 열쇠로 큰 화면 권한은 못 얻어요
  assert.equal((await anon.post('/api/vote', { item: sh, options: [] })).status, 401)
  ok('지켜보는 사람: 열쇠가 있으면 진행 상황 · 결과 · 그 방의 기록만 봐요')

  // ── 리허설 ──
  const reh = (await admin.post(`/api/admin/rooms/${openRoom.id}/rehearse`)).data.id
  let rv = (await admin.get(`/api/admin/rooms/${reh}`)).data
  assert.deepEqual([rv.room.rehearsal, rv.joined, rv.items.every((x) => x.status === 'draft'), rv.admin.rehearsalOf], [true, 10, true, openRoom.id])
  assert.equal((await admin.post(`/api/admin/rooms/${reh}/rehearse`)).status, 409)
  const votesBefore = (await admin.get('/api/admin/stats')).data.days.at(-1).votes
  await admin.post(`/api/admin/items/${rv.items[0].id}/open`)
  for (let i = 0; i < 40 && (await admin.get(`/api/admin/rooms/${reh}`)).data.items[0].status !== 'closed'; i++) await sleep(300)
  rv = (await admin.get(`/api/admin/rooms/${reh}`)).data
  assert.deepEqual([rv.items[0].status, rv.items[0].voted, rv.items[0].reason], ['closed', 10, '모두 픽함']) // 가짜 참여자 10명이 알아서 픽
  assert.equal((await admin.get('/api/admin/stats')).data.days.at(-1).votes, votesBefore) // 리허설은 통계에 안 들어가요
  assert.equal((await admin.del(`/api/admin/rooms/${reh}/rehearse`)).data.id, openRoom.id)
  assert.equal((await admin.get(`/api/admin/rooms/${reh}`)).status, 404)
  const hostReh = (await again2.post(`/api/admin/rooms/${hid}/rehearse`)).data.id // 방장은 리허설 방으로 옮겨 갔다가
  assert.equal((await again2.get('/api/host/session')).data.roomId, hostReh)
  await again2.del(`/api/admin/rooms/${hostReh}/rehearse`)
  assert.equal((await again2.get('/api/host/session')).data.roomId, hid) // 끝내면 원래 방으로 돌아와요
  ok('리허설: 똑같은 연습 방 + 가짜 참여자 10명, 끝내면 원래 방으로')

  // ── 결과 확인 코드 ──
  const proven = (await admin.get(`/api/admin/rooms/${openRoom.id}`)).data.items.find((x) => x.id === q1)
  assert.match(proven.proof, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
  assert.equal((await va.get('/api/me')).data.items.find((x) => x.id === q1).proof, proven.proof) // 참여자에게도 같은 코드가 보여요
  const seen0 = (await anon.get(`/api/verify?code=${proven.proof.toLowerCase().replaceAll('-', ' ')}`)).data
  assert.deepEqual([seen0.same, seen0.title, seen0.options, seen0.voted, seen0.outcome], [true, '회칙 개정', [{ label: '찬성', votes: 2 }, { label: '반대', votes: 1 }], 3, 'pass'])
  assert.equal((await anon.get('/api/verify?code=AAAA-BBBB-CCCC')).status, 404)
  assert.ok((await admin.get('/api/admin/audit')).data.rows.some((r) => r.detail.확인코드 === proven.proof))
  const fake = new DatabaseSync(join(dir, 'mypick.db'))
  fake.prepare("UPDATE options SET votes=votes+5 WHERE item_id=? AND label='반대'").run(q1) // 누가 저장 파일에서 결과를 고쳤다면
  fake.close()
  const seen1 = (await anon.get(`/api/verify?code=${proven.proof}`)).data
  assert.deepEqual([seen1.same, seen1.options[1].votes], [false, 6])
  ok('결과 확인 코드: 마감 때 받은 코드로 누구나 확인, 받은 픽가 바뀌면 드러나요')

  // ── 관리자 잠금 ──
  const bad = client()
  for (let i = 0; i < 3; i++) await bad.post('/api/admin/login', { id: 'boss', password: 'x' })
  assert.equal((await bad.post('/api/admin/login', { id: 'boss', password: 'correct-horse-1' })).status, 429)
  ok('관리자 비밀번호를 여러 번 틀리면 잠겨요')

  const head = (await fetch(base + '/api/org')).headers
  assert.match(head.get('content-security-policy'), /script-src 'self'; style-src 'self'/)
  assert.equal(head.get('x-frame-options'), 'DENY')
  assert.equal((await va.post('/api/leave')).status, 409) // 진행 중인 방에서는 못 나가요
  ok('보안 머리글')

  // ── 자동 삭제: 마지막으로 쓴 지 8일 된 것처럼 바꾸고 서버를 다시 켜요 ──
  server.kill()
  await sleep(500)
  const old8 = new DatabaseSync(join(dir, 'mypick.db'))
  old8.prepare('UPDATE rooms SET active_at=? WHERE id IN (?, ?)').run(Date.now() - 8 * 86_400_000, hid, fresh.id)
  old8.close()
  server = boot()
  await up()
  const back = client()
  await back.post('/api/admin/login', { id: 'boss', password: 'correct-horse-1' })
  assert.equal((await back.get(`/api/admin/rooms/${hid}`)).status, 404)
  assert.equal((await back.get(`/api/admin/rooms/${fresh.id}`)).status, 200) // 관리자가 만든 방은 그대로
  assert.ok((await back.get('/api/admin/audit')).data.rows.some((r) => r.action === '방 자동 삭제' && r.detail.방 === hid))
  ok('방장이 만든 방은 며칠 뒤 자동으로 지워지고, 마지막 결과는 기록에 남아요')
  assert.equal(readdirSync(join(dir, 'backups')).filter((f) => /^mypick-\d{4}-\d{2}-\d{2}\.db$/.test(f)).length, 1)
  ok('하루 한 번 저장 파일 백업')

  // ── 백업 내려받기 · 되돌리기 ──
  const snap = (await back.post('/api/admin/backups')).data.name
  assert.match(snap, /^mypick-\d{4}-\d{2}-\d{2}-\d{6}\.db$/)
  const dl = await fetch(`${base}/api/admin/backups/${snap}`, { headers: { cookie: back.cookie() } })
  assert.equal(Buffer.from(await dl.arrayBuffer()).subarray(0, 15).toString(), 'SQLite format 3')
  assert.equal((await fetch(`${base}/api/admin/backups/${snap}`)).status, 401)
  const later = (await back.post('/api/admin/rooms', { title: '백업 뒤에 만든 방', mode: 'simple' })).data.id
  assert.equal((await back.get(`/api/admin/rooms/${later}`)).status, 200)
  const gone = new Promise((r) => server.once('exit', r))
  assert.equal((await back.post(`/api/admin/backups/${snap}/restore`)).data.restarting, true)
  await gone // 서버가 스스로 꺼져요 (도커에서는 바로 다시 켜져요)
  server = boot()
  await up()
  const back2 = client()
  await back2.post('/api/admin/login', { id: 'boss', password: 'correct-horse-1' })
  assert.equal((await back2.get(`/api/admin/rooms/${later}`)).status, 404) // 백업 때로 돌아갔어요
  assert.equal((await back2.get(`/api/admin/rooms/${fresh.id}`)).status, 200)
  assert.ok((await back2.get('/api/admin/audit')).data.rows.some((r) => r.action === '백업으로 되돌림'))
  assert.ok(readdirSync(join(dir, 'backups')).some((f) => f.startsWith('before-restore-'))) // 되돌리기 전 파일도 남겨 둬요
  ok('백업: 지금 만들기 · 내려받기 · 그때로 되돌리기')

  console.log(`\n✓ 검사 ${n}개를 모두 지나갔어요`)
} catch (e) {
  console.error('\n✗ 검사 실패:', e)
  process.exitCode = 1
} finally {
  server.kill()
  rmSync(dir, { recursive: true, force: true })
}
