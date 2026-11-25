// 관리자 화면 (/admin): 로그인 → 방 목록 → 방 하나 진행 (안건 열기 · 마감 · 입장 코드 · 큰 화면) · 기관 설정 · 기록
import { useEffect, useState, type FormEvent } from 'react'
import { Archive, ArrowDown, Eye, FlaskConical, Smartphone, ArrowLeft, ArrowUp, Ban, BellRing, Clock, Copy, GripVertical, SkipForward, Download, Scale, DoorClosed, DoorOpen, LogOut, MonitorUp, Pencil, Play, Plus, Printer, ShieldCheck, ShieldAlert, Square, Trash2 } from 'lucide-react'
import { api, type Item, type Org, type RoomState } from './api'
import { Qr } from './Qr'
import { Backups, MyPassword, OverviewTab, RoomLook, ScreenControl, StatsTab } from './AdminMore'
import { Loading, Offline, OrgMark, Practice, shrink, Result, ThemeToggle, TimeLeft, useLive, type Live } from './parts'
import './admin.css'

export type Defaults = { seconds: number; grace: number; maxLogoMb: number; siteUrl: string }
type RoomRow = { id: number; code: string; title: string; mode: 'simple' | 'strict'; owner: 'admin' | 'host'; expiresAt: number | null; archived: boolean; rehearsal: boolean; liveItem: string | null; present: number; closed: boolean; joined: number; items: number }
type RoomInput = { title: string; mode: 'simple' | 'strict'; password: string; hostPassword?: string; capacity: number; seconds: number; grace: number; closeAll: boolean; live: boolean }

/** 버튼 하나의 일: 하는 동안 잠그고, 안 되면 까닭을 보여 줘요 */
export function useAct(after?: () => unknown) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
      await after?.()
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }
  return { act, error, busy }
}
export const Err = ({ text }: { text: string }) =>
  text ? (
    <p className="error" role="alert">
      {text}
    </p>
  ) : null

const MODE = { simple: '간편', strict: '엄격' } as const
const day = (t: number) => new Date(t).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })
/** 무엇을 인쇄할지 정하고 인쇄 창을 열어요 (admin.css 의 @media print 가 이 값을 봐요) */
const printAs = (what: 'codes' | 'results' | 'minutes') => {
  document.body.dataset.print = what
  print()
}
const BASIS = { voted: '픽한 사람', valid: '기권을 뺀 사람', joined: '들어온 사람 전체' } as const
const fmtCode = (c: string) => `${c.slice(0, 4)}-${c.slice(4)}`

type Session = { enabled: boolean; authed: boolean; name: string | null; top: boolean }
type Tab = 'home' | 'rooms' | 'reports' | 'stats' | 'org' | 'audit' | 'admins'
const when = (t: number) => new Date(t).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export function Admin() {
  const [session, setSession] = useState<Session | null>(null)
  const check = () => api('/api/admin/session').then(setSession, () => setSession({ enabled: true, authed: false, name: null, top: false }))
  useEffect(() => {
    check()
  }, [])
  if (!session) return null
  if (!session.authed) return <Login enabled={session.enabled} onDone={check} />
  return <Console me={session} onLogout={() => api('/api/admin/logout', 'POST').finally(check)} />
}

function Login({ enabled, onDone }: { enabled: boolean; onDone: () => void }) {
  const [id, setId] = useState('')
  const [password, setPassword] = useState('')
  const { act, error, busy } = useAct(onDone)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    act(() => api('/api/admin/login', 'POST', { id, password }))
  }
  return (
    <main className="ad-login">
      <OrgMark org={null} />
      <h1>관리자 로그인</h1>
      {!enabled && <p className="warn">관리자 비밀번호가 아직 없어요. .env 파일의 ADMIN_PASSWORD 를 8자 이상으로 넣고 서버를 다시 띄워 주세요.</p>}
      <form className="join" onSubmit={submit}>
        <label className="field">
          <span>아이디</span>
          <input className="input" autoComplete="username" value={id} onChange={(e) => setId(e.target.value)} autoFocus />
        </label>
        <label className="field">
          <span>비밀번호</span>
          <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <Err text={error} />
        <button className="btn btn-primary btn-big" disabled={busy || !enabled}>
          로그인
        </button>
      </form>
    </main>
  )
}

