// 방장 화면. 로그인 없이 누구나 방을 만들고, 만든 사람(방장)이 그 방 하나만 진행해요.
//   /new   만들기 전 설명 → 방 만들기        /host   방장 화면 (방 번호 + 방장 비밀번호로 다시 들어오기)
// 방 진행 화면은 관리자 화면의 것을 그대로 써요. 기관 설정 · 기록 · 다른 방은 관리자만 볼 수 있어요.
import { useEffect, useState, type FormEvent } from 'react'
import { LogOut } from 'lucide-react'
import { api, type Org } from './api'
import { OrgMark, Stamp, ThemeToggle, TopBar } from './parts'
import { Err, RoomForm, RoomPage, useAct, type Defaults } from './Admin'
import { Lost, Result, TimeLeft, useLive } from './parts'
import { Qr } from './Qr'
import { BellRing, MonitorUp, Plus, SkipForward, Square } from 'lucide-react'
import type { RoomState } from './api'

function useOrg() {
  const [org, setOrg] = useState<Org | null>(null)
  useEffect(() => {
    api<Org>('/api/org').then(setOrg, () => {})
  }, [])
  return org
}

/** /new — 만들기 전에 읽을 것 → 방 만들기 */
export function NewRoom() {
  const org = useOrg()
  const [read, setRead] = useState(false)
  const [step, setStep] = useState<'guide' | 'form'>('guide')
  if (!org) return null
  const days = org.keepDays ?? 7
  return (
    <div className="ad">
      <TopBar org={org}>
        <a className="top-link" href="/guide">
          안내
        </a>
      </TopBar>
      <main className="ad-main">
        {!org.open ? (
          <>
            <h1>지금은 관리자만 방을 만들 수 있어요</h1>
            <p>
              <a href="/">첫 화면으로</a>
            </p>
          </>
        ) : step === 'guide' ? (
          <>
            <div className="ad-head">
              <h1>방을 만들기 전에 읽어 주세요</h1>
            </div>
            <section className="card">
              <h2>이렇게 진행돼요</h2>
              <ol className="steps">
                <li>
                  <strong>방을 만들어요.</strong> 방 번호 6자리가 나와요. 참여할 사람들에게 방 번호를 알려 주거나 큰 화면의 QR 을 보여 주세요.
                </li>
                <li>
                  <strong>안건을 더하고 하나씩 열어요.</strong> 열면 모두의 화면에 픽 카드가 바로 나와요. 시간이 끝나거나 모두 픽하면 저절로 마감돼요.
                </li>
                <li>
                  <strong>결과를 함께 봐요.</strong> 마감되면 결과가 모두에게 한꺼번에 나와요.
                </li>
              </ol>
            </section>
            <section className="card">
              <h2>꼭 알아 두세요</h2>
              <ul className="rules">
                <li>
                  <Stamp />
                  누가 무엇을 골랐는지는 방장도 볼 수 없어요. 어디에도 남지 않아요.
                </li>
                <li>
                  <Stamp />한 번 연 안건은 고치거나 지울 수 없어요. 열기 전에 내용을 확인해 주세요.
                </li>
                <li>
                  <Stamp />
                  방은 마지막으로 쓴 뒤 <strong>{days}일</strong>이 지나면 안건 · 결과와 함께 자동으로 지워져요. 필요한 결과는 그 전에 적어 두세요.
                </li>
                <li>
                  <Stamp />
                  방장 비밀번호를 잃어버리면 되찾을 수 없어요. 다른 기기에서 방을 진행하려면 방 번호와 방장 비밀번호가 필요해요.
                </li>
                <li>
                  <Stamp />
                  남을 속이거나 괴롭히는 일에는 쓸 수 없어요. 참여자가 방을 신고할 수 있고, 그런 방은 관리자가 지우거나 방을 만든 곳에서 더 만들지 못하게 막을 수 있어요. 이를 위해 방을 만든 접속 주소를 알아볼 수 없게 바꿔 방이 지워질 때까지 보관해요.
                </li>
              </ul>
              <label className="check">
                <input type="checkbox" checked={read} onChange={(e) => setRead(e.target.checked)} />
                <span>모두 읽었어요. 이용약관에도 동의해요</span>
              </label>
              <p className="tip">
                <a href="/terms">이용약관</a> · <a href="/privacy">개인정보 처리방침</a>
              </p>
              <div className="actions">
                <a className="btn" href="/">
                  돌아가기
                </a>
                <button className="btn btn-primary" disabled={!read} onClick={() => setStep('form')}>
                  방 만들러 가기
                </button>
              </div>
            </section>
          </>
        ) : (
          <>
            <div className="ad-head">
              <h1>방 만들기</h1>
            </div>
            <section className="card">
              <RoomForm
                host
                defs={{ seconds: org.seconds ?? 60, grace: org.grace ?? 15, maxLogoMb: 0, siteUrl: '' }}
                submitLabel="방 만들기"
                onCancel={() => setStep('guide')}
                onSubmit={async (f) => {
                  await api('/api/host/create', 'POST', f)
                  location.href = '/host'
                }}
              />
            </section>
          </>
        )}
      </main>
    </div>
  )
}

