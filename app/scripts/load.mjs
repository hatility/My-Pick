// 사람이 많을 때 시험: 도커를 켠 뒤 npm run load -- 300  (인원, 기본 100. 주소는 그 뒤에)
// 한 방에 N명이 들어와 실시간 연결을 쥔 채 동시에 픽하고, ‘모두 픽함’으로 저절로 마감되는지,
// 표가 하나도 빠지거나 겹치지 않았는지, 얼마나 걸렸는지를 재요. 시험용 방은 끝나면 지워요.
import assert from 'node:assert/strict'

const N = Number(process.argv[2]) || 100
const base = process.argv[3] || 'http://localhost:8082'
const password = process.env.LOAD_ROOM_PASSWORD || undefined // 넣으면 비밀번호 있는 방으로 시험해요
const { ADMIN_ID = 'admin', ADMIN_PASSWORD } = process.env
assert.ok(ADMIN_PASSWORD, '.env 에 ADMIN_PASSWORD 가 있어야 해요')

const H = { 'X-Requested-With': 'mypick', 'Content-Type': 'application/json' }
async function call(cookie, method, path, body) {
  const t = performance.now()
  const res = await fetch(base + path, { method, headers: { ...(method === 'GET' ? {} : H), cookie }, body: body ? JSON.stringify(body) : undefined })
  const set = res.headers.get('set-cookie')
  return { status: res.status, data: await res.json().catch(() => null), cookie: set ? set.split(';')[0] : cookie, ms: performance.now() - t }
}
const pct = (list, p) => Math.round([...list].sort((a, b) => a - b)[Math.min(list.length - 1, Math.floor(list.length * p))])
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const admin = (await call('', 'POST', '/api/admin/login', { id: ADMIN_ID, password: ADMIN_PASSWORD })).cookie
assert.ok(admin, '관리자 로그인이 안 돼요')
const { data: made } = await call(admin, 'POST', '/api/admin/rooms', { title: `부하 시험 ${N}명`, mode: 'simple', seconds: 120, grace: 10, password })
const room = `/api/admin/rooms/${made.id}`
const state = async () => (await call(admin, 'GET', room)).data
const hold = new AbortController()

try {
  const code = (await state()).room.code
  const { data: item } = await call(admin, 'POST', `${room}/items`, { title: '부하 시험', options: ['가', '나', '다'] })

  // 1) N명이 들어와 실시간 연결을 엽니다 (25명씩 묶어서)
  let t = performance.now()
  const voters = []
  const joinMs = []
  for (let i = 0; i < N; i += 25) {
    const batch = await Promise.all(Array.from({ length: Math.min(25, N - i) }, () => call('', 'POST', '/api/join', { room: code, password })))
    for (const r of batch) {
      assert.equal(r.status, 200, `입장 실패: ${JSON.stringify(r.data)}`)
      joinMs.push(r.ms)
      voters.push(r.cookie)
    }
  }
  let pings = 0
  await Promise.all(
    voters.map(async (cookie) => {
      const res = await fetch(`${base}/api/events?room=${code}`, { headers: { cookie }, signal: hold.signal })
      assert.equal(res.status, 200)
      ;(async () => {
        try {
          for await (const chunk of res.body) pings += String(Buffer.from(chunk)).split('data:').length - 1
        } catch {
          /* 끝날 때 끊어요 */
        }
      })()
    }),
  )
  const joinTotal = performance.now() - t
  await sleep(1000)
  const before = await state()
  assert.equal(before.joined, N)
  assert.equal(before.present, N, `접속 인원이 ${before.present}/${N}`)

  // 2) 주제를 열고, 모두가 2초 안에 흩어져 픽합니다. 다섯 명 중 한 명은 두 번 눌러 봅니다.
  await call(admin, 'POST', `/api/admin/items/${item.id}/open`)
  const opts = (await call(voters[0], 'GET', '/api/me')).data.items[0].options.map((o) => o.id)
  const want = [0, 0, 0]
  t = performance.now()
  const voteMs = []
  let doubles = 0
  await Promise.all(
    voters.map(async (cookie, i) => {
      await sleep(Math.random() * 2000)
      const pick = i % 3
      const r = await call(cookie, 'POST', '/api/vote', { item: item.id, options: [opts[pick]] })
      assert.equal(r.status, 200, `픽 실패: ${JSON.stringify(r.data)}`)
      want[pick]++
      voteMs.push(r.ms)
      if (i % 5 === 0) {
        const again = await call(cookie, 'POST', '/api/vote', { item: item.id, options: [opts[(pick + 1) % 3]] })
        assert.equal(again.status, 409)
        doubles++
      }
      await call(cookie, 'GET', '/api/me') // 실제 화면처럼 상태를 다시 읽어요
    }),
  )
  const voteTotal = performance.now() - t

  // 3) 저절로 마감되고, 숫자가 정확한지
  t = performance.now()
  let done
  for (let i = 0; i < 100; i++) {
    done = (await state()).items[0]
    if (done.status === 'closed') break
    await sleep(100)
  }
  const closeMs = performance.now() - t
  assert.equal(done.status, 'closed')
  assert.equal(done.reason, '모두 픽함')
  assert.equal(done.voted, N)
  assert.deepEqual(done.options.map((o) => o.votes), want)

  console.log(`✓ ${N}명 시험을 지나갔어요 (${base})`)
  console.log(`  입장: 모두 ${Math.round(joinTotal)}ms, 한 명 가운데값 ${pct(joinMs, 0.5)}ms · 느린 쪽(95%) ${pct(joinMs, 0.95)}ms`)
  console.log(`  픽: 모두 ${Math.round(voteTotal)}ms, 한 명 가운데값 ${pct(voteMs, 0.5)}ms · 느린 쪽(95%) ${pct(voteMs, 0.95)}ms · 가장 느린 ${Math.round(Math.max(...voteMs))}ms`)
  console.log(`  마지막 픽 → 자동 마감: ${Math.round(closeMs)}ms`)
  console.log(`  받은 픽 ${want.join(' / ')} (합 ${N}) 정확, 두 번 누른 ${doubles}명 모두 거부, 받은 실시간 알림 ${pings}개`)
} finally {
  hold.abort()
  await call(admin, 'DELETE', room)
}