function Console({ me, onLogout }: { me: Session; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>(() => (/^#room-\d+$/.test(location.hash) ? 'rooms' : 'home'))
  const [reports, setReports] = useState(0)
  const countReports = () => api<{ open: number }>('/api/admin/reports').then((d) => setReports(d.open), () => {})
  const [roomId, setRoomId] = useState<number | null>(() => Number(/^#room-(\d+)$/.exec(location.hash)?.[1]) || null)
  const [org, setOrg] = useState<Org | null>(null)
  const [defs, setDefs] = useState<Defaults | null>(null)
  useEffect(() => {
    api<Org>('/api/org').then(setOrg, () => {})
    api<Defaults>('/api/admin/defaults').then(setDefs, () => {})
    countReports()
  }, [])
  const go = (id: number | null) => {
    setRoomId(id)
    setTab('rooms')
    history.replaceState(null, '', id ? `#room-${id}` : location.pathname)
  }
  if (!defs) return null
  return (
    <div className="ad">
      <header className="ad-bar">
        <OrgMark org={org} />
        <nav className="ad-tabs" aria-label="관리자 메뉴">
          {(['home', 'rooms', 'reports', 'stats', 'org', 'audit', ...(me.top ? (['admins'] as const) : [])] as Tab[]).map((t) => (
            <button key={t} className="ad-tab" aria-current={tab === t ? 'page' : undefined} onClick={() => (t === 'rooms' ? go(null) : setTab(t))}>
              {{ home: '한눈에', rooms: '방 목록', reports: reports ? `신고 ${reports}` : '신고', stats: '통계', org: '설정', audit: '기록', admins: '관리자' }[t]}
            </button>
          ))}
        </nav>
        <span className="ad-me">{me.name}</span>
        <ThemeToggle />
        <button className="btn btn-quiet" onClick={onLogout}>
          <LogOut size={18} aria-hidden="true" />
          로그아웃
        </button>
      </header>
      <main className="ad-main">
        {tab === 'home' && <OverviewTab onOpen={go} onReports={() => setTab('reports')} />}
        {tab === 'stats' && <StatsTab />}
        {tab === 'org' && <OrgTab org={org} setOrg={setOrg} defs={defs} top={me.top} />}
        {tab === 'audit' && <AuditTab />}
        {tab === 'reports' && <ReportsTab onOpen={go} onChange={countReports} />}
        {tab === 'admins' && <AdminsTab />}
        {tab === 'rooms' && (roomId ? <RoomPage key={roomId} id={roomId} defs={defs} onBack={() => go(null)} onOpen={go} /> : <Rooms defs={defs} onOpen={go} />)}
      </main>
    </div>
  )
}

// ── 방 목록 ───────────────────────────────────────────
const FILTERS = [
  ['all', '전체'],
  ['live', '픽 받는 중'],
  ['open', '진행 중'],
  ['closed', '끝남'],
  ['soon', '곧 삭제'],
  ['archived', '보관함'],
] as const
type Filter = (typeof FILTERS)[number][0]
function Rooms({ defs, onOpen }: { defs: Defaults; onOpen: (id: number) => void }) {
  const [rooms, setRooms] = useState<RoomRow[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [picked, setPicked] = useState<number[]>([])
  const load = () => api<{ rooms: RoomRow[] }>('/api/admin/rooms').then((d) => setRooms(d.rooms), () => setRooms((r) => r ?? []))
  const { act, error, busy } = useAct(load)
  useEffect(() => {
    load()
    const t = setInterval(load, 5000) // ‘픽 받는 중’ · 접속 인원이 바로바로 보이게
    return () => clearInterval(t)
  }, [])
  if (!rooms) return null
  const soon = Date.now() + 2 * 86_400_000
  const match = (r: RoomRow) =>
    (filter === 'archived' ? r.archived : !r.archived) &&
    (filter === 'live' ? !!r.liveItem : filter === 'open' ? !r.closed : filter === 'closed' ? r.closed : filter === 'soon' ? !!r.expiresAt && r.expiresAt < soon : true) &&
    (!q.trim() || r.title.toLowerCase().includes(q.trim().toLowerCase()) || r.code.includes(q.trim()))
  const shown = rooms.filter(match)
  const removeMany = () =>
    confirm(`고른 방 ${picked.length}개를 지울까요?\n안건과 결과가 모두 사라져요. 마지막 결과는 ‘기록’에 남아요.`) &&
    act(async () => {
      for (const id of picked) await api(`/api/admin/rooms/${id}`, 'DELETE')
      setPicked([])
    })
  return (
    <>
      <div className="ad-head">
        <h1>모든 방</h1>
        {!adding && (
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            <Plus size={18} aria-hidden="true" />새 방 만들기
          </button>
        )}
      </div>
      {adding && (
        <section className="card">
          <h2>새 방 만들기</h2>
          <RoomForm
            defs={defs}
            submitLabel="방 만들기"
            onCancel={() => setAdding(false)}
            onSubmit={async (f) => onOpen((await api<{ id: number }>('/api/admin/rooms', 'POST', f)).id)}
          />
        </section>
      )}
      {rooms.length === 0 && !adding && <p className="empty">아직 방이 없어요. ‘새 방 만들기’로 첫 방을 만들어 보세요.</p>}
      {rooms.length > 0 && (
        <div className="finder">
          <input className="input" type="search" placeholder="방 이름이나 방 번호로 찾기" aria-label="방 찾기" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="seg" role="group" aria-label="걸러 보기">
            {FILTERS.map(([f, name]) => (
              <button key={f} className="seg-btn" aria-pressed={filter === f} onClick={() => (setFilter(f), setPicked([]))}>
                {name}
              </button>
            ))}
          </div>
        </div>
      )}
      {picked.length > 0 && (
        <div className="bulk" role="status">
          <span>{picked.length}개 골랐어요</span>
          <button className="btn btn-small" onClick={() => setPicked([])}>
            고르기 풀기
          </button>
          <button className="btn btn-small btn-danger" disabled={busy} onClick={removeMany}>
            <Trash2 size={16} aria-hidden="true" />
            고른 방 지우기
          </button>
        </div>
      )}
      <Err text={error} />
      {rooms.length > 0 && shown.length === 0 && <p className="empty">여기에 맞는 방이 없어요.</p>}
      {(['admin', 'host'] as const).map((owner) => {
        const list = shown.filter((r) => r.owner === owner)
        if (!list.length) return null
        return (
          <section key={owner} className="room-group">
            <h2>
              {owner === 'admin' ? '관리자가 만든 방' : '방장이 만든 방'} {list.length}개
            </h2>
            {owner === 'host' && <p className="tip">누구나 만들 수 있는 방이에요. 마지막으로 쓴 뒤 정한 날이 지나면 자동으로 지워져요. 문제가 있는 방은 열어서 ‘방 지우기’를 눌러 주세요.</p>}
            <ul className="rooms">
              {list.map((r) => (
                <li key={r.id} className="room-li">
                  <input type="checkbox" aria-label={`${r.title} 고르기`} checked={picked.includes(r.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, r.id] : picked.filter((x) => x !== r.id))} />
                  <button className="room-row" onClick={() => onOpen(r.id)}>
                    <strong>
                      {r.liveItem && <span className="chip chip-open">픽 받는 중</span>}
                      {r.rehearsal && <span className="tag">리허설</span>}
                      {r.title}
                    </strong>
                    <span className="room-code">{r.code}</span>
                    <span className="room-meta">
                      {r.liveItem ? `‘${r.liveItem}’ 픽 받는 중, 지금 접속 ${r.present}명, ` : ''}
                      {MODE[r.mode]} 방식, 안건 {r.items}개, 들어온 {r.joined}명{r.closed ? ', 끝남' : ''}
                      {r.expiresAt ? `, ${day(r.expiresAt)}에 자동 삭제` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </>
  )
}

export function RoomForm({ defs, initial, fixedMode, host, submitLabel, onSubmit, onCancel }: { defs: Defaults; initial?: Partial<RoomInput>; fixedMode?: boolean; host?: boolean; submitLabel: string; onSubmit: (f: RoomInput) => Promise<unknown>; onCancel?: () => void }) {
  const [f, setF] = useState<RoomInput>({ title: '', mode: 'simple', password: '', capacity: 0, seconds: defs.seconds, grace: defs.grace, closeAll: true, live: false, ...initial })
  const set = <K extends keyof RoomInput>(k: K, v: RoomInput[K]) => setF((x) => ({ ...x, [k]: v }))
  const { act, error, busy } = useAct()
  const n = (v: string) => Math.max(0, Math.floor(Number(v) || 0))
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault()
        act(() => onSubmit(f))
      }}
    >
      <label className="field">
        <span>방 이름</span>
        <input className="input" maxLength={60} placeholder="예: 가을 축제 준비" value={f.title} onChange={(e) => set('title', e.target.value)} required />
      </label>

      {host && (
        <label className="field">
          <span>방장 비밀번호 (6자 이상, 이 방을 진행할 때 써요. 잃어버리면 되찾을 수 없어요)</span>
          <input className="input" type="password" autoComplete="new-password" maxLength={100} value={f.hostPassword ?? ''} onChange={(e) => set('hostPassword', e.target.value)} required minLength={6} />
        </label>
      )}

      {!fixedMode && (
        <fieldset className="choice">
          <legend>입장 방식 (만든 뒤에는 바꿀 수 없어요)</legend>
          <label className="choice-card">
            <input type="radio" name="mode" checked={f.mode === 'simple'} onChange={() => set('mode', 'simple')} />
            <span>
              <strong>간편</strong>방 번호(와 방 비밀번호)로 들어와요. 빠르지만 같은 사람이 다른 기기로 한 번 더 들어올 수 있어서, 정원과 ‘입장 마감’으로 막아요.
            </span>
          </label>
          <label className="choice-card">
            <input type="radio" name="mode" checked={f.mode === 'strict'} onChange={() => set('mode', 'strict')} />
            <span>
              <strong>엄격</strong>한 사람에게 입장 코드를 하나씩 나눠 줘요. 코드 하나로 한 번만 참여할 수 있어서 두 번 고를 수 없어요.
            </span>
          </label>
        </fieldset>
      )}

      <div className="grid2">
        <label className="field">
          <span>방 비밀번호 {fixedMode ? '(바꿀 때만 적어요)' : '(없어도 돼요. 적으면 4자 이상)'}</span>
          <input className="input" type="text" autoComplete="off" maxLength={100} value={f.password} onChange={(e) => set('password', e.target.value)} />
        </label>
        {f.mode === 'simple' && (
          <label className="field">
            <span>정원 (0이면 제한 없음)</span>
            <input className="input" type="number" min={0} max={100000} value={f.capacity} onChange={(e) => set('capacity', n(e.target.value))} />
          </label>
        )}
        <label className="field">
          <span>안건 제한 시간 (초, 0이면 없음)</span>
          <input className="input" type="number" min={0} max={3600} value={f.seconds} onChange={(e) => set('seconds', n(e.target.value))} />
        </label>
        <label className="field">
          <span>접속이 끊긴 사람을 기다리는 시간 (초)</span>
          <input className="input" type="number" min={3} max={600} value={f.grace} onChange={(e) => set('grace', n(e.target.value))} />
        </label>
      </div>

      {!fixedMode && !f.password && f.mode === 'simple' && <p className="tip">방 비밀번호가 없으면 방 번호를 아는 사람은 누구나 들어올 수 있어요. 모두 들어온 뒤 ‘입장 마감’을 눌러 주세요.</p>}

      <label className="check">
        <input type="checkbox" checked={f.closeAll} onChange={(e) => set('closeAll', e.target.checked)} />
        <span>자리에 있는 사람이 모두 픽하면 바로 마감해요 (접속이 끊긴 사람은 위 시간만큼만 기다려요)</span>
      </label>

      <fieldset className="choice">
        <legend>결과 공개</legend>
        <label className="choice-card">
          <input type="radio" name="live" checked={!f.live} onChange={() => set('live', false)} />
          <span>
            <strong>마감 뒤에 공개 (권장)</strong>픽 받는 중에는 몇 명이 픽했는지만 보여요. 관리자도 마감 전에는 결과를 볼 수 없어요.
          </span>
        </label>
        <label className="choice-card">
          <input type="radio" name="live" checked={f.live} onChange={() => set('live', true)} />
          <span>
            <strong>픽 받는 중에도 실시간 공개</strong>막대가 바로바로 움직여요. 나중에 픽하는 사람이 영향을 받을 수 있고, 사람이 적으면 누가 무엇을 골랐는지 짐작될 수 있어요.
          </span>
        </label>
      </fieldset>

      <Err text={error} />
      <div className="actions">
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel}>
            취소
          </button>
        )}
        <button className="btn btn-primary" disabled={busy}>
          {submitLabel}
        </button>
      </div>
    </form>
  )
}

// ── 방 하나 ───────────────────────────────────────────────
export function RoomPage({ id, defs, onBack, onOpen, backLabel = '목록으로' }: { id: number; defs: Defaults; onBack: () => void; onOpen?: (id: number) => void; backLabel?: string }) {
  const live = useLive(
    () => api<RoomState>(`/api/admin/rooms/${id}`),
    (s) => `/api/events?room=${s.room.code}`,
  )
  const { act, error, busy } = useAct(live.refresh)
  const [adding, setAdding] = useState(false)
  const [blockDays, setBlockDays] = useState(7)
  const [dragged, setDragged] = useState<number | null>(null)
  const [watch, setWatch] = useState('')
  // 화면을 셋으로 나눠요: 진행(지금 누를 것) · 준비(미리 해 둘 것) · 설정(가끔 바꿀 것)
  const [view, setView] = useState<'run' | 'prep' | 'set'>('run')
  const s = live.state
  if (!live.ready) return <Loading />
  if (!s || !s.admin)
    return (
      <>
        <p className="empty">{live.denied ?? '방을 불러오지 못했어요.'}</p>
        <button className="btn" onClick={onBack}>
          {backLabel}
        </button>
      </>
    )
  const a = s.admin
  const hasOpen = s.items.some((i) => i.status === 'open')
  const next = s.items.find((i) => i.status === 'draft')
  const draftIds = s.items.filter((i) => i.status === 'draft').map((i) => i.id)
  // 끌어서 순서 바꾸기: 끌던 안건을 놓은 안건 자리로 옮겨요
  const drop = (onto: number) => {
    if (dragged === null || dragged === onto) return
    const rest = draftIds.filter((x) => x !== dragged)
    rest.splice(rest.indexOf(onto), 0, dragged)
    setDragged(null)
    act(() => api(`/api/admin/rooms/${id}/order`, 'POST', { ids: rest }))
  }
  return (
    <div className="room" data-show={view}>
      <button className="link back" onClick={onBack}>
        <ArrowLeft size={18} aria-hidden="true" />
        {backLabel}
      </button>
      <Offline online={live.online} />

      <section className="room-top">
        <div>
          <h1>{s.room.title}</h1>
          <p className="room-sub">
            {a.archived ? '보관함에 있는 방이에요. ' : ''}
            {a.role === 'cohost' ? '공동 진행자로 들어왔어요. ' : ''}
            {MODE[s.room.mode]} 방식, {s.room.live ? '실시간 공개' : '마감 뒤에 공개'}
            {s.room.closed ? ', 끝난 방' : s.room.locked ? ', 입장 마감됨' : ''}
          </p>
        </div>
        <dl className="facts">
          <div>
            <dt>방 번호</dt>
            <dd className="fact-code">{s.room.code}</dd>
          </div>
          <div>
            <dt>들어온 사람</dt>
            <dd>
              {s.joined}명{a.capacity ? ` / ${a.capacity}` : ''}
            </dd>
          </div>
          <div>
            <dt>지금 접속</dt>
            <dd>{s.present}명</dd>
          </div>
        </dl>
        <div className="seg room-tabs no-print" role="group" aria-label="방 화면 나누기">
          {(
            [
              ['run', '진행'],
              ['prep', '준비'],
              ['set', '설정'],
            ] as const
          ).map(([v, name]) => (
            <button key={v} className="seg-btn" aria-pressed={view === v} onClick={() => setView(v)}>
              {name}
            </button>
          ))}
        </div>
        <div className="actions actions-start">
          <a data-view="run" className="btn btn-primary" href={`/screen/${s.room.code}?k=${a.screenKey}`} target="_blank" rel="noopener">
            <MonitorUp size={18} aria-hidden="true" />큰 화면 열기
          </a>
          {!s.room.closed && (
            <>
              <button data-view="run" className="btn" disabled={busy} onClick={() => act(() => api(`/api/admin/rooms/${id}/lock`, 'POST', { locked: !s.room.locked }))}>
                {s.room.locked ? <DoorOpen size={18} aria-hidden="true" /> : <DoorClosed size={18} aria-hidden="true" />}
                {s.room.locked ? '입장 다시 열기' : '입장 마감'}
              </button>
              {a.role !== 'cohost' && (
                <button data-view="set" className="btn" disabled={busy} onClick={() => confirm('방을 끝낼까요?\n열린 안건은 마감되고, 더는 픽할 수 없어요. 결과는 계속 볼 수 있어요.') && act(() => api(`/api/admin/rooms/${id}/close`, 'POST'))}>
                  방 끝내기
                </button>
              )}
            </>
          )}
          {a.role !== 'cohost' && (
            <button data-view="set" className="btn btn-danger" disabled={busy} onClick={() => confirm('방을 지울까요?\n안건과 결과가 모두 사라져요. 마지막 결과는 ‘기록’에 남아요.') && act(() => api(`/api/admin/rooms/${id}`, 'DELETE')).then((ok) => ok && onBack())}>
              <Trash2 size={18} aria-hidden="true" />방 지우기
            </button>
          )}
          <a data-view="run" className="btn" href={`/remote#room-${id}`}>
            <Smartphone size={18} aria-hidden="true" />
            휴대폰 리모컨
          </a>
          <button
            data-view="prep"
            className="btn"
            onClick={() => {
              const link = `${defs.siteUrl || location.origin}/observe/${s.room.code}?k=${a.observerKey}`
              navigator.clipboard?.writeText(link).catch(() => {})
              setWatch(link)
            }}
          >
            <Eye size={18} aria-hidden="true" />
            참관인 주소
          </button>
          {a.role !== 'cohost' && !a.rehearsalOf && !s.room.closed && (
            <button
              data-view="prep"
              className="btn"
              disabled={busy}
              onClick={() =>
                act(async () => {
                  const made = await api<{ id: number }>(`/api/admin/rooms/${id}/rehearse`, 'POST')
                  if (onOpen) onOpen(made.id)
                  else location.reload() // 방장은 리허설 방으로 옮겨 가요
                })
              }
            >
              <FlaskConical size={18} aria-hidden="true" />
              리허설 해 보기
            </button>
          )}
          {a.role === 'admin' && (
            <button data-view="set" className="btn" disabled={busy} onClick={() => act(async () => onOpen?.((await api<{ id: number }>(`/api/admin/rooms/${id}/clone`, 'POST')).id))}>
              <Copy size={18} aria-hidden="true" />방 복제
            </button>
          )}
          {a.role === 'admin' && s.room.closed && (
            <button data-view="set" className="btn" disabled={busy} onClick={() => act(() => api(`/api/admin/rooms/${id}/archive`, 'POST', { archived: !a.archived }))}>
              <Archive size={18} aria-hidden="true" />
              {a.archived ? '보관함에서 꺼내기' : '보관함으로'}
            </button>
          )}
          {a.role === 'admin' && a.expiresAt && (
            <button data-view="set" className="btn" disabled={busy} onClick={() => act(() => api(`/api/admin/rooms/${id}/keep`, 'POST'))}>
              <Clock size={18} aria-hidden="true" />
              자동 삭제 미루기
            </button>
          )}
          {a.canBlock && (
            <span data-view="set" className="block">
              <select className="input" aria-label="막는 기간" value={blockDays} onChange={(e) => setBlockDays(Number(e.target.value))}>
                <option value={1}>하루 동안</option>
                <option value={7}>7일 동안</option>
                <option value={30}>30일 동안</option>
                <option value={0}>계속</option>
              </select>
              <button className="btn btn-danger" disabled={busy} onClick={() => confirm('이 방을 지우고, 이 방을 만든 곳에서는 방을 만들지 못하게 막을까요?\n학교처럼 여럿이 같은 인터넷 주소를 쓰는 곳이면 모두가 막혀요.') && act(() => api(`/api/admin/rooms/${id}/block`, 'POST', { days: blockDays })).then((ok) => ok && onBack())}>
                <Ban size={18} aria-hidden="true" />
                지우고 만든 곳 막기
              </button>
            </span>
          )}
        </div>
        {watch && (
          <p data-view="prep" className="tip" role="status">
            참관인 주소를 복사했어요. 이 주소를 받은 사람은 진행 상황 · 결과 · 이 방의 기록만 볼 수 있어요: <code className="watch-link">{watch}</code>
          </p>
        )}
        {a.rehearsalOf && (
          <div className="warn rehearsal">
            <p>
              <strong>리허설 방이에요.</strong> 가짜 참여자 10명이 안건이 열리면 알아서 골라요. 진짜 방과 똑같이 눌러 보세요. 통계에 들어가지 않고, 하루 뒤 저절로 지워져요.
            </p>
            {a.role !== 'cohost' && (
              <button
                className="btn"
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    const back = await api<{ id: number | null }>(`/api/admin/rooms/${id}/rehearse`, 'DELETE')
                    if (!onOpen) location.reload()
                    else if (back.id) onOpen(back.id)
                    else onBack()
                  })
                }
              >
                리허설 끝내고 원래 방으로
              </button>
            )}
          </div>
        )}
        {!s.room.closed && (
          <div className="view" data-view="run">
            <ScreenControl roomId={id} mode={s.room.screenMode} notice={s.room.notice} refresh={live.refresh} />
          </div>
        )}
        {a.expiresAt && (
          <p className="tip">
            이 방은 {day(a.expiresAt)}에 안건 · 결과와 함께 자동으로 지워져요. 안건을 열거나 마감하면 그날부터 다시 세요. 필요한 결과는 그 전에 내려받거나 인쇄해 두세요.
          </p>
        )}
        {!s.room.closed && !s.room.locked && s.room.mode === 'simple' && <p data-view="run" className="tip">모두 들어왔으면 ‘입장 마감’을 눌러 주세요. 들어온 사람 수가 실제 인원과 같은지 확인하면 중복 입장을 막을 수 있어요.</p>}
        <Err text={error} />
      </section>

      <section data-view="run" className="card">
        <div className="ad-head">
          <h2>안건</h2>
          {next && !hasOpen && !s.room.closed && (
            <button className="btn btn-primary" disabled={busy} onClick={() => confirm(`다음 안건 ‘${next.title}’ 픽을 열까요?\n열면 안건을 고치거나 지울 수 없어요.`) && act(() => api(`/api/admin/items/${next.id}/open`, 'POST'))}>
              <SkipForward size={18} aria-hidden="true" />
              다음 안건 열기
            </button>
          )}
          <div className="actions">
            {s.items.some((i) => i.status === 'closed') && (
              <>
                <a className="btn" href={`/api/admin/rooms/${id}/results.csv`} download>
                  <Download size={18} aria-hidden="true" />
                  결과 내려받기
                </a>
                <button className="btn" onClick={() => printAs('results')}>
                  <Printer size={18} aria-hidden="true" />
                  결과 인쇄
                </button>
                <button className="btn" onClick={() => printAs('minutes')}>
                  <Printer size={18} aria-hidden="true" />
                  회의록 인쇄
                </button>
              </>
            )}
            {!adding && !s.room.closed && (
              <button className="btn" onClick={() => setAdding(true)}>
                <Plus size={18} aria-hidden="true" />
                안건 더하기
              </button>
            )}
          </div>
        </div>
        {s.items.length === 0 && !adding && <p className="empty">안건을 더하고 ‘픽 열기’를 누르면 바로 시작돼요. 안건은 한 번에 하나씩 열려요.</p>}
        <ol className="items">
          {s.items.map((it) => (
            <ItemCard key={it.id} item={it} state={s} canOpen={!hasOpen && !s.room.closed} refresh={live.refresh} drag={draftIds.length > 1 && it.status === 'draft' ? { start: () => setDragged(it.id), drop: () => drop(it.id), on: dragged === it.id } : undefined} />
          ))}
        </ol>
        {adding && (
          <ItemForm
            roomSeconds={a.seconds}
            submitLabel="안건 더하기"
            onCancel={() => setAdding(false)}
            onSubmit={async (f) => {
              await api(`/api/admin/rooms/${id}/items`, 'POST', f)
              setAdding(false)
              await live.refresh()
            }}
          />
        )}
      </section>

      <Minutes s={s} />
      <div className="view" data-view="prep">
        {!s.room.closed && <Templates roomId={id} items={s.items} server={a.role === 'admin'} refresh={live.refresh} />}

      {s.room.mode === 'strict' && <Codes roomId={id} room={s.room.code} total={a.codes.total} used={a.codes.used} siteUrl={defs.siteUrl} refresh={live.refresh} />}
        {s.room.closed && s.room.mode !== 'strict' && <p className="empty">끝난 방이라 준비할 것이 없어요.</p>}
      </div>
      <div className="view" data-view="set">

      {!s.room.closed && a.role !== 'cohost' && <Cohost roomId={id} has={a.cohost} refresh={live.refresh} />}
      {a.role !== 'cohost' && <RoomLook roomId={id} tone={s.room.tone} hasLogo={a.hasLogo} refresh={live.refresh} />}

      {!s.room.closed && a.role !== 'cohost' && (
        <details className="card">
          <summary>방 설정 바꾸기</summary>
          <RoomForm
            defs={defs}
            fixedMode
            initial={{ title: s.room.title, mode: s.room.mode, capacity: a.capacity, seconds: a.seconds, grace: a.grace, closeAll: a.closeAll, live: s.room.live }}
            submitLabel="설정 저장"
            onSubmit={async (f) => {
              await api(`/api/admin/rooms/${id}`, 'PUT', f)
              await live.refresh()
            }}
          />
        </details>
      )}
      </div>
    </div>
  )
}

function ItemCard({ item, state, canOpen, refresh, drag }: { item: Item; state: Live; canOpen: boolean; refresh: () => unknown; drag?: { start: () => void; drop: () => void; on: boolean } }) {
  const { act, error, busy } = useAct(refresh)
  const [editing, setEditing] = useState(false)
  const [at, setAt] = useState('')
  const [until, setUntil] = useState('')
  const schedule = (plan: { at?: number | null; closeAt?: number | null }) => act(() => api(`/api/admin/items/${item.id}/schedule`, 'POST', plan))
  const call = (path: string, method = 'POST') => act(() => api(`/api/admin/items/${item.id}${path}`, method))
  const top = Math.max(0, ...item.options.map((o) => o.votes ?? 0))
  const tied = item.status === 'closed' && top > 0 && item.options.filter((o) => o.votes === top).length > 1

  if (editing)
    return (
      <li className="item">
        <ItemForm
          roomSeconds={item.seconds}
          initial={{ title: item.title, note: item.note, options: item.options.map((o) => o.label), maxPick: item.maxPick, seconds: item.seconds, rule: item.rule, practice: item.practice, quorum: item.quorum, basis: item.basis, shuffle: item.shuffle }}
          submitLabel="안건 저장"
          onCancel={() => setEditing(false)}
          onSubmit={async (f) => {
            await api(`/api/admin/items/${item.id}`, 'PUT', f)
            setEditing(false)
            await refresh()
          }}
        />
      </li>
    )

  return (
    <li
      className={`item item-${item.status}${drag?.on ? ' item-dragging' : ''}`}
      draggable={!!drag}
      onDragStart={drag?.start}
      onDragOver={drag ? (e) => e.preventDefault() : undefined}
      onDrop={drag?.drop}
    >
      <div className="item-head">
        {drag && <GripVertical className="grip" size={18} aria-label="끌어서 순서 바꾸기" />}
        <span className={`chip chip-${item.status}`}>{{ draft: '준비', open: '픽 받는 중', closed: '마감' }[item.status]}</span>
        <h3>
          <Practice item={item} />
          {item.title}
        </h3>
      </div>
      {item.note && <p className="item-note">{item.note}</p>}

      {item.status === 'draft' && (
        <>
          <p className="item-opts">{item.options.map((o) => o.label).join(' / ')}</p>
          <p className="item-meta">
            {item.maxPick === 1 ? '하나만 고르기' : `${item.maxPick}개까지 고르기`}, {item.seconds ? `제한 시간 ${item.seconds}초` : '제한 시간 없음'}
            {item.rule !== 'none' && `, ‘${item.options[0]?.label}’ ${item.rule === 'majority' ? '과반' : '3분의 2 이상'}이면 가결 (${BASIS[item.basis]} 기준)`}
            {item.quorum > 0 && `, 정족수 ${item.quorum}명`}
            {item.shuffle && ', 선택지 순서 섞기'}
          </p>
          <div className="actions actions-start">
            <button className="btn btn-primary" disabled={busy || !canOpen} onClick={() => confirm(`‘${item.title}’ 픽을 열까요?\n열면 안건을 고치거나 지울 수 없어요.`) && call('/open')}>
              <Play size={18} aria-hidden="true" />
              픽 열기
            </button>
            <button className="btn" disabled={busy} onClick={() => setEditing(true)}>
              <Pencil size={18} aria-hidden="true" />
              고치기
            </button>
            <button className="btn" disabled={busy} onClick={() => confirm('이 안건을 지울까요?') && call('', 'DELETE')}>
              <Trash2 size={18} aria-hidden="true" />
              지우기
            </button>
            <button className="btn btn-icon" disabled={busy} aria-label="순서 위로" onClick={() => act(() => api(`/api/admin/items/${item.id}/move`, 'POST', { dir: 'up' }))}>
              <ArrowUp size={18} aria-hidden="true" />
            </button>
            <button className="btn btn-icon" disabled={busy} aria-label="순서 아래로" onClick={() => act(() => api(`/api/admin/items/${item.id}/move`, 'POST', { dir: 'down' }))}>
              <ArrowDown size={18} aria-hidden="true" />
            </button>
          </div>
          {(item.openAt || item.closeAt) && (
            <p className="sched">
              <Clock size={18} aria-hidden="true" />
              <span>
                {item.openAt ? `${when(item.openAt)}에 저절로 열려요.` : '직접 열어요.'} {item.closeAt ? `${when(item.closeAt)}에 저절로 마감돼요.` : ''}
              </span>
              <button className="link" disabled={busy} onClick={() => schedule({ at: null, closeAt: null })}>
                예약 취소
              </button>
            </p>
          )}
          {!state.room.closed && (
            <details className="sched-form">
              <summary>예약 (정한 때에 저절로 열고 마감하기)</summary>
              <div className="sched">
                <label className="field field-inline">
                  <span>예약 열기</span>
                  <input className="input" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
                </label>
                <label className="field field-inline">
                  <span>예약 마감</span>
                  <input className="input" type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} />
                </label>
                <button className="btn btn-small" disabled={busy || (!at && !until)} onClick={() => schedule({ ...(at ? { at: new Date(at).getTime() } : {}), ...(until ? { closeAt: new Date(until).getTime() } : {}) })}>
                  예약하기
                </button>
              </div>
              <p className="tip">둘 중 하나만 정해도 돼요. 마감 때를 정하면 제한 시간과 상관없이 그때까지 열어 두고, 모두 픽해도 일찍 닫지 않아요. 며칠에 걸친 픽에 쓰세요. 7일 넘게 열어 둘 때는 ‘엄격’ 방식 방이 안전해요.</p>
            </details>
          )}
        </>
      )}

      {item.status === 'open' && (
        <>
          <TimeLeft item={item} skew={state.skew} />
          <p className="item-live">
            <strong>{item.voted}명</strong> 픽 상자 (지금 접속 {state.present}명)
          </p>
          {item.revealed ? <Result item={item} /> : <p className="tip">결과는 마감 뒤에 공개돼요. 지금은 관리자도 볼 수 없어요.</p>}
          <div className="actions actions-start">
            <button className="btn btn-primary" disabled={busy} onClick={() => confirm('지금 마감할까요?\n아직 픽하지 않은 사람은 픽할 수 없게 돼요.') && call('/close')}>
              <Square size={18} aria-hidden="true" />
              지금 마감
            </button>
            {item.closesAt && (
              <button className="btn" disabled={busy} onClick={() => act(() => api(`/api/admin/items/${item.id}/extend`, 'POST', { seconds: 30 }))}>
                <Plus size={18} aria-hidden="true" />
                30초 더
              </button>
            )}
            <button className="btn" disabled={busy} title="아직 픽하지 않은 사람의 화면에만 알림이 떠요" onClick={() => call('/nudge')}>
              <BellRing size={18} aria-hidden="true" />
              안 한 사람에게 알리기
            </button>
          </div>
        </>
      )}

      {item.status === 'closed' && (
        <>
          <Result item={item} />
          {!!item.objectionNotes?.length && (
            <div className="objections">
              <strong>이의 {item.objectionNotes.length}건</strong>
              <ul>
                {item.objectionNotes.map((o, i) => (
                  <li key={i}>
                    {o.note} <time dateTime={new Date(o.at).toISOString()}>{when(o.at)}</time>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!state.room.closed && (
            <div className="actions actions-start">
              <button className="btn" disabled={busy} onClick={() => call('/copy')}>
                <Copy size={18} aria-hidden="true" />
                복사해서 다시 픽
              </button>
              {tied && (
                <button className="btn btn-primary" disabled={busy} onClick={() => call('/runoff')}>
                  <Scale size={18} aria-hidden="true" />
                  동점인 선택지로 결선 만들기
                </button>
              )}
            </div>
          )}
        </>
      )}
      <Memo item={item} />
      <Err text={error} />
    </li>
  )
}

/** 진행자 메모: 진행자만 보는 한마디. 칸을 벗어나면 저절로 저장돼요. */
function Memo({ item }: { item: Item }) {
  const [text, setText] = useState(item.memo ?? '')
  const [saved, setSaved] = useState(false)
  const save = () => {
    if (text === (item.memo ?? '')) return
    api(`/api/admin/items/${item.id}/memo`, 'POST', { memo: text }).then(() => setSaved(true), () => {})
  }
  return (
    <details className="memo no-print" open={!!item.memo}>
      <summary>진행자 메모 {saved && <span role="status">저장했어요</span>}</summary>
      <textarea className="input" rows={2} maxLength={1000} placeholder="진행할 때 볼 메모 (참여자에게는 안 보여요)" aria-label="진행자 메모" value={text} onChange={(e) => (setText(e.target.value), setSaved(false))} onBlur={save} />
    </details>
  )
}

type ItemInput = { title: string; note: string; options: string[]; maxPick: number; seconds: number; rule: Item['rule']; practice: boolean; quorum?: number; basis?: Item['basis']; shuffle?: boolean }
function ItemForm({ initial, roomSeconds, submitLabel, onSubmit, onCancel }: { initial?: ItemInput; roomSeconds: number; submitLabel: string; onSubmit: (f: ItemInput) => Promise<unknown>; onCancel: () => void }) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [note, setNote] = useState(initial?.note ?? '')
  const [options, setOptions] = useState((initial?.options ?? ['찬성', '반대']).join('\n'))
  const [maxPick, setMaxPick] = useState(initial?.maxPick ?? 1)
  const [seconds, setSeconds] = useState(initial?.seconds ?? roomSeconds)
  const [rule, setRule] = useState<Item['rule']>(initial?.rule ?? 'none')
  const [practice, setPractice] = useState(initial?.practice ?? false)
  const [quorum, setQuorum] = useState(initial?.quorum ?? 0)
  const [basis, setBasis] = useState<Item['basis']>(initial?.basis ?? 'voted')
  const [shuffle, setShuffle] = useState(initial?.shuffle ?? false)
  const { act, error, busy } = useAct()
  // 자주 쓰는 모양을 한 번에 채워요
  const fill = (o: string, r: Item['rule'], t?: string) => {
    setOptions(o)
    setRule(r)
    setMaxPick(1)
    setPractice(!!t)
    if (t) setTitle(t)
  }
  const list = options.split('\n').map((s) => s.trim()).filter(Boolean)
  return (
    <form
      className="form form-inset"
      onSubmit={(e) => {
        e.preventDefault()
        act(() => onSubmit({ title, note, options: list, maxPick: Math.min(maxPick, Math.max(1, list.length)), seconds, rule: maxPick === 1 ? rule : 'none', practice, quorum, shuffle, basis: maxPick === 1 && rule !== 'none' ? basis : 'voted' }))
      }}
    >
      <div className="presets">
        <span>빠른 틀</span>
        <button type="button" className="btn btn-small" onClick={() => fill('찬성\n반대', 'none')}>
          찬성 / 반대
        </button>
        <button type="button" className="btn btn-small" onClick={() => fill('찬성\n반대', 'majority')}>
          찬성 / 반대 (과반이면 가결)
        </button>
        <button type="button" className="btn btn-small" onClick={() => fill('잘 보여요\n잘 안 보여요', 'none', '연습 픽: 화면이 잘 보이나요?')}>
          연습 픽
        </button>
      </div>
      <label className="field">
        <span>안건 제목</span>
        <input className="input" maxLength={100} placeholder="예: 축제 주제를 골라 주세요" value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
      </label>
      <label className="field">
        <span>설명 (없어도 돼요)</span>
        <input className="input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <label className="field">
        <span>선택지 (한 줄에 하나씩, 지금 {list.length}개)</span>
        <textarea className="input" rows={Math.max(3, list.length + 1)} value={options} onChange={(e) => setOptions(e.target.value)} />
      </label>
      <div className="grid2">
        <label className="field">
          <span>한 사람이 고를 수 있는 개수</span>
          <input className="input" type="number" min={1} max={Math.max(1, list.length)} value={maxPick} onChange={(e) => setMaxPick(Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
        </label>
        <label className="field">
          <span>제한 시간 (초, 0이면 없음)</span>
          <input className="input" type="number" min={0} max={3600} value={seconds} onChange={(e) => setSeconds(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
        </label>
      </div>
      <label className="field">
        <span>가결 기준 (하나만 고르는 안건에서, 첫 번째 선택지를 찬성으로 봐요)</span>
        <select className="input" value={maxPick === 1 ? rule : 'none'} disabled={maxPick !== 1} onChange={(e) => setRule(e.target.value as Item['rule'])}>
          <option value="none">판정하지 않기 (받은 픽만 보여 주기)</option>
          <option value="majority">픽한 사람의 과반이면 가결</option>
          <option value="two_thirds">픽한 사람의 3분의 2 이상이면 가결</option>
        </select>
      </label>
      <div className="grid2">
        <label className="field">
          <span>가결을 따질 모수</span>
          <select className="input" value={basis} disabled={maxPick !== 1 || rule === 'none'} onChange={(e) => setBasis(e.target.value as Item['basis'])}>
            <option value="voted">픽한 사람 (기권 포함)</option>
            <option value="valid">기권을 뺀 사람</option>
            <option value="joined">들어온 사람 전체</option>
          </select>
        </label>
        <label className="field">
          <span>정족수 (이만큼 들어와야 열 수 있어요, 0이면 없음)</span>
          <input className="input" type="number" min={0} max={100000} value={quorum} onChange={(e) => setQuorum(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
        </label>
      </div>
      <label className="check">
        <input type="checkbox" checked={shuffle} onChange={(e) => setShuffle(e.target.checked)} />
        <span>선택지 순서를 사람마다 섞어요 (맨 위 선택지가 유리해지지 않게. 결과는 적은 순서대로 나와요)</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={practice} onChange={(e) => setPractice(e.target.checked)} />
        <span>연습 픽이에요 (‘연습’ 표시가 붙고, 결과에도 연습으로 적혀요)</span>
      </label>
      <Err text={error} />
      <div className="actions">
        <button type="button" className="btn" onClick={onCancel}>
          취소
        </button>
        <button className="btn btn-primary" disabled={busy}>
          {submitLabel}
        </button>
      </div>
    </form>
  )
}

// ── 안건 묶음: 자주 쓰는 안건을 이름 붙여 저장해 두고 다른 방에서 불러와요 ──
// 관리자는 서버에 저장해 어느 기기에서나 같이 쓰고, 방장(계정이 없어요)은 이 브라우저에 저장하고 파일로 옮겨요.
type Bundle = { id?: number; name: string; items: ItemInput[] }
const BUNDLES = 'mypick-bundles'
const readBundles = (): Bundle[] => {
  try {
    const v = JSON.parse(localStorage.getItem(BUNDLES) ?? '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}
function Templates({ roomId, items, server, refresh }: { roomId: number; items: Item[]; server: boolean; refresh: () => unknown }) {
  const [list, setList] = useState<Bundle[]>(server ? [] : readBundles)
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const { act, error, busy } = useAct()
  const reload = () => api<{ bundles: Bundle[] }>('/api/admin/bundles').then((d) => setList(d.bundles))
  useEffect(() => {
    if (server) reload().catch(() => {})
  }, [server])
  const keepLocal = (next: Bundle[]) => {
    setList(next)
    try {
      localStorage.setItem(BUNDLES, JSON.stringify(next))
    } catch {
      setNote('이 브라우저에는 저장할 수 없어요.')
    }
  }
  const save = () => {
    const title = name.trim()
    if (!title || !items.length) return
    const bundle = { name: title, items: items.map((i) => ({ title: i.title, note: i.note, options: i.options.map((o) => o.label), maxPick: i.maxPick, seconds: i.seconds, rule: i.rule, practice: i.practice, quorum: i.quorum, basis: i.basis, shuffle: i.shuffle })) }
    const done = () => {
      setName('')
      setNote(`‘${title}’ 묶음에 안건 ${items.length}개를 저장했어요.`)
    }
    if (server) act(() => api('/api/admin/bundles', 'POST', bundle).then(reload)).then((ok) => ok && done())
    else {
      keepLocal([bundle, ...list.filter((b) => b.name !== title)].slice(0, 30))
      done()
    }
  }
  const remove = (b: Bundle) => (server ? act(() => api(`/api/admin/bundles/${b.id}`, 'DELETE').then(reload)) : keepLocal(list.filter((x) => x !== b)))
  const load = (b: Bundle) =>
    act(async () => {
      for (const it of b.items) await api(`/api/admin/rooms/${roomId}/items`, 'POST', it)
      await refresh()
      setNote(`‘${b.name}’ 묶음의 안건 ${b.items.length}개를 더했어요.`)
    })
  // 파일로 옮기기 (방장: 다른 기기에서 쓰거나 다른 사람에게 줄 때)
  const exportFile = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' }))
    a.download = 'mypick-안건묶음.json'
    a.click()
    URL.revokeObjectURL(a.href)
  }
  const importFile = async (file: File) => {
    try {
      const got = JSON.parse(await file.text())
      const good = (Array.isArray(got) ? got : []).filter((b) => typeof b?.name === 'string' && Array.isArray(b.items) && b.items.every((i: ItemInput) => typeof i?.title === 'string' && Array.isArray(i.options)))
      if (!good.length) throw new Error()
      keepLocal([...good, ...list.filter((b) => !good.some((g: Bundle) => g.name === b.name))].slice(0, 30))
      setNote(`묶음 ${good.length}개를 가져왔어요.`)
    } catch {
      setNote('안건 묶음 파일이 아니에요.')
    }
  }
  return (
    <details className="card no-print">
      <summary>안건 묶음 (자주 쓰는 안건 저장 · 불러오기)</summary>
      <p className="tip">{server ? '매번 같은 안건으로 회의한다면 묶음으로 저장해 두세요. 서버에 저장돼서 어느 기기에서나, 다른 관리자도 불러올 수 있어요.' : '매번 같은 안건으로 회의한다면 묶음으로 저장해 두세요. 이 브라우저에 저장돼요. 다른 기기에서 쓰려면 파일로 내보냈다가 가져오세요.'}</p>
      {list.length > 0 && (
        <ul className="bundles">
          {list.map((b) => (
            <li key={b.name}>
              <span>
                <strong>{b.name}</strong> 안건 {b.items.length}개
              </span>
              <button className="btn btn-small" disabled={busy} onClick={() => load(b)}>
                <Plus size={16} aria-hidden="true" />
                불러오기
              </button>
              <button className="btn btn-small" aria-label={`${b.name} 묶음 지우기`} onClick={() => confirm(`‘${b.name}’ 묶음을 지울까요?`) && remove(b)}>
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="actions actions-start">
        <label className="field field-inline">
          <span>묶음 이름</span>
          <input className="input" maxLength={40} placeholder="예: 정기 회의" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <button className="btn" disabled={busy || !name.trim() || !items.length} onClick={save}>
          지금 안건 {items.length}개를 묶음으로 저장
        </button>
      </div>
      {!server && (
        <div className="actions actions-start">
          {list.length > 0 && (
            <button className="btn btn-small" onClick={exportFile}>
              <Download size={16} aria-hidden="true" />
              파일로 내보내기
            </button>
          )}
          <label className="btn btn-small">
            파일에서 가져오기
            <input
              className="sr"
              type="file"
              accept="application/json,.json"
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) importFile(file)
              }}
            />
          </label>
        </div>
      )}
      {note && <p role="status">{note}</p>}
      <Err text={error} />
    </details>
  )
}

// ── 회의록: 화면에는 안 보이고 ‘회의록 인쇄’를 누르면 이것만 종이에 나와요 ──
function Minutes({ s }: { s: Live }) {
  const closed = s.items.filter((i) => i.status === 'closed' && !i.practice)
  if (!closed.length) return null
  const when = (t: number | null) => (t ? new Date(t).toLocaleString('ko-KR', { dateStyle: 'long', timeStyle: 'short' }) : '')
  return (
    <section className="minutes">
      <h1>{s.room.title} My Pick 결과 회의록</h1>
      <dl>
        <div>
          <dt>주관</dt>
          <dd>{s.org.name}</dd>
        </div>
        <div>
          <dt>일시</dt>
          <dd>
            {when(closed[0].openedAt)} ~ {when(closed.at(-1)!.closedAt)}
          </dd>
        </div>
        <div>
          <dt>참여</dt>
          <dd>
            {s.joined}명 (방 번호 {s.room.code}, {MODE[s.room.mode]} 방식 입장)
          </dd>
        </div>
        <div>
          <dt>방식</dt>
          <dd>익명 My Pick, {s.room.live ? '픽 받는 중 실시간 공개' : '마감 뒤 결과 공개'}</dd>
        </div>
      </dl>
      <ol>
        {closed.map((it, n) => (
          <li key={it.id}>
            <h2>
              제{n + 1}호 안건. {it.title}
            </h2>
            {it.note && <p>{it.note}</p>}
            <table>
              <thead>
                <tr>
                  <th scope="col">선택지</th>
                  <th scope="col">받은 픽</th>
                  <th scope="col">비율</th>
                </tr>
              </thead>
              <tbody>
                {it.options.map((o) => (
                  <tr key={o.id}>
                    <td>{o.label}</td>
                    <td>{o.votes}명</td>
                    <td>{it.voted ? Math.round(((o.votes ?? 0) / it.voted) * 100) : 0}%</td>
                  </tr>
                ))}
                <tr>
                  <td>기권</td>
                  <td>{it.abstain}명</td>
                  <td>{it.voted ? Math.round(((it.abstain ?? 0) / it.voted) * 100) : 0}%</td>
                </tr>
              </tbody>
            </table>
            <p>
              들어온 {it.eligible}명 중 {it.voted}명 픽. {when(it.closedAt)} 마감 ({it.reason}).
              {it.outcome && (
                <strong>
                  {' '}
                  판정: {it.outcome === 'pass' ? '가결' : '부결'} (‘{it.options[0]?.label}’이 {BASIS[it.basis]}의 {it.rule === 'majority' ? '과반' : '3분의 2 이상'}이면 가결)
                </strong>
              )}
            </p>
            <p>
              결과 확인 코드: {it.proof}
              {it.objections > 0 && ` · 마감 뒤 접수된 이의 ${it.objections}건`}
            </p>
          </li>
        ))}
      </ol>
      <p>이 픽은 익명 My Pick로 진행되어, 누가 무엇을 골랐는지는 기록되지 않았습니다. 결과 확인 코드는 마감한 순간의 결과로 만든 것이며, 누구나 결과 확인 화면에서 결과가 바뀌지 않았는지 확인할 수 있습니다.</p>
      <div className="minutes-sign">
        <span>진행자 (서명)</span>
        <span>확인자 (서명)</span>
      </div>
    </section>
  )
}

// ── 입장 코드 (엄격 방식) ─────────────────────────────────
function Codes({ roomId, room, total, used, siteUrl, refresh }: { roomId: number; room: string; total: number; used: number; siteUrl: string; refresh: () => unknown }) {
  const [count, setCount] = useState(10)
  const [codes, setCodes] = useState<{ code: string; used: boolean }[] | null>(null)
  const [shownCodes, setShownCodes] = useState(60) // 화면에는 60개씩 (인쇄할 때는 모두 펼쳐요)
  const show = () => api<{ codes: { code: string; used: boolean }[] }>(`/api/admin/rooms/${roomId}/codes`).then((d) => setCodes(d.codes))
  const { act, error, busy } = useAct(async () => {
    await refresh()
    await show()
  })
  const address = (siteUrl || location.origin).replace(/^https?:\/\//, '')
  return (
    <section className="card">
      <h2>입장 코드</h2>
      <p className="tip">
        한 사람에게 하나씩 나눠 주세요. QR 을 찍으면 방 번호와 코드가 채워진 채로 바로 들어와요. 지금 {total}개 중 {used}개를 썼어요. 같은 코드로 다시 들어오면 앞에 쓰던 기기는 끊기고, 픽은 한 번만 돼요.
      </p>
      <div className="actions actions-start no-print">
        <label className="field field-inline">
          <span>만들 개수</span>
          <input className="input input-short" type="number" min={1} max={500} value={count} onChange={(e) => setCount(Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
        </label>
        <button className="btn btn-primary" disabled={busy} onClick={() => act(() => api(`/api/admin/rooms/${roomId}/codes`, 'POST', { count }))}>
          <Plus size={18} aria-hidden="true" />
          코드 만들기
        </button>
        {total > 0 && !codes && (
          <button className="btn" onClick={() => act(show)}>
            코드 보기
          </button>
        )}
        {codes && (
          <button
            className="btn"
            onClick={() => {
              setShownCodes(Infinity)
              setTimeout(() => printAs('codes'), 50)
            }}
          >
            <Printer size={18} aria-hidden="true" />
            인쇄하기
          </button>
        )}
      </div>
      <Err text={error} />
      {codes && (
        <ul className="codes print-area">
          {codes.slice(0, shownCodes).map((c) => (
            <li key={c.code} className={c.used ? 'code-used' : ''}>
              {!c.used && <Qr text={`${siteUrl || location.origin}/?room=${room}&code=${c.code}`} label="이 코드로 바로 들어가는 QR" />}
              <span className="code-where">
                {address} 방 번호 {room}
              </span>
              <strong>{fmtCode(c.code)}</strong>
              {c.used && <span className="code-mark">사용함</span>}
            </li>
          ))}
        </ul>
      )}
      {codes && codes.length > shownCodes && (
        <button className="btn no-print" onClick={() => setShownCodes(shownCodes + 120)}>
          더 보기 ({codes.length - shownCodes}개 남음)
        </button>
      )}
    </section>
  )
}

// ── 기관 설정 (이름 · 로고) ───────────────────────────────
function OrgTab({ org, setOrg, defs, top }: { org: Org | null; setOrg: (o: Org) => void; defs: Defaults; top: boolean }) {
  const [name, setName] = useState(org?.name ?? '')
  const [saved, setSaved] = useState(false)
  const { act, error, busy } = useAct()
  useEffect(() => setName(org?.name ?? ''), [org?.name])
  return (
    <>
      <div className="ad-head">
        <h1>설정</h1>
      </div>
      <section className="card">
        <h2>기관 이름</h2>
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault()
            act(async () => setOrg(await api<Org>('/api/admin/org', 'PUT', { name }))).then(setSaved)
          }}
        >
          <label className="field">
            <span>모든 화면 맨 위에 나와요</span>
            <input className="input" maxLength={40} value={name} onChange={(e) => (setName(e.target.value), setSaved(false))} required />
          </label>
          <div className="actions actions-start">
            <button className="btn btn-primary" disabled={busy}>
              이름 저장
            </button>
            {saved && <span role="status">저장했어요.</span>}
          </div>
        </form>
      </section>
      <section className="card">
        <h2>기관 로고</h2>
        <p className="tip">
          PNG, JPG, WebP 사진을 {defs.maxLogoMb}MB 까지 올릴 수 있어요. 픽 화면, 큰 화면, 관리자 화면 맨 위에 나와요.
        </p>
        <div className="logo-row">
          <div className="logo-preview">{org?.logo ? <img src={org.logo} alt="지금 로고" /> : <span>로고 없음</span>}</div>
          <div className="actions actions-start">
            <label className="btn btn-primary">
              사진 고르기
              <input
                className="sr"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (file) act(async () => setOrg(await api<Org>('/api/admin/logo', 'POST', await shrink(file))))
                }}
              />
            </label>
            {org?.logo && (
              <button className="btn" disabled={busy} onClick={() => act(async () => setOrg(await api<Org>('/api/admin/logo', 'DELETE')))}>
                로고 지우기
              </button>
            )}
          </div>
        </div>
        <Err text={error} />
      </section>
      <MyPassword top={top} />
      <Backups top={top} />
    </>
  )
}

// ── 공동 진행자 ───────────────────────────────────────────
function Cohost({ roomId, has, refresh }: { roomId: number; has: boolean; refresh: () => unknown }) {
  const [password, setPassword] = useState('')
  const [note, setNote] = useState('')
  const { act, error, busy } = useAct(refresh)
  const set = (pw: string | null) =>
    act(() => api(`/api/admin/rooms/${roomId}/cohost`, 'POST', { password: pw })).then((ok) => {
      if (!ok) return
      setPassword('')
      setNote(pw ? '공동 진행자 비밀번호를 정했어요. 방 번호와 함께 알려 주세요.' : '공동 진행자를 없앴어요. 들어와 있던 공동 진행자는 바로 끊겨요.')
    })
  return (
    <details className="card no-print">
      <summary>공동 진행자 {has ? '(있음)' : ''}</summary>
      <p className="tip">
        진행을 도울 사람에게 따로 비밀번호를 줄 수 있어요. ‘내가 만든 방 진행하기’에서 방 번호와 이 비밀번호로 들어와요. 안건을 더하고 열고 마감할 수 있지만, 방 지우기 · 끝내기 · 설정 바꾸기는 할 수 없어요.
      </p>
      <div className="actions actions-start">
        <label className="field field-inline">
          <span>공동 진행자 비밀번호 (6자 이상)</span>
          <input className="input" type="text" autoComplete="off" maxLength={100} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button className="btn" disabled={busy || password.length < 6} onClick={() => set(password)}>
          {has ? '비밀번호 바꾸기' : '공동 진행자 두기'}
        </button>
        {has && (
          <button className="btn" disabled={busy} onClick={() => set(null)}>
            공동 진행자 없애기
          </button>
        )}
      </div>
      {note && <p role="status">{note}</p>}
      <Err text={error} />
    </details>
  )
}

// ── 신고 · 금칙어 · 막은 곳 ───────────────────────────────
type Report = { id: number; roomId: number | null; roomCode: string; roomTitle: string; reason: string; note: string; at: number; handled: boolean }
type ReportData = { open: number; reports: Report[]; banned: string; blocks: { creator: string; at: number; why: string; until: number | null }[] }
function ReportsTab({ onOpen, onChange }: { onOpen: (id: number) => void; onChange: () => void }) {
  const [data, setData] = useState<ReportData | null>(null)
  const [banned, setBanned] = useState('')
  const [saved, setSaved] = useState(false)
  const load = () =>
    api<ReportData>('/api/admin/reports').then((d) => {
      setData(d)
      onChange()
    })
  const { act, error, busy } = useAct(load)
  useEffect(() => {
    api<ReportData>('/api/admin/reports').then((d) => {
      setData(d)
      setBanned(d.banned)
    }, () => {})
  }, [])
  if (!data) return null
  return (
    <>
      <div className="ad-head">
        <h1>신고</h1>
      </div>
      <section className="card">
        <h2>들어온 신고 {data.open ? `(확인할 것 ${data.open}개)` : ''}</h2>
        {data.reports.length === 0 && <p className="empty">아직 신고가 없어요. 참여자가 픽 화면의 ‘이 방 신고하기’로 보내면 여기에 모여요.</p>}
        <ul className="reports">
          {data.reports.map((r) => (
            <li key={r.id} className={r.handled ? 'report-done' : ''}>
              <div>
                <strong>{r.reason}</strong>
                <span>
                  {r.roomTitle} (방 번호 {r.roomCode}){r.roomId ? '' : ', 지워진 방'}
                </span>
                {r.note && <p>{r.note}</p>}
                <time dateTime={new Date(r.at).toISOString()}>{when(r.at)}</time>
              </div>
              <div className="actions">
                {r.roomId && (
                  <button className="btn btn-small" onClick={() => onOpen(r.roomId!)}>
                    방 열어 보기
                  </button>
                )}
                {!r.handled && (
                  <button className="btn btn-small" disabled={busy} onClick={() => act(() => api(`/api/admin/reports/${r.id}/handle`, 'POST'))}>
                    확인했어요
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section className="card">
        <h2>금칙어</h2>
        <p className="tip">누구나 만드는 방(방장이 만든 방)의 방 이름 · 안건 · 선택지에 이 말이 들어 있으면 저장되지 않아요. 한 줄에 하나씩, 두 글자 이상. 띄어쓰기와 사이에 넣은 기호(바.보 · 바~보)는 빼고 견줘요.</p>
        <textarea className="input" rows={5} value={banned} onChange={(e) => (setBanned(e.target.value), setSaved(false))} aria-label="금칙어 목록" />
        <div className="actions actions-start">
          <button className="btn btn-primary" disabled={busy} onClick={() => act(() => api('/api/admin/banned', 'PUT', { words: banned })).then(setSaved)}>
            금칙어 저장
          </button>
          {saved && <span role="status">저장했어요.</span>}
        </div>
      </section>
      <section className="card">
        <h2>방 만들기를 막은 곳</h2>
        <p className="tip">문제 방을 열어 ‘지우고 만든 곳 막기’를 누르면 여기에 더해져요. 접속 주소는 알아볼 수 없게 바꿔 보관하고, 정한 기간이 지나면 저절로 풀려요.</p>
        {data.blocks.length === 0 && <p className="empty">막은 곳이 없어요.</p>}
        <ul className="reports">
          {data.blocks.map((b) => (
            <li key={b.creator}>
              <div>
                <strong>{b.why}</strong>
                <time dateTime={new Date(b.at).toISOString()}>
                  {when(b.at)}에 막음, {b.until ? `${when(b.until)}에 저절로 풀려요` : '풀 때까지 계속'}
                </time>
              </div>
              <button className="btn btn-small" disabled={busy} onClick={() => act(() => api(`/api/admin/blocks/${b.creator}`, 'DELETE'))}>
                풀기
              </button>
            </li>
          ))}
        </ul>
      </section>
      <Err text={error} />
    </>
  )
}

// ── 관리자 여러 명 (최고 관리자만) ────────────────────────
type AdminRow = { id: number; name: string; createdAt: number }
function AdminsTab() {
  const [data, setData] = useState<{ top: string; admins: AdminRow[] } | null>(null)
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const load = () => api<{ top: string; admins: AdminRow[] }>('/api/admin/admins').then(setData)
  const { act, error, busy } = useAct(load)
  useEffect(() => {
    load().catch(() => {})
  }, [])
  if (!data) return null
  return (
    <>
      <div className="ad-head">
        <h1>관리자</h1>
      </div>
      <section className="card">
        <h2>관리자 목록</h2>
        <ul className="reports">
          <li>
            <div>
              <strong>{data.top}</strong>
              <span>최고 관리자 (.env 에서 정해요. 관리자를 더하고 뺄 수 있어요)</span>
            </div>
          </li>
          {data.admins.map((a) => (
            <li key={a.id}>
              <div>
                <strong>{a.name}</strong>
                <time dateTime={new Date(a.createdAt).toISOString()}>{when(a.createdAt)}에 더함</time>
              </div>
              <button className="btn btn-small" disabled={busy} onClick={() => confirm(`‘${a.name}’ 관리자를 뺄까요? 바로 로그아웃돼요.`) && act(() => api(`/api/admin/admins/${a.id}`, 'DELETE'))}>
                빼기
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section className="card">
        <h2>관리자 더하기</h2>
        <p className="tip">더한 관리자는 모든 방 · 기관 설정 · 신고 · 기록을 볼 수 있어요. 관리자를 더하고 빼는 일만 할 수 없어요. 누가 무엇을 했는지는 기록에 남아요.</p>
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault()
            act(() => api('/api/admin/admins', 'POST', { name, password })).then((ok) => ok && (setName(''), setPassword('')))
          }}
        >
          <div className="grid2">
            <label className="field">
              <span>아이디</span>
              <input className="input" autoComplete="off" maxLength={30} value={name} onChange={(e) => setName(e.target.value)} required />
            </label>
            <label className="field">
              <span>비밀번호 (8자 이상)</span>
              <input className="input" type="password" autoComplete="new-password" maxLength={100} minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>
          </div>
          <Err text={error} />
          <div className="actions actions-start">
            <button className="btn btn-primary" disabled={busy}>
              관리자 더하기
            </button>
          </div>
        </form>
      </section>
    </>
  )
}

// ── 기록 ──────────────────────────────────────────────────
type AuditRow = { id: number; at: number; action: string; detail: Record<string, unknown> }
function AuditTab() {
  const [data, setData] = useState<{ intact: boolean; rows: AuditRow[] } | null>(null)
  const [q, setQ] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [shown, setShown] = useState(100)
  // 찾는 말 · 날짜를 주소 꼬리로 (내려받기도 같은 조건으로 받아요)
  const query = new URLSearchParams({ q: q.trim(), ...(from ? { from: String(new Date(from + 'T00:00:00').getTime()) } : {}), ...(to ? { to: String(new Date(to + 'T23:59:59').getTime()) } : {}) }).toString()
  useEffect(() => {
    const t = setTimeout(() => api(`/api/admin/audit?${query}`).then(setData, () => {}), 250) // 치는 동안에는 잠깐 기다려요
    return () => clearTimeout(t)
  }, [query])
  if (!data) return null
  return (
    <>
      <div className="ad-head">
        <h1>기록</h1>
        <a className="btn" href={`/api/admin/audit.csv?${query}`} download>
          <Download size={18} aria-hidden="true" />
          기록 내려받기
        </a>
      </div>
      <p className={`seal ${data.intact ? 'seal-ok' : 'seal-bad'}`} role="status">
        {data.intact ? <ShieldCheck size={22} aria-hidden="true" /> : <ShieldAlert size={22} aria-hidden="true" />}
        {data.intact ? '기록이 처음부터 끝까지 이어져 있어요. 고치거나 뺀 흔적이 없어요.' : '기록이 중간에 어긋나 있어요. 누군가 저장 파일을 직접 고쳤을 수 있어요.'}
      </p>
      <div className="finder">
        <input className="input" type="search" placeholder="한 일 · 사람 · 방 이름으로 찾기 (예: 방 지움, teacher)" aria-label="기록 찾기" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="field field-inline">
          <span>부터</span>
          <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="field field-inline">
          <span>까지</span>
          <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      <p className="tip">관리자와 진행자가 한 일, 안건을 마감한 순간의 결과가 남아요. 누가 무엇을 골랐는지는 여기에도 없어요. 화면에는 500개까지, 내려받기는 20,000개까지 담겨요.</p>
      {data.rows.length === 0 && <p className="empty">여기에 맞는 기록이 없어요.</p>}
      <ul className="audit">
        {data.rows.slice(0, shown).map((r) => (
          <li key={r.id}>
            <time dateTime={new Date(r.at).toISOString()}>{new Date(r.at).toLocaleString('ko-KR')}</time>
            <strong>{r.action}</strong>
            <span>
              {Object.entries(r.detail)
                .map(([k, v]) => `${k} ${typeof v === 'object' ? JSON.stringify(v) : v}`)
                .join(', ')}
            </span>
          </li>
        ))}
      </ul>
      {data.rows.length > shown && (
        <button className="btn" onClick={() => setShown(shown + 200)}>
          더 보기 ({data.rows.length - shown}줄 남음)
        </button>
      )}
    </>
  )
}