/** /host — 내 방 진행하기 */
export function HostPage() {
  const org = useOrg()
  const [roomId, setRoomId] = useState<number | null | undefined>(undefined)
  const [role, setRole] = useState<string | null>(null)
  const [defs, setDefs] = useState<Defaults | null>(null)
  const check = () => api<{ roomId: number | null; role: string | null }>('/api/host/session').then((s) => (setRole(s.role), setRoomId(s.roomId)), () => setRoomId(null))
  useEffect(() => {
    check()
  }, [])
  useEffect(() => {
    if (roomId) api<Defaults>('/api/admin/defaults').then(setDefs, () => {})
  }, [roomId])
  if (roomId === undefined) return null
  if (!roomId) return <HostLogin org={org} onDone={check} />
  if (!defs) return null
  return (
    <div className="ad">
      <header className="ad-bar">
        <OrgMark org={org} />
        <strong className="ad-role">{role === 'cohost' ? '공동 진행자 화면' : '방장 화면'}</strong>
        <ThemeToggle />
        <button className="btn btn-quiet" onClick={() => api('/api/host/logout', 'POST').finally(() => (location.href = '/'))}>
          <LogOut size={18} aria-hidden="true" />
          나가기
        </button>
      </header>
      <main className="ad-main">
        <RoomPage key={roomId} id={roomId} defs={defs} onBack={() => (location.href = '/')} backLabel="첫 화면" />
      </main>
    </div>
  )
}

function HostLogin({ org, onDone }: { org: Org | null; onDone: () => void }) {
  const [room, setRoom] = useState('')
  const [hostPassword, setHostPassword] = useState('')
  const { act, error, busy } = useAct(onDone)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    act(() => api('/api/host/login', 'POST', { room, hostPassword }))
  }
  return (
    <main className="ad-login">
      <a className="org-link" href="/">
        <OrgMark org={org} />
      </a>
      <h1>방장으로 들어가기</h1>
      <form className="join" onSubmit={submit}>
        <label className="field">
          <span>방 번호</span>
          <input className="input input-code" inputMode="numeric" autoComplete="off" maxLength={6} placeholder="6자리 숫자" value={room} onChange={(e) => setRoom(e.target.value.replace(/\D/g, ''))} autoFocus />
        </label>
        <label className="field">
          <span>방장 비밀번호 (공동 진행자는 받은 비밀번호)</span>
          <input className="input" type="password" autoComplete="off" maxLength={100} value={hostPassword} onChange={(e) => setHostPassword(e.target.value)} />
        </label>
        <Err text={error} />
        <button className="btn btn-primary btn-big" disabled={busy}>
          들어가기
        </button>
      </form>
      {org?.open && (
        <p className="tip">
          아직 방이 없나요? <a href="/new">방 만들기</a>
        </p>
      )}
    </main>
  )
}

