// 관리자 화면의 나머지 조각: 한눈에 보기(+ 서버 상태) · 통계 · 백업 · 내 비밀번호 · 방 꾸미기 · 큰 화면 조종
import { useEffect, useState } from 'react'
import { Download, RotateCcw } from 'lucide-react'
import { ask } from './ui'
import { api, type RoomState } from './api'
import { clock, shrink } from './parts'
import { Err, useAct } from './Admin'

const when = (t: number) => new Date(t).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const size = (b: number) => (b > 1_048_576 ? `${(b / 1_048_576).toFixed(1)}MB` : `${Math.max(1, Math.round(b / 1024))}KB`)

// ── 한눈에 보기 ───────────────────────────────────────────
type Overview = {
  live: { id: number; title: string; closesAt: number | null; paused?: number; roomId: number; room: string; code: string; voted: number; joined: number; present: number }[]
  scheduled: { title: string; openAt: number; roomId: number; room: string }[]
  rooms: { total: number; active: number | null; archived: number | null }
  today: { rooms: number; voters: number; items: number; votes: number }
  reportsOpen: number
  expiring: { id: number; title: string; code: string; expiresAt: number }[]
  server: { version: string; node: string; upSince: number; connections: number; maxConnections: number; dbBytes: number; backups: number; lastBackup: string | null; publicRooms: boolean; keepDays: number; https: boolean; auditIntact: boolean }
}
export function OverviewTab({ onOpen, onReports }: { onOpen: (id: number) => void; onReports: () => void }) {
  const [d, setD] = useState<Overview | null>(null)
  useEffect(() => {
    const load = () => api<Overview>('/api/admin/overview').then(setD, () => {})
    load()
    const t = setInterval(load, 5000) // 5초마다 새로 읽어요
    return () => clearInterval(t)
  }, [])
  if (!d) return null
  const s = d.server
  return (
    <>
      <div className="ad-head">
        <h1>한눈에 보기</h1>
      </div>
      <ul className="tiles">
        <li className={d.live.length ? 'tile tile-hot' : 'tile'}>
          <strong>{d.live.length}</strong>지금 열린 픽
        </li>
        <li className="tile">
          <strong>{d.rooms.active ?? 0}</strong>진행 중인 방
        </li>
        <li className="tile">
          <strong>{d.today.voters}</strong>오늘 들어온 사람
        </li>
        <li className="tile">
          <strong>{d.today.votes}</strong>오늘 받은 픽
        </li>
        <li className={d.reportsOpen ? 'tile tile-hot' : 'tile'}>
          <button className="tile-btn" onClick={onReports}>
            <strong>{d.reportsOpen}</strong>확인할 신고
          </button>
        </li>
      </ul>

      <section className="card">
        <h2>지금 열린 픽</h2>
        {d.live.length === 0 && <p className="empty">지금 열려 있는 픽이 없어요.</p>}
        <ul className="reports">
          {d.live.map((x) => (
            <li key={x.id}>
              <div>
                <strong>{x.title}</strong>
                <span>
                  {x.room} (방 번호 {x.code}), {x.voted} / {x.joined}명 픽, 지금 접속 {x.present}명
                  {x.paused ? ', 잠깐 멈춤' : x.closesAt ? `, ${clock(Math.max(0, Math.ceil((x.closesAt - Date.now()) / 1000)))} 남음` : ''}
                </span>
              </div>
              <button className="btn btn-small" onClick={() => onOpen(x.roomId)}>
                방 열기
              </button>
            </li>
          ))}
        </ul>
      </section>

      {(d.scheduled.length > 0 || d.expiring.length > 0) && (
        <section className="card">
          <h2>곧 있을 일</h2>
          <ul className="reports">
            {d.scheduled.map((x) => (
              <li key={`s-${x.roomId}-${x.title}`}>
                <div>
                  <strong>{x.title}</strong>
                  <span>
                    {x.room}에서 {when(x.openAt)}에 저절로 열려요
                  </span>
                </div>
                <button className="btn btn-small" onClick={() => onOpen(x.roomId)}>
                  방 열기
                </button>
              </li>
            ))}
            {d.expiring.map((x) => (
              <li key={`e-${x.id}`}>
                <div>
                  <strong>{x.title}</strong>
                  <span>
                    방 번호 {x.code}, {when(x.expiresAt)}에 자동으로 지워져요
                  </span>
                </div>
                <button className="btn btn-small" onClick={() => onOpen(x.id)}>
                  방 열기
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <h2>서버 상태</h2>
        <dl className="status">
          <div>
            <dt>버전</dt>
            <dd>
              My Pick {s.version} (Node {s.node})
            </dd>
          </div>
          <div>
            <dt>켜진 때</dt>
            <dd>{when(s.upSince)}</dd>
          </div>
          <div>
            <dt>실시간 연결</dt>
            <dd className={s.connections >= s.maxConnections * 0.9 ? 'bad' : ''}>
              {s.connections} / {s.maxConnections}
              {s.connections >= s.maxConnections * 0.9 && ' (거의 찼어요. 더 들어오면 화면이 저절로 바뀌지 않는 사람이 생겨요. .env 의 MAX_CONNECTIONS 를 올려 주세요)'}
            </dd>
          </div>
          <div>
            <dt>저장 파일</dt>
            <dd>
              {size(s.dbBytes)}, 방 {d.rooms.total}개 (보관 {d.rooms.archived ?? 0}개)
            </dd>
          </div>
          <div>
            <dt>백업</dt>
            <dd>{s.lastBackup ? `${s.backups}개, 마지막 ${s.lastBackup}` : '아직 없어요'}</dd>
          </div>
          <div>
            <dt>기록</dt>
            <dd className={s.auditIntact ? '' : 'bad'}>{s.auditIntact ? '이어져 있어요' : '어긋나 있어요 (기록 탭을 확인해 주세요)'}</dd>
          </div>
          <div>
            <dt>접속 보안</dt>
            <dd className={s.https ? '' : 'bad'}>{s.https ? 'HTTPS 로 접속 중' : 'HTTP 로 접속 중 (밖에서 쓸 때는 HTTPS 로 띄워 주세요)'}</dd>
          </div>
          <div>
            <dt>누구나 방 만들기</dt>
            <dd>{s.publicRooms ? `켜짐 (마지막으로 쓴 뒤 ${s.keepDays}일 지나면 자동 삭제)` : '꺼짐'}</dd>
          </div>
        </dl>
      </section>
    </>
  )
}

// ── 통계 ──────────────────────────────────────────────────
type Day = { day: string; rooms: number; voters: number; items: number; votes: number; eligible: number }
export function StatsTab() {
  const [days, setDays] = useState<Day[] | null>(null)
  useEffect(() => {
    api<{ days: Day[] }>('/api/admin/stats').then((d) => setDays(d.days), () => setDays([]))
  }, [])
  if (!days) return null
  const sum = (list: Day[], k: keyof Omit<Day, 'day'>) => list.reduce((n, d) => n + d[k], 0)
  const rate = (list: Day[]) => (sum(list, 'eligible') ? `${Math.round((sum(list, 'votes') / sum(list, 'eligible')) * 100)}%` : '없음')
  // 최근 30일을 빈 날까지 채워서 그려요
  const byDay = new Map(days.map((d) => [d.day, d]))
  const last = Array.from({ length: 30 }, (_, i) => {
    const day = new Date(Date.now() - (29 - i) * 86_400_000).toISOString().slice(0, 10)
    return byDay.get(day) ?? { day, rooms: 0, voters: 0, items: 0, votes: 0, eligible: 0 }
  })
  const max = Math.max(1, ...last.map((d) => d.votes))
  // 주(월요일 시작)마다 묶기
  const weeks = new Map<string, Day[]>()
  for (const d of days) {
    const t = new Date(d.day + 'T00:00:00Z')
    t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7))
    const k = t.toISOString().slice(0, 10)
    weeks.set(k, [...(weeks.get(k) ?? []), d])
  }
  return (
    <>
      <div className="ad-head">
        <h1>통계</h1>
      </div>
      <p className="tip">날마다 합계만 세어 둬요. 방이 지워져도 남고, 누가 무엇을 골랐는지와는 상관없는 숫자예요. 연습 픽은 빼요. 날짜는 세계 표준시 기준이에요.</p>
      <ul className="tiles">
        <li className="tile">
          <strong>{sum(days, 'rooms')}</strong>만든 방
        </li>
        <li className="tile">
          <strong>{sum(days, 'voters')}</strong>들어온 사람
        </li>
        <li className="tile">
          <strong>{sum(days, 'items')}</strong>마감한 주제
        </li>
        <li className="tile">
          <strong>{sum(days, 'votes')}</strong>받은 픽
        </li>
        <li className="tile">
          <strong>{rate(days)}</strong>평균 참여율
        </li>
      </ul>
      <section className="card">
        <h2>날마다 받은 픽 (최근 {last.length}일)</h2>
        {days.length === 0 ? (
          <p className="empty">아직 숫자가 없어요. 픽을 한 번 마감하면 여기에 쌓여요.</p>
        ) : (
          <figure className="chart">
            <svg viewBox={`0 0 ${last.length * 20} 100`} preserveAspectRatio="none" role="img" aria-label={`최근 ${last.length}일 동안 날마다 받은 픽. 가장 많은 날 ${max}픽`}>
              {last.map((d, i) => (
                <rect key={d.day} className="chart-bar" x={i * 20 + 3} y={100 - (d.votes / max) * 96} width="14" height={(d.votes / max) * 96}>
                  <title>
                    {d.day}: {d.votes}픽
                  </title>
                </rect>
              ))}
            </svg>
            <figcaption>
              <span>{last[0].day}</span>
              <span>가장 많은 날 {max}픽</span>
              <span>{last.at(-1)!.day}</span>
            </figcaption>
          </figure>
        )}
      </section>
      <section className="card">
        <h2>주마다</h2>
        <table className="table">
          <thead>
            <tr>
              <th scope="col">시작하는 날</th>
              <th scope="col">방</th>
              <th scope="col">사람</th>
              <th scope="col">주제</th>
              <th scope="col">픽</th>
              <th scope="col">참여율</th>
            </tr>
          </thead>
          <tbody>
            {[...weeks].reverse().map(([k, list]) => (
              <tr key={k}>
                <th scope="row">{k}</th>
                <td>{sum(list, 'rooms')}</td>
                <td>{sum(list, 'voters')}</td>
                <td>{sum(list, 'items')}</td>
                <td>{sum(list, 'votes')}</td>
                <td>{rate(list)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  )
}

// ── 내 비밀번호 바꾸기 (더한 관리자) ──────────────────────
export function MyPassword({ top }: { top: boolean }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [done, setDone] = useState(false)
  const { act, error, busy } = useAct()
  return (
    <section className="card">
      <h2>내 비밀번호</h2>
      {top ? (
        <p className="tip">최고 관리자의 비밀번호는 서버의 .env 파일(ADMIN_PASSWORD)에서 바꾸고 서버를 다시 띄워요.</p>
      ) : (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault()
            act(() => api('/api/admin/password', 'POST', { current, next })).then((ok) => {
              setDone(ok)
              if (ok) (setCurrent(''), setNext(''))
            })
          }}
        >
          <div className="grid2">
            <label className="field">
              <span>지금 비밀번호</span>
              <input className="input" type="password" autoComplete="current-password" maxLength={100} value={current} onChange={(e) => setCurrent(e.target.value)} required />
            </label>
            <label className="field">
              <span>새 비밀번호 (8자 이상)</span>
              <input className="input" type="password" autoComplete="new-password" minLength={8} maxLength={100} value={next} onChange={(e) => setNext(e.target.value)} required />
            </label>
          </div>
          <Err text={error} />
          <div className="actions actions-start">
            <button className="btn btn-primary" disabled={busy}>
              비밀번호 바꾸기
            </button>
            {done && <span role="status">바꿨어요.</span>}
          </div>
        </form>
      )}
    </section>
  )
}

// ── 백업 ──────────────────────────────────────────────────
type Backup = { name: string; bytes: number; at: number }
export function Backups({ top }: { top: boolean }) {
  const [data, setData] = useState<{ keepDays: number; files: Backup[] } | null>(null)
  const [note, setNote] = useState('')
  const load = () => api<{ keepDays: number; files: Backup[] }>('/api/admin/backups').then(setData)
  const { act, error, busy } = useAct(load)
  useEffect(() => {
    load().catch(() => {})
  }, [])
  if (!data) return null
  const restore = async (f: Backup) => {
    if (!(await ask(`${f.name} 때로 되돌릴까요?\n그 뒤에 만든 방 · 픽 · 설정은 모두 사라져요. 지금 상태는 따로 남겨 두지만, 서버가 잠깐 꺼졌다 켜져요.`, { ok: '되돌리기', danger: true }))) return
    api(`/api/admin/backups/${f.name}/restore`, 'POST').then(
      () => {
        setNote('되돌리는 중이에요. 10초 뒤에 다시 열어요.')
        setTimeout(() => location.reload(), 10_000)
      },
      (e) => setNote((e as Error).message),
    )
  }
  return (
    <section className="card">
      <h2>백업</h2>
      <p className="tip">
        저장 파일(방 · 주제 · 결과 · 기록)을 하루에 한 번 통째로 떠 둬요{data.keepDays ? ` (최근 ${data.keepDays}일치)` : ' (지금은 꺼져 있어요)'}. {top ? '내려받아 다른 곳에 보관하거나, 문제가 생겼을 때 그때로 되돌릴 수 있어요.' : '내려받기 · 되돌리기는 최고 관리자만 할 수 있어요.'}
      </p>
      {top && (
        <div className="actions actions-start">
          <button className="btn" disabled={busy} onClick={() => act(() => api('/api/admin/backups', 'POST'))}>
            지금 백업하기
          </button>
        </div>
      )}
      {data.files.length === 0 && <p className="empty">아직 백업이 없어요.</p>}
      <ul className="reports">
        {data.files.map((f) => (
          <li key={f.name}>
            <div>
              <strong>{f.name}</strong>
              <span>
                {when(f.at)}, {size(f.bytes)}
              </span>
            </div>
            {top && (
              <div className="actions">
                <a className="btn btn-small" href={`/api/admin/backups/${f.name}`} download>
                  <Download size={16} aria-hidden="true" />
                  내려받기
                </a>
                <button className="btn btn-small" onClick={() => restore(f)}>
                  <RotateCcw size={16} aria-hidden="true" />이 때로 되돌리기
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {note && <p role="status">{note}</p>}
      <Err text={error} />
    </section>
  )
}

// ── 방 꾸미기: 방마다 로고 · 색 ───────────────────────────
const TONES: [string, string][] = [
  ['', '기본'],
  ['blue', '파랑'],
  ['green', '초록'],
  ['purple', '보라'],
  ['orange', '주황'],
  ['pink', '분홍'],
]
export function RoomLook({ roomId, tone, hasLogo, refresh }: { roomId: number; tone: string; hasLogo: boolean; refresh: () => unknown }) {
  const { act, error, busy } = useAct(refresh)
  return (
    <details className="card no-print">
      <summary>방 꾸미기 (로고 · 색)</summary>
      <p className="tip">이 방에서만 쓰는 로고와 색이에요. 여러 단체가 같이 쓸 때 방마다 다르게 꾸밀 수 있어요. 로고가 없으면 기관 로고가 나와요.</p>
      <fieldset className="tones">
        <legend>색</legend>
        {TONES.map(([value, name]) => (
          <label key={value} className={`tone tone-${value || 'base'}`}>
            <input type="radio" name="tone" checked={tone === value} disabled={busy} onChange={() => act(() => api(`/api/admin/rooms/${roomId}/logo?tone=${value}`, 'POST'))} />
            <span>{name}</span>
          </label>
        ))}
      </fieldset>
      <div className="look-logo">
        <span className="look-label">로고</span>
        <div className="actions actions-start">
        <label className="btn">
          방 로고 사진 고르기
          <input
            className="sr"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) act(async () => api(`/api/admin/rooms/${roomId}/logo`, 'POST', await shrink(file)))
            }}
          />
        </label>
        {hasLogo && (
          <button className="btn" disabled={busy} onClick={() => act(() => api(`/api/admin/rooms/${roomId}/logo`, 'DELETE'))}>
            방 로고 지우기
          </button>
        )}
        </div>
      </div>
      <Err text={error} />
    </details>
  )
}

// ── 큰 화면 조종 ──────────────────────────────────────────
const MODES: [RoomState['room']['screenMode'], string][] = [
  ['auto', '자동'],
  ['join', '입장 안내'],
  ['result', '마지막 결과'],
  ['notice', '공지'],
]
export function ScreenControl({ roomId, mode, notice, refresh }: { roomId: number; mode: RoomState['room']['screenMode']; notice: string; refresh: () => unknown }) {
  const [text, setText] = useState(notice)
  const { act, error, busy } = useAct(refresh)
  const set = (m: RoomState['room']['screenMode']) => act(() => api(`/api/admin/rooms/${roomId}/screen`, 'POST', { mode: m, notice: text }))
  return (
    <details className="screen-ctl no-print" open={mode !== 'auto'}>
      <summary>
        <span className="screen-ctl-label">큰 화면에 띄울 것</span>
        <small>지금: {MODES.find(([m]) => m === mode)?.[1] ?? '자동'}</small>
      </summary>
      <div className="screen-ctl-body">
      <div className="seg" role="group" aria-label="큰 화면에 띄울 것">
        {MODES.map(([m, name]) => (
          <button key={m} className="seg-btn" aria-pressed={mode === m} disabled={busy || (m === 'notice' && !text.trim())} onClick={() => set(m)}>
            {name}
          </button>
        ))}
      </div>
      <input className="input" maxLength={120} placeholder="공지로 띄울 글 (예: 10분 쉬었다 시작해요)" aria-label="공지로 띄울 글" value={text} onChange={(e) => setText(e.target.value)} />
      <Err text={error} />
      </div>
    </details>
  )
}
