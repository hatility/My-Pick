// 관리자 화면 (/admin): 로그인 → 방 목록 → 방 하나 진행 (주제 열기 · 마감 · 입장 코드 · 큰 화면) · 기관 설정 · 기록
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Ellipsis, Keyboard, X, ImageDown, Pause, Archive, ArrowDown, Eye, FlaskConical, Smartphone, ArrowLeft, ArrowUp, Ban, BellRing, Clock, Copy, GripVertical, SkipForward, Download, Scale, DoorClosed, DoorOpen, LogOut, MonitorUp, Pencil, Play, Plus, Printer, ShieldCheck, ShieldAlert, Square, Trash2 } from 'lucide-react'
import { resultCard } from './card'
import { ask, describe, dur, tell, toast } from './ui'
import { api, type Item, type Org, type RoomState } from './api'
import { Qr } from './Qr'
import { Backups, MyPassword, OverviewTab, RoomLook, ScreenControl, StatsTab } from './AdminMore'
import { AdFoot, AppMark, Loading, Offline, Practice, shrink, Result, ThemeToggle, TimeLeft, useLive, type Live } from './parts'
import './admin.css'

export type Defaults = { seconds: number; grace: number; maxLogoMb: number; siteUrl: string }
type RoomRow = { id: number; code: string; title: string; mode: 'simple' | 'strict'; owner: 'admin' | 'host'; expiresAt: number | null; archived: boolean; rehearsal: boolean; liveItem: string | null; present: number; closed: boolean; joined: number; items: number }
type RoomInput = { easy?: boolean; title: string; mode: 'simple' | 'strict'; password: string; hostPassword?: string; capacity: number; seconds: number; grace: number; closeAll: boolean; live: boolean }

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
const BASIS = { voted: '픽한 사람', valid: '실제로 고른 사람', joined: '들어온 사람 전체' } as const
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
  // 다른 화면과 같게 기관 이름 · 로고를 보여 줘요 (전에는 늘 ‘My Pick’ 으로 나왔어요)
  const [org, setOrg] = useState<Org | null>(null)
  useEffect(() => {
    api<Org>('/api/org').then(setOrg, () => {})
  }, [])
  const submit = (e: FormEvent) => {
    e.preventDefault()
    act(() => api('/api/admin/login', 'POST', { id, password }))
  }
  return (
    <main className="ad-login">
      <header className="ad-login-head">
        <AppMark />
        <h1>관리자 로그인</h1>
        <p>
          운영을 맡은 사람만 들어와요. 참여하려면 <a href="/">첫 화면</a>으로 가 주세요.
        </p>
      </header>
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
      <AdFoot org={org} label="관리 화면" />
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
        <AppMark />
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
      <AdFoot org={org} label="관리 화면" />
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
  const removeMany = async () =>
    (await ask(`고른 방 ${picked.length}개를 지울까요?\n주제와 결과가 모두 사라져요. 마지막 결과는 ‘기록’에 남아요.`, { ok: '지우기', danger: true })) &&
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
                      {MODE[r.mode]} 방식, 주제 {r.items}개, 들어온 {r.joined}명{r.closed ? ', 끝남' : ''}
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

      <div className="grid2">
        <label className="field">
          <span>방 비밀번호 {fixedMode ? '(바꿀 때만 적어요)' : '(없어도 돼요. 적으면 4자 이상)'}</span>
          <input className="input" type="text" autoComplete="off" maxLength={100} value={f.password} onChange={(e) => set('password', e.target.value)} />
        </label>
        <TimeField label="주제 제한 시간" value={f.seconds} onChange={(v) => set('seconds', v)} />
      </div>

      {!fixedMode && !f.password && f.mode === 'simple' && <p className="tip">방 비밀번호가 없으면 방 번호를 아는 사람은 누구나 들어올 수 있어요. 모두 들어온 뒤 ‘입장 마감’을 눌러 주세요.</p>}

      <details className="fold" open={!host}>
        <summary>
          더 자세히 정하기
          <small>
            지금: {f.mode === 'simple' ? '방 번호로 입장' : '한 사람에 코드 하나'} · {f.live ? '받는 중에도 결과 공개' : '마감 뒤 결과 공개'} · {f.closeAll ? '모두 픽하면 바로 마감' : '시간이 끝나야 마감'}
            {f.easy && ' · 쉬운 말'}
          </small>
        </summary>
        <div className="fold-body">
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
            {f.mode === 'simple' && (
              <label className="field">
                <span>정원 (0이면 제한 없음)</span>
                <input className="input" type="number" min={0} max={100000} value={f.capacity} onChange={(e) => set('capacity', n(e.target.value))} />
              </label>
            )}
            <label className="field">
              <span>접속이 끊긴 사람을 기다리는 시간 (초)</span>
              <input className="input" type="number" min={3} max={600} value={f.grace} onChange={(e) => set('grace', n(e.target.value))} />
            </label>
          </div>
          <label className="check">
            <input type="checkbox" checked={f.closeAll} onChange={(e) => set('closeAll', e.target.checked)} />
            <span>자리에 있는 사람이 모두 픽하면 바로 마감해요 (접속이 끊긴 사람은 위 시간만큼만 기다려요)</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={!!f.easy} onChange={(e) => set('easy', e.target.checked)} />
            <span>쉬운 말 모드 (참여 화면의 글자를 키우고 문장을 짧게 해요. 어린 참여자나 한국어가 서툰 분이 있을 때)</span>
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

        </div>
      </details>

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
  // PC 진행 단축키 (빔프로젝터 옆 노트북으로 진행할 때): 스페이스 멈춤 · 다시, N 다음 주제, M 지금 마감, T 30초 더, ? 도움말
  const keys = useRef<(e: KeyboardEvent) => void>(() => {})
  useEffect(() => {
    const on = (e: KeyboardEvent) => keys.current(e)
    addEventListener('keydown', on)
    return () => removeEventListener('keydown', on)
  }, [])
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
  const current = s.items.find((i) => i.status === 'open')
  const openNext = async () => next && (await ask(`다음 주제 ‘${next.title}’ 픽을 열까요?\n열면 주제를 고치거나 지울 수 없어요.`, { ok: '열기' })) && act(() => api(`/api/admin/items/${next.id}/open`, 'POST'))
  const showKeys = () => tell('진행 단축키 (PC)', ['스페이스: 잠깐 멈추기 · 다시 시작', 'N: 다음 주제 열기', 'M: 지금 마감', 'T: 30초 더', '?: 이 도움말'])
  keys.current = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || document.querySelector('dialog[open]')) return
    const t = e.target as HTMLElement
    if (t.closest('input, textarea, select, [contenteditable="true"]')) return // 글을 쓰는 중에는 그대로
    if (e.code === 'Space' && t.closest('button, a, summary')) return // 단추에 손이 가 있으면 그 단추를 눌러요
    const go = (fn: () => unknown) => (e.preventDefault(), fn())
    if (e.code === 'Space' && current) go(() => act(() => api(`/api/admin/items/${current.id}/${current.paused ? 'resume' : 'pause'}`, 'POST')))
    else if (e.code === 'KeyN' && next && !current && !s.room.closed) go(openNext)
    else if (e.code === 'KeyM' && current) go(async () => (await ask('지금 마감할까요?\n아직 픽하지 않은 사람은 픽할 수 없게 돼요.', { ok: '지금 마감' })) && act(() => api(`/api/admin/items/${current.id}/close`, 'POST')))
    else if (e.code === 'KeyT' && current && (current.closesAt || current.pausedLeft)) go(() => act(() => api(`/api/admin/items/${current.id}/extend`, 'POST', { seconds: 30 })))
    else if (e.key === '?' || (e.code === 'Slash' && e.shiftKey)) go(showKeys)
  }
  // 끌어서 순서 바꾸기: 끌던 주제를 놓은 주제 자리로 옮겨요
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
      <Offline online={live.online} host />

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
                <button data-view="set" className="btn" disabled={busy} onClick={async () => (await ask('방을 끝낼까요?\n열린 주제는 마감되고, 더는 픽할 수 없어요. 결과는 계속 볼 수 있어요.', { ok: '방 끝내기', danger: true })) && act(() => api(`/api/admin/rooms/${id}/close`, 'POST'))}>
                  방 끝내기
                </button>
              )}
            </>
          )}
          {a.role !== 'cohost' && (
            <button data-view="set" className="btn btn-danger" disabled={busy} onClick={async () => (await ask('방을 지울까요?\n주제와 결과가 모두 사라져요. 마지막 결과는 ‘기록’에 남아요.', { ok: '지우기', danger: true })) && act(() => api(`/api/admin/rooms/${id}`, 'DELETE')).then((ok) => ok && onBack())}>
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
              navigator.clipboard?.writeText(link).then(() => toast('지켜보기 주소를 복사했어요'), () => {})
              setWatch(link)
            }}
          >
            <Eye size={18} aria-hidden="true" />
            지켜보기 주소
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
              <button className="btn btn-danger" disabled={busy} onClick={async () => (await ask('이 방을 지우고, 이 방을 만든 곳에서는 방을 만들지 못하게 막을까요?\n학교처럼 여럿이 같은 인터넷 주소를 쓰는 곳이면 모두가 막혀요.', { ok: '지우고 막기', danger: true })) && act(() => api(`/api/admin/rooms/${id}/block`, 'POST', { days: blockDays })).then((ok) => ok && onBack())}>
                <Ban size={18} aria-hidden="true" />
                지우고 만든 곳 막기
              </button>
            </span>
          )}
        </div>
        {watch && (
          <p data-view="prep" className="tip" role="status">
            지켜보기 주소: <code className="watch-link">{watch}</code> 이 주소를 받은 사람은 진행 상황 · 결과 · 이 방의 기록만 볼 수 있어요.
          </p>
        )}
        {a.rehearsalOf && (
          <div className="warn rehearsal">
            <p>
              <strong>리허설 방이에요.</strong> 가짜 참여자 10명이 주제가 열리면 알아서 골라요. 진짜 방과 똑같이 눌러 보세요. 통계에 들어가지 않고, 하루 뒤 저절로 지워져요.
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
            이 방은 {day(a.expiresAt)}에 자동으로 지워져요. 필요한 결과는 그 전에 내려받거나 인쇄해 두세요.
          </p>
        )}
        {!s.room.closed && !s.room.locked && s.room.mode === 'simple' && s.joined > 0 && <p data-view="run" className="tip">모두 들어왔으면 ‘입장 마감’을 눌러 주세요. 들어온 사람 수가 실제 인원과 같으면 겹쳐 들어온 사람이 없는 거예요.</p>}
        <Err text={error} />
      </section>

      {s.hands && s.hands.question + s.hands.more > 0 && (
        <div data-view="run" className="warn hands-host" role="status">
          <p>
            <strong>조용히 손든 사람이 있어요.</strong> {[s.hands.question && `질문 있어요 ${s.hands.question}명`, s.hands.more && `더 설명해 주세요 ${s.hands.more}명`].filter(Boolean).join(', ')}
          </p>
          <button className="btn" disabled={busy} onClick={() => act(() => api(`/api/admin/rooms/${id}/hands`, 'DELETE'))}>
            대답했어요 (손 내리기)
          </button>
        </div>
      )}
      <section data-view="run" className="card">
        <div className="ad-head">
          <h2>주제</h2>
          <div className="actions">
            {next && !hasOpen && !s.room.closed && (
              <button className="btn btn-primary" disabled={busy} onClick={openNext}>
                <SkipForward size={18} aria-hidden="true" />
                다음 주제 열기
              </button>
            )}
            {s.items.some((i) => i.status === 'closed') && (
              <details className="menu">
                <summary className="btn">
                  <Download size={18} aria-hidden="true" />
                  결과 남기기
                </summary>
                <div className="menu-list" onClick={(e) => e.currentTarget.parentElement?.removeAttribute('open')}>
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
                    결과 정리 인쇄
                  </button>
                </div>
              </details>
            )}
            {!adding && !s.room.closed && (
              <button className="btn" onClick={() => setAdding(true)}>
                <Plus size={18} aria-hidden="true" />
                주제 더하기
              </button>
            )}
            <button className="btn btn-icon keys-hint" aria-label="진행 단축키 보기" title="진행 단축키 (?)" onClick={showKeys}>
              <Keyboard size={18} aria-hidden="true" />
            </button>
          </div>
        </div>
        {s.items.length === 0 && !adding && <p className="empty">주제를 더하고 ‘픽 열기’를 누르면 바로 시작돼요. 주제는 한 번에 하나씩 열려요.</p>}
        <ol className="items">
          {s.items.map((it) => (
            <ItemCard key={it.id} item={it} state={s} canOpen={!hasOpen && !s.room.closed} refresh={live.refresh} drag={draftIds.length > 1 && it.status === 'draft' ? { start: () => setDragged(it.id), drop: () => drop(it.id), on: dragged === it.id } : undefined} />
          ))}
        </ol>
        {adding && (
          <ItemForm
            roomSeconds={a.seconds}
            submitLabel="주제 더하기"
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
            initial={{ title: s.room.title, mode: s.room.mode, capacity: a.capacity, seconds: a.seconds, grace: a.grace, closeAll: a.closeAll, live: s.room.live, easy: s.room.easy }}
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
          submitLabel="주제 저장"
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
            {item.maxPick === 1 ? '하나만 고르기' : `${item.maxPick}개까지 고르기`}, {item.seconds ? `제한 시간 ${dur(item.seconds)}` : '제한 시간 없음'}
            {item.rule !== 'none' && `, ‘${item.options[0]?.label}’ ${item.rule === 'majority' ? '절반을 넘으면' : '3분의 2 이상이면'} 통과 (${BASIS[item.basis]} 기준)`}
            {item.quorum > 0 && `, 최소 참여 인원 ${item.quorum}명`}
            {item.shuffle && ', 선택지 순서 섞기'}
          </p>
          <div className="actions actions-start">
            <button className="btn" disabled={busy || !canOpen} onClick={async () => (await ask(`‘${item.title}’ 픽을 열까요?\n열면 주제를 고치거나 지울 수 없어요.`, { ok: '열기' })) && call('/open')}>
              <Play size={18} aria-hidden="true" />
              픽 열기
            </button>
            <details className="menu menu-left">
              <summary className="btn btn-icon" aria-label="이 주제 더 보기 (고치기 · 지우기 · 순서)" title="고치기 · 지우기 · 순서">
                <Ellipsis size={18} aria-hidden="true" />
              </summary>
              <div className="menu-list" onClick={(e) => e.currentTarget.parentElement?.removeAttribute('open')}>
                <button className="btn" disabled={busy} onClick={() => setEditing(true)}>
                  <Pencil size={18} aria-hidden="true" />
                  고치기
                </button>
                <button className="btn" disabled={busy} onClick={() => act(() => api(`/api/admin/items/${item.id}/move`, 'POST', { dir: 'up' }))}>
                  <ArrowUp size={18} aria-hidden="true" />
                  위로 옮기기
                </button>
                <button className="btn" disabled={busy} onClick={() => act(() => api(`/api/admin/items/${item.id}/move`, 'POST', { dir: 'down' }))}>
                  <ArrowDown size={18} aria-hidden="true" />
                  아래로 옮기기
                </button>
                <button className="btn menu-danger" disabled={busy} onClick={async () => (await ask('이 주제를 지울까요?', { ok: '지우기', danger: true })) && call('', 'DELETE')}>
                  <Trash2 size={18} aria-hidden="true" />
                  지우기
                </button>
              </div>
            </details>
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
        </>
      )}

      {item.status === 'open' && (
        <>
          <TimeLeft item={item} skew={state.skew} />
          <p className="item-live">
            <strong>{item.voted}명</strong>이 픽했어요 (지금 접속 {state.present}명)
          </p>
          {item.revealed ? <Result item={item} /> : <p className="tip">결과는 마감 뒤에 공개돼요. 지금은 관리자도 볼 수 없어요.</p>}
          <div className="actions actions-start">
            <button className="btn btn-primary" disabled={busy} onClick={async () => (await ask('지금 마감할까요?\n아직 픽하지 않은 사람은 픽할 수 없게 돼요.', { ok: '지금 마감' })) && call('/close')}>
              <Square size={18} aria-hidden="true" />
              지금 마감
            </button>
            <button className="btn" disabled={busy} title={item.paused ? '남은 시간부터 이어서 받아요' : '남은 시간을 얼리고 잠깐 픽을 멈춰요 (설명을 더 할 때)'} onClick={() => call(item.paused ? '/resume' : '/pause')}>
              {item.paused ? <Play size={18} aria-hidden="true" /> : <Pause size={18} aria-hidden="true" />}
              {item.paused ? '다시 시작' : '잠깐 멈추기'}
            </button>
            {(item.closesAt || item.pausedLeft) && (
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
              <strong>확인 요청 {item.objectionNotes.length}건</strong>
              <ul>
                {item.objectionNotes.map((o, i) => (
                  <li key={i}>
                    {o.note} <time dateTime={new Date(o.at).toISOString()}>{when(o.at)}</time>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="actions actions-start no-print">
            {tied && !state.room.closed && (
              <button className="btn btn-primary" disabled={busy} onClick={() => call('/runoff')}>
                <Scale size={18} aria-hidden="true" />
                동점인 선택지로 다시 고르기
              </button>
            )}
            <button className="btn" onClick={() => resultCard(item, state.room.title, state.org.name)}>
              <ImageDown size={18} aria-hidden="true" />
              결과 그림 받기
            </button>
            {!state.room.closed && (
              <button className="btn" disabled={busy} onClick={() => call('/copy')}>
                <Copy size={18} aria-hidden="true" />
                복사해서 다시 픽
              </button>
            )}
          </div>
        </>
      )}
      <div className="item-more">
        {item.status === 'draft' && !state.room.closed && (
          <details className="sched-form">
            <summary>예약 (저절로 열고 마감하기)</summary>
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
        <Memo item={item} />
      </div>
      <Err text={error} />
    </li>
  )
}

/** 진행자 메모: 진행자만 보는 한마디. 칸을 벗어나면 저절로 저장돼요. */
function Memo({ item }: { item: Item }) {
  const [text, setText] = useState(item.memo ?? '')
  const save = () => {
    if (text === (item.memo ?? '')) return
    api(`/api/admin/items/${item.id}/memo`, 'POST', { memo: text }).then(() => toast('메모를 저장했어요'), () => {})
  }
  return (
    <details className="memo no-print" open={!!item.memo}>
      <summary>진행자 메모</summary>
      <textarea className="input" rows={2} maxLength={1000} placeholder="진행할 때 볼 메모 (참여자에게는 안 보여요)" aria-label="진행자 메모" value={text} onChange={(e) => setText(e.target.value)} onBlur={save} />
    </details>
  )
}

type ItemInput = { title: string; note: string; options: string[]; maxPick: number; seconds: number; rule: Item['rule']; practice: boolean; quorum?: number; basis?: Item['basis']; shuffle?: boolean }
/** 제한 시간: 자주 쓰는 길이에서 고르고, 없으면 ‘직접 적기’로 초를 적어요 */
const TIMES: [number, string][] = [[30, '30초'], [60, '1분'], [120, '2분'], [180, '3분'], [300, '5분'], [600, '10분'], [0, '제한 없음']]
function TimeField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const [own, setOwn] = useState(!TIMES.some(([t]) => t === value))
  return (
    <div className="field">
      <label htmlFor={`time-${label}`}>
        <span>{label}</span>
      </label>
      <div className="time-pick">
        <select
          id={`time-${label}`}
          className="input"
          value={own ? 'own' : String(value)}
          onChange={(e) => {
            if (e.target.value === 'own') return setOwn(true)
            setOwn(false)
            onChange(Number(e.target.value))
          }}
        >
          {TIMES.map(([t, name]) => (
            <option key={t} value={t}>
              {name}
            </option>
          ))}
          <option value="own">직접 적기</option>
        </select>
        {own && (
          <label className="time-own">
            <input className="input" type="number" min={0} max={3600} aria-label={`${label} (초)`} value={value} onChange={(e) => onChange(Math.max(0, Math.min(3600, Math.floor(Number(e.target.value) || 0))))} />
            <span>초</span>
          </label>
        )}
      </div>
    </div>
  )
}

/** 선택지: 칸마다 하나. 엔터를 누르면 다음 칸이 생기고, 여러 줄을 붙여 넣으면 한 줄에 하나씩 나눠 들어가요. */
const MAX_OPTIONS = 30
function OptionsEditor({ list, onChange }: { list: string[]; onChange: (l: string[]) => void }) {
  const boxes = useRef<(HTMLInputElement | null)[]>([])
  const [focus, setFocus] = useState<number | null>(null)
  useEffect(() => {
    if (focus === null) return
    boxes.current[focus]?.focus()
    setFocus(null)
  }, [focus])
  const put = (at: number, values: string[], replace = 0) => {
    const next = [...list]
    next.splice(at, replace, ...values)
    onChange(next.slice(0, MAX_OPTIONS))
    setFocus(Math.min(at + values.length - 1, MAX_OPTIONS - 1))
  }
  const drop = (i: number) => {
    onChange(list.length > 2 ? list.filter((_, j) => j !== i) : list.map((x, j) => (j === i ? '' : x)))
    setFocus(Math.max(0, i - 1))
  }
  const filled = list.map((x) => x.trim()).filter(Boolean)
  const twice = filled.find((x, i) => filled.indexOf(x) !== i)
  return (
    <fieldset className="opts-edit">
      <legend>선택지 ({filled.length}개, 두 개 이상)</legend>
      <ol>
        {list.map((v, i) => (
          <li key={i} className="opt-row">
            <span className="opt-num" aria-hidden="true">
              {i + 1}
            </span>
            <input
              ref={(el) => {
                boxes.current[i] = el
              }}
              className="input"
              aria-label={`선택지 ${i + 1}`}
              maxLength={80}
              placeholder={i === 0 ? '예: 떡볶이' : i === 1 ? '예: 피자' : ''}
              value={v}
              onChange={(e) => onChange(list.map((x, j) => (j === i ? e.target.value : x)))}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return // 한글을 쓰는 중의 엔터는 글자를 마무리하는 것
                if (e.key === 'Enter') {
                  e.preventDefault()
                  if (list.length < MAX_OPTIONS) put(i + 1, [''])
                } else if (e.key === 'Backspace' && !v && list.length > 2) {
                  e.preventDefault()
                  drop(i)
                }
              }}
              onPaste={(e) => {
                const lines = e.clipboardData.getData('text').split(/\r?\n/).map((x) => x.trim()).filter(Boolean)
                if (lines.length < 2) return
                e.preventDefault()
                put(i, lines, v ? 0 : 1)
              }}
            />
            <button type="button" className="btn btn-icon btn-quiet" aria-label={`선택지 ${i + 1} 빼기`} disabled={list.length <= 2 && !v} onClick={() => drop(i)}>
              <X size={18} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ol>
      {twice && <p className="error">‘{twice}’ 이(가) 두 번 있어요. 하나는 빼 주세요.</p>}
      <div className="actions actions-start">
        <button type="button" className="btn btn-small" disabled={list.length >= MAX_OPTIONS} onClick={() => put(list.length, [''])}>
          <Plus size={18} aria-hidden="true" />
          선택지 더하기
        </button>
        <span className="tip">엔터를 누르면 다음 칸이 생겨요. 여러 줄을 붙여 넣으면 나눠 들어가요.</span>
      </div>
    </fieldset>
  )
}

function ItemForm({ initial, roomSeconds, submitLabel, onSubmit, onCancel }: { initial?: ItemInput; roomSeconds: number; submitLabel: string; onSubmit: (f: ItemInput) => Promise<unknown>; onCancel: () => void }) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [note, setNote] = useState(initial?.note ?? '')
  const [opts, setOpts] = useState<string[]>(initial?.options?.length ? initial.options : ['', ''])
  const [maxPick, setMaxPick] = useState(initial?.maxPick ?? 1)
  const [seconds, setSeconds] = useState(initial?.seconds ?? roomSeconds)
  const [rule, setRule] = useState<Item['rule']>(initial?.rule ?? 'none')
  const [practice, setPractice] = useState(initial?.practice ?? false)
  const [quorum, setQuorum] = useState(initial?.quorum ?? 0)
  const [basis, setBasis] = useState<Item['basis']>(initial?.basis ?? 'voted')
  const [shuffle, setShuffle] = useState(initial?.shuffle ?? false)
  // 기본값에서 벗어난 것이 있으면 자세한 칸을 펼쳐 둬요
  const [more] = useState(!!initial && (!!initial.note || (initial.rule ?? 'none') !== 'none' || !!initial.quorum || !!initial.shuffle || !!initial.practice))
  const { act, error, busy } = useAct()
  // 자주 쓰는 모양을 한 번에 채워요
  const fill = (o: string, r: Item['rule'], t?: string) => {
    setOpts(o.split('\n'))
    setRule(r)
    setMaxPick(1)
    setPractice(!!t)
    if (t) setTitle(t)
  }
  const list = opts.map((s) => s.trim()).filter(Boolean)
  return (
    <form
      className="form form-inset"
      onSubmit={(e) => {
        e.preventDefault()
        act(async () => {
          if (list.length < 2) throw new Error('선택지를 두 개 이상 적어 주세요')
          if (new Set(list).size !== list.length) throw new Error('같은 선택지가 두 번 있어요. 하나는 빼 주세요')
          return onSubmit({ title, note, options: list, maxPick: Math.min(maxPick, Math.max(1, list.length)), seconds, rule: maxPick === 1 ? rule : 'none', practice, quorum, shuffle, basis: maxPick === 1 && rule !== 'none' ? basis : 'voted' })
        })
      }}
    >
      <div className="presets">
        <span>자주 쓰는 모양</span>
        <button type="button" className="btn btn-small" onClick={() => fill('찬성\n반대', 'none')}>
          찬성 / 반대
        </button>
        <button type="button" className="btn btn-small" onClick={() => fill('찬성\n반대', 'majority')}>
          찬성 / 반대 (절반을 넘으면 통과)
        </button>
        <button type="button" className="btn btn-small" onClick={() => fill('잘 보여요\n잘 안 보여요', 'none', '연습 픽: 화면이 잘 보이나요?')}>
          연습 픽
        </button>
      </div>
      <label className="field">
        <span>주제 제목</span>
        <input className="input" maxLength={100} placeholder="예: 축제 주제를 골라 주세요" value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
      </label>
      <OptionsEditor list={opts} onChange={setOpts} />
      <div className="grid2">
        <label className="field">
          <span>한 사람이 고를 수 있는 개수</span>
          <input className="input" type="number" min={1} max={Math.max(1, list.length)} value={maxPick} onChange={(e) => setMaxPick(Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
        </label>
        <TimeField label="제한 시간" value={seconds} onChange={setSeconds} />
      </div>
      <details className="fold" open={more}>
        <summary>
          더 자세히 정하기
          <small>
            지금: {maxPick === 1 && rule !== 'none' ? (rule === 'majority' ? '절반을 넘으면 통과' : '3분의 2 이상이면 통과') : '통과 여부 안 따짐'}
            {shuffle && ' · 순서 섞기'}
            {practice && ' · 연습'}
          </small>
        </summary>
        <div className="fold-body">
          <label className="field">
            <span>설명 (없어도 돼요)</span>
            <input className="input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <label className="field">
            <span>통과 기준 (하나만 고르는 주제에서, 첫 번째 선택지를 찬성으로 봐요)</span>
            <select className="input" value={maxPick === 1 ? rule : 'none'} disabled={maxPick !== 1} onChange={(e) => setRule(e.target.value as Item['rule'])}>
              <option value="none">통과 여부를 따지지 않기 (받은 픽만 보여 주기)</option>
              <option value="majority">픽한 사람의 절반을 넘으면 통과</option>
              <option value="two_thirds">픽한 사람의 3분의 2 이상이면 통과</option>
            </select>
          </label>
          <div className="grid2">
            <label className="field">
              <span>통과를 따질 기준 인원</span>
              <select className="input" value={basis} disabled={maxPick !== 1 || rule === 'none'} onChange={(e) => setBasis(e.target.value as Item['basis'])}>
                <option value="voted">픽한 사람 (건너뛴 사람 포함)</option>
                <option value="valid">실제로 고른 사람</option>
                <option value="joined">들어온 사람 전체</option>
              </select>
            </label>
            <label className="field">
              <span>최소 참여 인원 (이만큼 들어와야 열 수 있어요, 0이면 없음)</span>
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
        </div>
      </details>
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

// ── 주제 묶음: 자주 쓰는 주제를 이름 붙여 저장해 두고 다른 방에서 불러와요 ──
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
      toast(`‘${title}’ 묶음에 주제 ${items.length}개를 저장했어요`)
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
      setNote(`‘${b.name}’ 묶음의 주제 ${b.items.length}개를 더했어요.`)
    })
  // 파일로 옮기기 (방장: 다른 기기에서 쓰거나 다른 사람에게 줄 때)
  const exportFile = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' }))
    a.download = 'mypick-주제묶음.json'
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
      setNote('주제 묶음 파일이 아니에요.')
    }
  }
  return (
    <details className="card no-print">
      <summary>주제 묶음 (자주 쓰는 주제 저장 · 불러오기)</summary>
      <p className="tip">{server ? '매번 같은 주제로 회의한다면 묶음으로 저장해 두세요. 서버에 저장돼서 어느 기기에서나, 다른 관리자도 불러올 수 있어요.' : '매번 같은 주제로 회의한다면 묶음으로 저장해 두세요. 이 브라우저에 저장돼요. 다른 기기에서 쓰려면 파일로 내보냈다가 가져오세요.'}</p>
      {list.length > 0 && (
        <ul className="bundles">
          {list.map((b) => (
            <li key={b.name}>
              <span>
                <strong>{b.name}</strong> 주제 {b.items.length}개
              </span>
              <button className="btn btn-small" disabled={busy} onClick={() => load(b)}>
                <Plus size={16} aria-hidden="true" />
                불러오기
              </button>
              <button className="btn btn-small" aria-label={`${b.name} 묶음 지우기`} onClick={async () => (await ask(`‘${b.name}’ 묶음을 지울까요?`, { ok: '지우기', danger: true })) && remove(b)}>
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
          지금 주제 {items.length}개를 묶음으로 저장
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

// ── 결과 정리: 화면에는 안 보이고 ‘결과 정리 인쇄’를 누르면 이것만 종이에 나와요 ──
function Minutes({ s }: { s: Live }) {
  const closed = s.items.filter((i) => i.status === 'closed' && !i.practice)
  if (!closed.length) return null
  const when = (t: number | null) => (t ? new Date(t).toLocaleString('ko-KR', { dateStyle: 'long', timeStyle: 'short' }) : '')
  return (
    <section className="minutes">
      <h1>{s.room.title} My Pick 결과 정리</h1>
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
              제{n + 1}호 주제. {it.title}
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
                  <td>건너뜀</td>
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
                  통과 여부: {it.outcome === 'pass' ? '통과' : '통과 못 함'} (‘{it.options[0]?.label}’이 {BASIS[it.basis]}의 {it.rule === 'majority' ? '절반을 넘으면' : '3분의 2 이상이면'} 통과)
                </strong>
              )}
            </p>
            <p>
              결과 확인 코드: {it.proof}
              {it.objections > 0 && ` · 마감 뒤 들어온 확인 요청 ${it.objections}건`}
            </p>
          </li>
        ))}
      </ol>
      <p>이 픽은 익명으로 진행되어, 누가 무엇을 골랐는지는 기록되지 않았습니다. 결과 확인 코드는 마감한 순간의 결과로 만든 것이며, 누구나 결과 확인 화면에서 결과가 바뀌지 않았는지 확인할 수 있습니다.</p>
      {s.admin?.mark.mark && (
        <p>
          기록 지문: {s.admin.mark.mark} (인쇄한 때의 기록 {s.admin.mark.count.toLocaleString('ko-KR')}줄). 관리자가 기록 화면에서 이 지문을 견줘 보면, 이때까지의 기록이 잘리거나 다시 쓰이지 않았는지 알 수 있습니다.
        </p>
      )}
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
  const [codes, setCodes] = useState<{ code: string; used: boolean; reopen: boolean }[] | null>(null)
  const [again, setAgain] = useState('')
  const [shownCodes, setShownCodes] = useState(60) // 화면에는 60개씩 (인쇄할 때는 모두 펼쳐요)
  const show = () => api<{ codes: { code: string; used: boolean; reopen: boolean }[] }>(`/api/admin/rooms/${roomId}/codes`).then((d) => setCodes(d.codes))
  const { act, error, busy } = useAct(async () => {
    await refresh()
    await show()
  })
  const address = (siteUrl || location.origin).replace(/^https?:\/\//, '')
  return (
    <section className="card">
      <h2>입장 코드</h2>
      <p className="tip">
        한 사람에게 하나씩 나눠 주세요. QR 을 찍으면 방 번호와 코드가 채워진 채로 바로 들어와요. 지금 {total}개 중 {used}개를 썼어요. 코드는 한 번만 쓸 수 있어요. 한 번 쓴 코드는 다른 기기에서 다시 넣어도 들어올 수 없어요.
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
      {used > 0 && (
        <form
          className="reopen no-print"
          onSubmit={(e) => {
            e.preventDefault()
            act(() => api(`/api/admin/rooms/${roomId}/codes`, 'PUT', { code: again }).then(() => (toast(`${fmtCode(again)} 코드를 다시 열었어요. 이제 한 번 더 들어올 수 있어요`), setAgain('')))).catch(() => {})
          }}
        >
          <label className="field field-inline">
            <span>쓴 코드 다시 열기</span>
            <input className="input input-code" autoComplete="off" autoCapitalize="characters" maxLength={12} placeholder="코드 8자리" value={again} onChange={(e) => setAgain(e.target.value.toUpperCase())} required />
          </label>
          <button className="btn" disabled={busy}>
            다시 열기
          </button>
          <p className="tip">기기를 바꿨거나 화면이 닫혀 다시 들어와야 하는 사람이 있으면, 그 사람의 코드(종이)를 직접 확인한 뒤 열어 주세요. 한 번 더 들어오면 다시 닫히고, 앞에 쓰던 기기는 끊겨요. 이미 픽한 주제는 다시 픽할 수 없어요.</p>
        </form>
      )}
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
              {c.used && <span className="code-mark">{c.reopen ? '다시 열림' : '사용함'}</span>}
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
            act(async () => setOrg(await api<Org>('/api/admin/org', 'PUT', { name }))).then((ok) => ok && toast('기관 이름을 저장했어요'))
          }}
        >
          <label className="field">
            <span>모든 화면 맨 위에 나와요</span>
            <input className="input" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <div className="actions actions-start">
            <button className="btn btn-primary" disabled={busy}>
              이름 저장
            </button>
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
        진행을 도울 사람에게 따로 비밀번호를 줄 수 있어요. ‘내가 만든 방 진행하기’에서 방 번호와 이 비밀번호로 들어와요. 주제를 더하고 열고 마감할 수 있지만, 방 지우기 · 끝내기 · 설정 바꾸기는 할 수 없어요.
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

// ── 신고 · 막을 낱말 · 막은 곳 ───────────────────────────────
type Report = { id: number; roomId: number | null; roomCode: string; roomTitle: string; reason: string; note: string; at: number; handled: boolean }
type ReportData = { feedback: { id: number; at: number; kind: string; note: string; page: string; ua: string }[]; open: number; reports: Report[]; banned: string; blocks: { creator: string; at: number; why: string; until: number | null }[] }
function ReportsTab({ onOpen, onChange }: { onOpen: (id: number) => void; onChange: () => void }) {
  const [data, setData] = useState<ReportData | null>(null)
  const [banned, setBanned] = useState('')
  // 네 가지를 한 번에 길게 늘어놓지 않고 작은 탭으로 나눠 하나씩 봐요
  const [view, setView] = useState<'reports' | 'feedback' | 'banned' | 'blocks'>('reports')
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
        <h1>신고 · 제보</h1>
      </div>
      <div className="seg room-tabs sub-tabs" role="group" aria-label="신고 · 제보 나누어 보기">
        {(
          [
            ['reports', '신고', data.open],
            ['feedback', '오류 제보', data.feedback.length],
            ['banned', '막을 낱말', 0],
            ['blocks', '막은 곳', data.blocks.length],
          ] as const
        ).map(([v, name, n]) => (
          <button key={v} className="seg-btn" aria-pressed={view === v} onClick={() => setView(v)}>
            {name}
            {n > 0 && <span className="seg-count">{n}</span>}
          </button>
        ))}
      </div>
      {view === 'reports' && (
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
                {!r.handled ? (
                  <button className="btn btn-small" disabled={busy} onClick={() => act(() => api(`/api/admin/reports/${r.id}/handle`, 'POST'))}>
                    확인했어요
                  </button>
                ) : (
                  <button className="btn btn-small" disabled={busy} onClick={async () => (await ask('이 신고를 지울까요?\n지운 일은 기록에 남아요.', { ok: '지우기', danger: true })) && act(() => api(`/api/admin/reports/${r.id}`, 'DELETE'))}>
                    지우기
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>
      )}
      {view === 'feedback' && (
        <section className="card">
          <h2>오류 제보 · 바라는 점 {data.feedback.length ? `(${data.feedback.length}개)` : ''}</h2>
          {data.feedback.length === 0 && <p className="empty">아직 없어요. 화면 맨 아래의 ‘오류 제보’로 누구나 보낼 수 있어요.</p>}
          <ul className="reports">
            {data.feedback.map((f) => (
              <li key={f.id}>
                <div>
                  <strong>{f.kind}</strong>
                  <span>
                    {new Date(f.at).toLocaleString('ko-KR')}
                    {f.page && `, ${f.page} 화면`}
                  </span>
                  <p>{f.note}</p>
                  {f.ua && <span className="feedback-ua">{f.ua}</span>}
                </div>
                <div className="actions">
                  <button className="btn btn-small" disabled={busy} onClick={async () => (await ask('이 제보를 지울까요?', { ok: '지우기', danger: true })) && act(() => api(`/api/admin/feedback/${f.id}`, 'DELETE'))}>
                    지우기
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {view === 'banned' && (
        <section className="card">
          <h2>막을 낱말</h2>
          <p className="tip">누구나 만드는 방(방장이 만든 방)의 방 이름 · 주제 · 선택지에 이 말이 들어 있으면 저장되지 않아요. 한 줄에 하나씩, 두 글자 이상. 띄어쓰기와 사이에 넣은 기호(바.보 · 바~보)는 빼고 견줘요.</p>
          <textarea className="input" rows={5} value={banned} onChange={(e) => setBanned(e.target.value)} aria-label="막을 낱말 목록" />
          <div className="actions actions-start">
            <button className="btn btn-primary" disabled={busy} onClick={() => act(() => api('/api/admin/banned', 'PUT', { words: banned })).then((ok) => ok && toast('막을 낱말을 저장했어요'))}>
              막을 낱말 저장
            </button>
          </div>
        </section>
      )}
      {view === 'blocks' && (
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
      )}
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
              <button className="btn btn-small" disabled={busy} onClick={async () => (await ask(`‘${a.name}’ 관리자를 뺄까요? 바로 로그아웃돼요.`, { ok: '빼기', danger: true })) && act(() => api(`/api/admin/admins/${a.id}`, 'DELETE'))}>
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
/** 기록 한 줄의 내용: 길면(지운 방의 마지막 결과 같은 것) 앞부분만 보이고 눌러서 펼쳐요 */
function AuditText({ text }: { text: string }) {
  if (text.length <= 220) return <span>{text}</span>
  return (
    <details>
      <summary>
        <span>{text.slice(0, 180)}…</span> <b>더 보기</b>
      </summary>
      <span>{text}</span>
    </details>
  )
}

function AuditTab() {
  const [data, setData] = useState<{ intact: boolean; mark: string; count: number; sealed: boolean; rows: AuditRow[] } | null>(null)
  const [typed, setTyped] = useState('')
  const [checked, setChecked] = useState<{ found: boolean; at: number | null; pos: number; intact: boolean; count: number } | null>(null)
  const mark = useAct()
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
      {data.mark && (
        <section className="card mark">
          <h2>기록 지문</h2>
          <p>
            지금 기록 {data.count.toLocaleString('ko-KR')}줄의 지문은 <strong className="proof">{data.mark}</strong> 이에요.
          </p>
          <p className="tip">
            이 지문을 사진 · 인쇄물처럼 서버 밖에 적어 두세요. 나중에 아래에 넣어 보면, 그때까지의 기록이 잘리거나 다시 쓰이지 않았는지 알 수 있어요.
            {!data.sealed && ' 지금은 열쇠 없이 봉하고 있어요. .env 에 AUDIT_SECRET 을 넣으면 저장 파일만으로는 기록을 꾸며 낼 수 없어요.'}
          </p>
          <form
            className="finder"
            onSubmit={(e) => {
              e.preventDefault()
              setChecked(null)
              mark.act(() => api<NonNullable<typeof checked>>(`/api/admin/audit/mark?m=${encodeURIComponent(typed)}`).then(setChecked))
            }}
          >
            <input className="input" placeholder="적어 둔 지문 (예: 3FA2-9C01-77BE)" aria-label="적어 둔 기록 지문" value={typed} onChange={(e) => setTyped(e.target.value)} required />
            <button className="btn" disabled={mark.busy}>
              견줘 보기
            </button>
          </form>
          <Err text={mark.error} />
          {checked && (
            <p className={`seal ${checked.found && checked.intact ? 'seal-ok' : 'seal-bad'}`} role="status">
              {checked.found && checked.intact
                ? `그 지문은 지금 기록의 ${checked.pos.toLocaleString('ko-KR')}번째 줄(${new Date(checked.at!).toLocaleString('ko-KR')})이에요. 거기까지의 기록은 그대로예요.`
                : checked.found
                  ? '그 지문의 줄은 있지만, 기록이 중간에 어긋나 있어요.'
                  : '그 지문이 지금 기록에 없어요. 적어 둔 뒤로 기록이 잘렸거나 다시 쓰였어요 (백업으로 되돌렸을 때도 이렇게 나와요).'}
            </p>
          )}
        </section>
      )}
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
      <p className="tip">관리자와 진행자가 한 일, 주제를 마감한 순간의 결과가 남아요. 누가 무엇을 골랐는지는 여기에도 없어요. 화면에는 500개까지, 내려받기는 20,000개까지 담겨요.</p>
      {data.rows.length === 0 && <p className="empty">여기에 맞는 기록이 없어요.</p>}
      <ul className="audit">
        {data.rows.slice(0, shown).map((r) => (
          <li key={r.id}>
            <time dateTime={new Date(r.at).toISOString()}>{new Date(r.at).toLocaleString('ko-KR')}</time>
            <strong>{r.action}</strong>
            <AuditText text={describe(r.detail)} />
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