/** 휴대폰 리모컨 (/remote): 진행자가 한 손으로 누르는 큰 버튼만. 관리자는 방 화면의 ‘휴대폰 리모컨’으로, 방장은 들어와 있으면 바로 열려요. */
export function Remote() {
  const fromHash = Number(/^#room-(\d+)$/.exec(location.hash)?.[1]) || null
  const [roomId, setRoomId] = useState<number | null | undefined>(undefined)
  useEffect(() => {
    api<{ roomId: number | null }>('/api/host/session').then((s) => setRoomId(s.roomId ?? fromHash), () => setRoomId(fromHash))
  }, [])
  if (roomId === undefined) return null
  if (!roomId)
    return (
      <Lost title="먼저 진행자로 들어가 주세요">
        <a href="/host">내가 만든 방 진행하기</a>에서 방 번호와 비밀번호로 들어온 뒤 다시 열어 주세요.
      </Lost>
    )
  return <RemotePad id={roomId} />
}

const SCREEN: [RoomState['room']['screenMode'], string][] = [
  ['auto', '자동'],
  ['join', '입장 안내'],
  ['result', '마지막 결과'],
]
function RemotePad({ id }: { id: number }) {
  const live = useLive(
    () => api<RoomState>(`/api/admin/rooms/${id}`),
    (s) => `/api/events?room=${s.room.code}`,
  )
  const { act, error, busy } = useAct(live.refresh)
  const [notice, setNotice] = useState('')
  const s = live.state
  if (!live.ready) return null
  if (!s)
    return (
      <Lost title="이 방을 진행할 수 없어요">
        방이 지워졌거나 로그인이 풀렸어요. <a href="/host">다시 들어가기</a>
      </Lost>
    )
  const open = s.items.find((i) => i.status === 'open')
  const next = s.items.find((i) => i.status === 'draft')
  const post = (path: string, body?: unknown) => act(() => api(path, 'POST', body))
  const last = [...s.items].reverse().find((i) => i.status === 'closed')
  const top = last ? Math.max(0, ...last.options.map((o) => o.votes ?? 0)) : 0
  const tied = !!last && top > 0 && last.options.filter((o) => o.votes === top).length > 1
  return (
    <main className="remote" data-tone={s.room.tone || undefined}>
      <header>
        <strong>{s.room.title}</strong>
        <span>
          방 번호 {s.room.code}, 들어온 {s.joined}명, 지금 접속 {s.present}명{!live.online && ' (다시 연결하는 중)'}
        </span>
      </header>

      <section className="remote-now" aria-live="polite">
        {open ? (
          <>
            <p className="remote-label">지금 열려 있어요</p>
            <h1>{open.title}</h1>
            <p className="remote-count">
              <strong>{open.voted}</strong> / {s.joined}명 참여
            </p>
            <TimeLeft item={open} skew={s.skew} />
          </>
        ) : next ? (
          <>
            <p className="remote-label">다음 안건</p>
            <h1>{next.title}</h1>
            <p className="remote-count">
              안건 {s.agenda.total}개 중 {s.agenda.done}개 끝남
            </p>
          </>
        ) : (
          <h1>{s.room.closed ? '끝난 방이에요' : '남은 안건이 없어요'}</h1>
        )}
      </section>

      <Err text={error} />
      <div className="remote-keys">
        {open ? (
          <>
            <button className="btn btn-primary remote-key" disabled={busy} onClick={() => confirm('지금 마감할까요?') && post(`/api/admin/items/${open.id}/close`)}>
              <Square size={26} aria-hidden="true" />
              지금 마감
            </button>
            {open.closesAt && (
              <div className="remote-pair">
                <button className="btn remote-key" disabled={busy} onClick={() => post(`/api/admin/items/${open.id}/extend`, { seconds: 30 })}>
                  <Plus size={22} aria-hidden="true" />
                  30초 더
                </button>
                <button className="btn remote-key" disabled={busy} onClick={() => post(`/api/admin/items/${open.id}/extend`, { seconds: 60 })}>
                  <Plus size={22} aria-hidden="true" />
                  1분 더
                </button>
              </div>
            )}
            <button className="btn remote-key" disabled={busy} onClick={() => post(`/api/admin/items/${open.id}/nudge`)}>
              <BellRing size={26} aria-hidden="true" />안 한 사람에게 알리기
            </button>
          </>
        ) : (
          next &&
          !s.room.closed && (
            <button className="btn btn-primary remote-key" disabled={busy} onClick={() => confirm(`‘${next.title}’ 을 열까요?`) && post(`/api/admin/items/${next.id}/open`)}>
              <SkipForward size={26} aria-hidden="true" />
              다음 안건 열기
            </button>
          )
        )}
      </div>

      {/* 지금 볼 진행자 메모 · 방금 끝난 안건의 결과 */}
      {(open ?? next)?.memo && <p className="remote-memo">{(open ?? next)!.memo}</p>}
      {!open && last && (
        <section className="remote-last">
          <p className="remote-label">방금 끝난 안건</p>
          <strong>{last.title}</strong>
          <Result item={last} />
          {!s.room.closed && (
            <div className="actions actions-start">
              {tied && (
                <button className="btn btn-small" disabled={busy} onClick={() => post(`/api/admin/items/${last.id}/runoff`)}>
                  동점 결선 만들기
                </button>
              )}
              <button className="btn btn-small" disabled={busy} onClick={() => post(`/api/admin/items/${last.id}/copy`)}>
                복사해서 다시
              </button>
            </div>
          )}
        </section>
      )}

      <details className="remote-more">
        <summary>
          안건 목록 ({s.agenda.done} / {s.agenda.total})
        </summary>
        <ol>
          {s.items.map((it) => (
            <li key={it.id} className={`remote-item remote-${it.status}`}>
              <span>{{ draft: '준비', open: '열림', closed: '마감' }[it.status]}</span>
              <strong>{it.title}</strong>
              {it.status === 'draft' && !open && !s.room.closed && (
                <button className="btn btn-small" disabled={busy} onClick={() => confirm(`‘${it.title}’ 을 열까요?`) && post(`/api/admin/items/${it.id}/open`)}>
                  열기
                </button>
              )}
            </li>
          ))}
        </ol>
      </details>

      {!s.room.closed && (
        <>
          <details className="remote-more">
            <summary>입장 QR 보여 주기</summary>
            <div className="remote-qr">
              <Qr text={`${location.origin}/?room=${s.room.code}`} />
              <p>
                방 번호 <strong>{s.room.code}</strong>
              </p>
            </div>
          </details>
          <details className="remote-more">
            <summary>큰 화면 · 입장</summary>
            <div className="remote-screen">
              <div className="seg" role="group" aria-label="큰 화면에 띄울 것">
                {SCREEN.map(([m, name]) => (
                  <button key={m} className="seg-btn" aria-pressed={s.room.screenMode === m} disabled={busy} onClick={() => post(`/api/admin/rooms/${id}/screen`, { mode: m })}>
                    {name}
                  </button>
                ))}
              </div>
              <input className="input" maxLength={120} placeholder="큰 화면에 띄울 공지" aria-label="큰 화면에 띄울 공지" value={notice} onChange={(e) => setNotice(e.target.value)} />
              <button className="btn btn-small" disabled={busy || !notice.trim()} onClick={() => post(`/api/admin/rooms/${id}/screen`, { mode: 'notice', notice })}>
                공지 띄우기
              </button>
              <button className="btn btn-small" disabled={busy} onClick={() => post(`/api/admin/rooms/${id}/lock`, { locked: !s.room.locked })}>
                {s.room.locked ? '입장 다시 열기' : '입장 마감'}
              </button>
            </div>
          </details>
        </>
      )}
      <footer>
        <a className="link" href={s.admin?.role === 'admin' ? `/admin#room-${id}` : '/host'}>
          전체 진행 화면으로
        </a>
      </footer>
    </main>
  )
}
