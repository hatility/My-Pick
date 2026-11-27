// 이용 가이드 (/guide): 참여하기 · 진행하기 (단계마다 화면 조각 그림) · 알아 두면 좋은 것 · 비밀 보장 · 자주 묻는 것.
// 첫 화면은 ‘들어가기’만 남기고, 읽을거리는 모두 여기로 옮겼어요.
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { ALargeSmall, Eye, FlaskConical, Hand, Keyboard, KeyRound, MessageCircleQuestion, ShieldCheck, Smartphone, Smile } from 'lucide-react'
import { api, type Org } from './api'
import { HomeFoot, Stamp, TopBar } from './parts'
import { HeroArt } from './art'

type Checked = { same: boolean; logged: boolean; room: string; title: string; practice: boolean; options: { label: string; votes: number }[]; voted: number; eligible: number; abstain: number; closedAt: number; outcome: 'pass' | 'fail' | null }

/** 가이드의 한 단계: 왼쪽에 할 일, 오른쪽에 그 화면 조각 */
function Step({ title, demo, children }: { title: string; demo: ReactNode; children: ReactNode }) {
  return (
    <li>
      <div className="howto-text">
        <strong>{title}</strong>
        <p>{children}</p>
      </div>
      {demo}
    </li>
  )
}
const Tip = ({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) => (
  <li>
    <span className="tips-icon">{icon}</span>
    <strong>{title}</strong>
    <p>{children}</p>
  </li>
)
/** 화면 조각 그림: 실제 화면의 모양만 작게 옮겨 그린 것 (눌리지 않아요, 화면을 읽어 주는 프로그램은 건너뛰어요) */
const Demo = ({ className = '', children }: { className?: string; children: ReactNode }) => (
  <div className={`demo ${className}`} aria-hidden="true">
    {children}
  </div>
)
const Bar = ({ value }: { value: number }) => (
  <svg viewBox="0 0 100 6" preserveAspectRatio="none">
    <rect className="demo-track" width="100" height="6" rx="3" />
    <rect className="demo-fill" width={value} height="6" rx="3" />
  </svg>
)
const DemoJoin = () => (
  <Demo>
    <span className="demo-label">방 번호</span>
    <span className="demo-input">737163</span>
    <span className="demo-btn demo-primary">다음</span>
  </Demo>
)
const DemoCard = () => (
  <Demo className="demo-sheet">
    <span className="demo-title">축제 주제를 골라 주세요</span>
    <span className="demo-row">
      우주 여행 <i className="demo-box" />
    </span>
    <span className="demo-row demo-on">
      레트로 게임 <Stamp className="demo-stamp" />
    </span>
    <span className="demo-btn demo-primary">픽하기</span>
  </Demo>
)
const DemoConfirm = () => (
  <Demo className="demo-confirm">
    <span className="demo-q">‘레트로 게임’ 고를까요?</span>
    <span className="demo-note">확정하면 바꿀 수 없어요.</span>
    <span className="demo-btns">
      <span className="demo-btn">다시 고르기</span>
      <span className="demo-btn demo-primary">픽 확정</span>
    </span>
  </Demo>
)
const DemoResult = () => (
  <Demo>
    {(
      [
        ['우주 여행', 8, 30, false],
        ['레트로 게임', 14, 52, true],
        ['숲속 캠핑', 4, 15, false],
      ] as const
    ).map(([name, n, pct, win]) => (
      <span key={name} className={`demo-bar${win ? ' demo-win' : ''}`}>
        <span>
          {win && <Stamp className="demo-stamp-sm" />}
          {name}
          <b>{n}명</b>
        </span>
        <Bar value={(n / 14) * 100} />
      </span>
    ))}
  </Demo>
)
const DemoNewRoom = () => (
  <Demo>
    <span className="demo-label">방 이름</span>
    <span className="demo-input demo-text">가을 축제 준비</span>
    <span className="demo-label">방장 비밀번호</span>
    <span className="demo-input demo-text">••••••</span>
    <span className="demo-btn demo-primary">방 만들기</span>
  </Demo>
)
const DemoOptions = () => (
  <Demo>
    <span className="demo-label">선택지</span>
    {['우주 여행', '레트로 게임', '숲속 캠핑'].map((o, i) => (
      <span key={o} className="demo-opt">
        <b>{i + 1}</b>
        <span className="demo-input demo-text">{o}</span>
      </span>
    ))}
    <span className="demo-btn demo-small">+ 선택지 더하기</span>
  </Demo>
)
const DemoScreen = () => (
  <Demo className="demo-screen">
    <svg className="demo-qr" viewBox="0 0 21 21">
      <path d="M0 0h7v7H0zM2 2v3h3V2zM14 0h7v7h-7zm2 2v3h3V2zM0 14h7v7H0zm2 2v3h3v-3zM9 1h2v2H9zm0 4h3v2H9zm-1 4h4v2H8zm6 1h3v2h-3zm4-1h3v3h-2v-1h-1zM9 13h2v3H9zm4 1h2v2h-2zm4 1h4v2h-4zm-4 4h3v2h-3zm5 0h3v2h-3zM1 9h4v2H1z" />
    </svg>
    <span>
      <span className="demo-label">방 번호</span>
      <span className="demo-code">737163</span>
      <span className="demo-btn demo-small">입장 마감</span>
    </span>
  </Demo>
)
const DemoRun = () => (
  <Demo>
    <span className="demo-time">
      <span>남은 시간</span>
      <b>1:58</b>
    </span>
    <Bar value={82} />
    <span className="demo-btns">
      <span className="demo-btn demo-primary">다음 주제 열기</span>
    </span>
    <span className="demo-btns">
      <span className="demo-btn demo-small">잠깐 멈추기</span>
      <span className="demo-btn demo-small">지금 마감</span>
    </span>
  </Demo>
)
const DemoKeep = () => (
  <Demo>
    <span className="demo-btn demo-small demo-menu-btn">결과 남기기 ▾</span>
    <span className="demo-menu">
      <span>결과 내려받기</span>
      <span>결과 인쇄</span>
      <span>결과 정리 인쇄</span>
    </span>
  </Demo>
)

export function Guide() {
  const [org, setOrg] = useState<Org | null>(null)
  useEffect(() => {
    api<Org>('/api/org').then(setOrg, () => {})
    document.title = '이용 가이드 · My Pick'
  }, [])
  const days = org?.keepDays ?? 7
  const faq: [string, string][] = [
    ['픽한 뒤에 바꿀 수 있나요?', '아니요. ‘픽 확정’을 누르면 바꿀 수 없어요. 그래서 확정하기 전에 한 번 더 물어봐요.'],
    ['새로고침하거나 인터넷이 끊기면 어떻게 되나요?', '이미 한 픽은 그대로 남아요. 다시 열면 이어서 할 수 있고, 같은 주제에 두 번 픽할 수는 없어요.'],
    ['시간 안에 픽하지 못하면요?', '그 주제는 픽하지 않은 것으로 세요. 다음 주제부터 다시 참여할 수 있어요.'],
    ['이름이나 전화번호를 적어야 하나요?', '아니요. 개인정보를 받지 않아요. 이 브라우저에 ‘들어왔다’는 표시 하나만 남겨요.'],
    ['같은 사람이 두 번 픽할 수는 없나요?', '한 번 들어온 브라우저는 한 주제에 한 번만 고를 수 있어요. 더 엄격하게 하려면 방을 만들 때 ‘엄격’ 방식을 골라 한 사람에게 입장 코드를 하나씩 나눠 주세요. 입장 코드는 한 번만 쓸 수 있어서, 남이 코드를 보고 따라 넣어도 들어올 수 없어요.'],
    ['휴대폰 화면이 저절로 꺼지나요?', '방에 들어와 있는 동안에는 화면이 꺼지지 않게 해 둬요. 다음 주제가 열린 것을 놓치지 않게요. 브라우저나 배터리 절약 모드에 따라 꺼질 수도 있어요.'],
    ['질문이 있는데 손을 들기 어려워요.', '‘질문 있어요’를 누르면 진행자에게 몇 명인지만 조용히 전해져요. 누가 눌렀는지는 진행자도 몰라요.'],
    ['글자가 너무 작아요.', '위쪽 ‘가’ 단추를 누르면 글자가 커져요. 한 번 더 누르면 더 커져요.'],
    ['‘잠깐 멈췄어요’라고 나와요.', '진행자가 설명하는 동안 잠깐 멈춘 거예요. 남은 시간은 그대로이고, 다시 시작하면 바로 고를 수 있어요.'],
    ['입장 코드를 넣었는데 이미 쓴 코드라고 나와요.', '입장 코드는 한 번만 쓸 수 있어요. 기기를 바꿨거나 화면을 닫았다면 진행자에게 종이 코드를 보여 주세요. 다시 열어 줘요.'],
    ['결과는 언제 볼 수 있나요?', '주제가 마감되면 모두에게 한꺼번에 나와요. 방을 만들 때 ‘실시간 공개’를 켠 방만 픽 받는 중에도 보여요.'],
    ...(org?.open ? ([['만든 방은 언제 지워지나요?', `마지막으로 쓴 뒤 ${days}일이 지나면 주제 · 결과와 함께 자동으로 지워져요. 필요한 결과는 방장 화면에서 내려받거나 인쇄해 두세요.`]] as [string, string][]) : []),
  ]
  return (
    <div className="home">
      <TopBar org={org}>
        <a className="top-link" href="/">
          참여하러 가기
        </a>
      </TopBar>
      <main className="guide">
        <header className="guide-head">
          <h1>My Pick 이용 가이드</h1>
          <p>처음이라도 이대로 따라 하면 돼요. 가입도, 앱 설치도 필요 없어요.</p>
          <nav className="guide-nav" aria-label="가이드 차례">
            <a href="#join">참여하기</a>
            <a href="#host">진행하기</a>
            <a href="#tips">알아 두면 좋은 것</a>
            <a href="#secret">비밀 보장</a>
            <a href="#faq">자주 묻는 것</a>
          </nav>
        </header>

        <section id="join" className="guide-sec">
          <h2>참여하기</h2>
          <ol className="howto">
            <Step title="방 번호를 넣어요" demo={<DemoJoin />}>
              진행자가 알려 준 6자리 숫자예요. 큰 화면의 QR 을 휴대폰 카메라로 찍으면 번호가 들어가 있어요.
            </Step>
            <Step title="하나를 누르고 ‘픽하기’" demo={<DemoCard />}>
              주제가 열리면 픽 카드가 저절로 나와요. 고를 것을 누르면 도장이 찍혀요.
            </Step>
            <Step title="한 번 더 확인해요" demo={<DemoConfirm />}>
              ‘픽 확정’을 누르면 바꿀 수 없어요. 아니면 ‘다시 고르기’.
            </Step>
            <Step title="결과를 함께 봐요" demo={<DemoResult />}>
              시간이 끝나거나 모두 픽하면 마감되고, 결과가 모두에게 한꺼번에 나와요. 누가 무엇을 골랐는지는 아무도 몰라요.
            </Step>
          </ol>
          <div className="actions actions-start">
            <a className="btn btn-primary" href="/">
              참여하러 가기
            </a>
          </div>
        </section>

        <section id="host" className="guide-sec">
          <h2>진행하기</h2>
          <ol className="howto">
            <Step title="방을 만들어요" demo={<DemoNewRoom />}>
              {org?.open ? '‘방 만들기’에서 방 이름과 방장 비밀번호만 정하면 방 번호가 바로 나와요.' : '관리자 화면의 ‘새 방 만들기’에서 방 이름만 정하면 방 번호가 나와요.'}
            </Step>
            <Step title="주제를 더해요" demo={<DemoOptions />}>
              주제 제목을 적고 선택지를 칸마다 하나씩 적어요. 엔터를 누르면 다음 칸이 생기고, ‘찬성 / 반대’ 같은 자주 쓰는 모양도 있어요.
            </Step>
            <Step title="사람들을 불러요" demo={<DemoScreen />}>
              ‘큰 화면 열기’로 QR 과 방 번호를 빔프로젝터 · TV 에 띄워요. 다 모이면 ‘입장 마감’.
            </Step>
            <Step title="하나씩 열고 마감해요" demo={<DemoRun />}>
              ‘다음 주제 열기’를 누르면 모두의 화면에 나와요. 설명이 더 필요하면 ‘잠깐 멈추기’. 모두 픽하거나 시간이 끝나면 저절로 마감돼요.
            </Step>
            <Step title="결과를 남겨요" demo={<DemoKeep />}>
              ‘결과 남기기’에서 내려받기 · 인쇄 · 결과 정리 인쇄를 골라요. 주제마다 ‘결과 그림 받기’도 있어요.
              {org?.open && ` 방장이 만든 방은 마지막으로 쓴 뒤 ${days}일이 지나면 지워져요.`}
            </Step>
          </ol>
          {org?.open && (
            <div className="actions actions-start">
              <a className="btn btn-primary" href="/new">
                방 만들기
              </a>
              <a className="btn" href="/host">
                내가 만든 방 진행하기
              </a>
            </div>
          )}
        </section>

        <section id="tips" className="guide-sec">
          <h2>알아 두면 좋은 것</h2>
          <h3 className="tips-head">참여하는 사람</h3>
          <ul className="tips">
            <Tip icon={<MessageCircleQuestion size={20} aria-hidden="true" />} title="조용한 손들기">
              ‘질문 있어요 · 더 설명해 주세요’를 누르면 진행자에게 몇 명인지만 전해져요. 누가 눌렀는지는 몰라요.
            </Tip>
            <Tip icon={<ALargeSmall size={20} aria-hidden="true" />} title="글자 크기">
              위쪽 ‘가’ 단추를 누를 때마다 크게 · 아주 크게로 바뀌어요.
            </Tip>
            <Tip icon={<Hand size={20} aria-hidden="true" />} title="한 손 모드">
              손 모양 단추를 누르면 고를 것이 엄지가 닿는 아래쪽으로 모여요.
            </Tip>
            <Tip icon={<ShieldCheck size={20} aria-hidden="true" />} title="결과 확인 코드">
              마감 때 나오는 12자리를 적어 두면 <a href="/verify">결과 확인</a>에서 결과가 그대로인지 볼 수 있어요.
            </Tip>
          </ul>
          <h3 className="tips-head">진행하는 사람</h3>
          <ul className="tips">
            <Tip icon={<Smartphone size={20} aria-hidden="true" />} title="휴대폰 리모컨">
              진행 화면의 ‘휴대폰 리모컨’을 휴대폰으로 열면 걸어 다니며 열기 · 멈추기 · 마감을 해요. 손든 사람도 여기에 떠요.
            </Tip>
            <Tip icon={<Keyboard size={20} aria-hidden="true" />} title="PC 단축키">
              스페이스 멈춤 · 다시, N 다음 주제, M 지금 마감, T 30초 더, ? 도움말.
            </Tip>
            <Tip icon={<FlaskConical size={20} aria-hidden="true" />} title="리허설">
              ‘준비’의 ‘리허설 해 보기’로 가짜 참여자 10명과 미리 한 바퀴 돌려 봐요. 통계에 들어가지 않아요.
            </Tip>
            <Tip icon={<KeyRound size={20} aria-hidden="true" />} title="한 사람 한 번 (엄격 방식)">
              입장 코드를 한 사람에 하나씩 나눠 줘요. 코드는 한 번만 쓸 수 있고, 기기를 바꾼 사람은 종이 코드를 확인한 뒤 ‘다시 열기’.
            </Tip>
            <Tip icon={<Eye size={20} aria-hidden="true" />} title="지켜보기 주소">
              참관할 사람에게 주면 진행 상황 · 결과 · 기록만 볼 수 있어요. 빔프로젝터용 ‘큰 화면 모드’도 있어요.
            </Tip>
            <Tip icon={<Smile size={20} aria-hidden="true" />} title="쉬운 말 모드">
              어린 참여자가 많을 때 방 설정에서 켜면 참여 화면의 글자가 커지고 문장이 짧아져요.
            </Tip>
          </ul>
        </section>

        <section id="secret" className="guide-sec">
          <h2>비밀은 이렇게 지켜요</h2>
          <p>픽하면 두 가지가 서로 다른 곳에 따로 적혀요. 둘을 잇는 것은 어디에도 남기지 않아요.</p>
          <div className="split">
            <div className="split-card">
              <h3>누가 픽했는지</h3>
              <ul>
                <li>
                  <Stamp /> 3번 참가자
                </li>
                <li>
                  <Stamp /> 7번 참가자
                </li>
                <li>
                  <Stamp /> 12번 참가자
                </li>
              </ul>
              <p>한 사람이 두 번 픽하지 못하게 하는 데만 써요.</p>
            </div>
            <div className="split-gap" aria-hidden="true">
              이어지지 않아요
            </div>
            <div className="split-card">
              <h3>무엇을 몇 명이 골랐는지</h3>
              <ul className="split-count">
                <li>
                  찬성 <strong>2명</strong>
                </li>
                <li>
                  반대 <strong>1명</strong>
                </li>
              </ul>
              <p>고른 것을 하나하나 남기지 않고 숫자만 올려요.</p>
            </div>
          </div>
          <ul className="guide-points">
            <li>진행자와 관리자도 누가 무엇을 골랐는지 볼 수 없어요. 저장 파일을 열어 봐도 없어요.</li>
            <li>‘마감 뒤에 공개’ 방에서는 진행자도 픽이 끝나기 전에 결과를 볼 수 없어요.</li>
            <li>한 번 연 주제는 고치거나 지울 수 없고, 진행자가 한 일은 기록으로 남아요.</li>
            <li>참가자가 아주 적거나 모두 같은 것을 고르면, 결과만으로 짐작될 수는 있어요.</li>
          </ul>
        </section>

        <section id="faq" className="guide-sec">
          <h2>자주 묻는 것</h2>
          <div className="faq">
            {faq.map(([q, a]) => (
              <details key={q}>
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>
      <HomeFoot org={org} />
    </div>
  )
}

/** 결과 확인 (/verify): 마감 때 받은 코드를 넣으면, 지금 저장된 결과가 그때와 같은지 알려 줘요. */
export function Verify() {
  const [org, setOrg] = useState<Org | null>(null)
  const [code, setCode] = useState(new URLSearchParams(location.search).get('code') ?? '')
  const [found, setFound] = useState<Checked | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const check = async (value: string) => {
    setBusy(true)
    setError('')
    setFound(null)
    try {
      setFound(await api<Checked>(`/api/verify?code=${encodeURIComponent(value)}`))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    api<Org>('/api/org').then(setOrg, () => {})
    document.title = '결과 확인 · My Pick'
    if (code) check(code)
  }, [])
  const submit = (e: FormEvent) => {
    e.preventDefault()
    check(code)
  }
  return (
    <div className="home">
      <TopBar org={org}>
        <a className="top-link" href="/guide">
          가이드
        </a>
      </TopBar>
      <main className="guide">
        <header className="guide-head">
          <h1>결과 확인</h1>
          <p>주제가 마감될 때 화면에 나온 ‘결과 확인 코드’를 넣어 보세요. 지금 저장된 결과가 그때와 같은지 알려 드려요.</p>
        </header>
        <section className="guide-sec">
          <form className="join" onSubmit={submit}>
            <label className="field">
              <span>결과 확인 코드 (12자리)</span>
              <input className="input input-code" autoComplete="off" autoCapitalize="characters" maxLength={14} placeholder="ABCD-EFGH-JKLM" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoFocus />
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="btn btn-primary btn-big" disabled={busy || code.replace(/[^A-Z0-9]/g, '').length < 12}>
              확인하기
            </button>
          </form>
        </section>
        {found && (
          <section className="guide-sec" aria-live="polite">
            <p className={`seal ${found.same && found.logged ? 'seal-ok' : 'seal-bad'}`}>
              <Stamp />
              {found.same && !found.logged ? '숫자는 마감 때 그대로지만, 이 마감이 기록에 남아 있지 않거나 기록이 어긋나 있어요. 관리자에게 알려 주세요.' : found.same ? '마감했을 때의 결과 그대로예요. 이 마감은 기록에도 그대로 남아 있어요.' : '마감한 뒤에 결과가 바뀌었어요. 아래 숫자는 믿을 수 없어요. 진행자나 관리자에게 알려 주세요.'}
            </p>
            <div>
              <p className="tip">{found.room}</p>
              <h2>
                {found.practice && <span className="tag">연습</span>}
                {found.title}
              </h2>
            </div>
            <table className="sheet-table">
              <tbody>
                {found.options.map((o) => (
                  <tr key={o.label}>
                    <th scope="row">{o.label}</th>
                    <td>{o.votes}명</td>
                  </tr>
                ))}
                <tr>
                  <th scope="row">건너뜀</th>
                  <td>{found.abstain}명</td>
                </tr>
              </tbody>
            </table>
            <p className="tip">
              들어온 {found.eligible}명 중 {found.voted}명 픽, {new Date(found.closedAt).toLocaleString('ko-KR', { dateStyle: 'long', timeStyle: 'short' })} 마감
              {found.outcome ? `, ${found.outcome === 'pass' ? '통과' : '통과 못 함'}` : ''}
            </p>
          </section>
        )}
        <section className="guide-sec">
          <h2>이 코드는 무엇인가요?</h2>
          <ul className="guide-points">
            <li>주제가 마감되는 순간의 결과 전체(선택지, 받은 픽, 인원, 시각)로 만든 12자리예요. 숫자가 하나라도 달라지면 전혀 다른 코드가 돼요.</li>
            <li>마감 때 큰 화면이나 내 화면에 나온 코드를 적어 두거나 사진으로 남겨 두세요. 그것이 나중에 견줄 증거예요.</li>
            <li>누가 무엇을 골랐는지는 이 코드로도 알 수 없어요.</li>
            <li>방이 지워진 뒤에는 확인할 수 없어요.</li>
          </ul>
        </section>
      </main>
      <HomeFoot org={org} />
    </div>
  )
}

// ── 이용약관 · 개인정보 처리방침 ──
// 실제로 서버가 하는 일에 맞춰 적었어요. 숫자(보관 기간 등)는 .env 설정을 그대로 읽어 보여 줘요.
const EFFECTIVE = '2026년 11월 27일'
function useDoc(title: string) {
  const [org, setOrg] = useState<Org | null>(null)
  useEffect(() => {
    api<Org>('/api/org').then(setOrg, () => {})
    document.title = `${title} · My Pick`
  }, [])
  return org
}
function DocPage({ org, title, lead, children }: { org: Org | null; title: string; lead: string; children: React.ReactNode }) {
  return (
    <div className="home">
      <TopBar org={org}>
        <a className="top-link" href="/guide">
          가이드
        </a>
      </TopBar>
      <main className="guide doc">
        <header className="guide-head">
          <h1>{title}</h1>
          <p>{lead}</p>
          <p className="tip">시행일 {EFFECTIVE}</p>
        </header>
        {children}
      </main>
      <HomeFoot org={org} />
    </div>
  )
}
const Contact = ({ org }: { org: Org | null }) => (
  <p>
    {org?.name ?? '운영 기관'}
    {org?.contact ? ` (${org.contact})` : '. 연락처는 이 서비스를 안내한 담당자에게 물어 주세요.'}
  </p>
)

export function Terms() {
  const org = useDoc('이용약관')
  const days = org?.keepDays ?? 7
  const who = org?.name ?? '운영 기관'
  return (
    <DocPage org={org} title="이용약관" lead="My Pick 을 쓰기 전에 알아 둘 약속이에요. 방을 만들거나 방에 들어오면 이 약관에 동의한 것으로 봐요.">
      <section className="guide-sec">
        <h2>1. My Pick 은</h2>
        <p>방 번호로 모여 여럿이 함께 고르고 결과를 같이 보는 서비스예요. {who}이 운영하고, 가입 없이 누구나 쓸 수 있어요.</p>
        <p>모임 · 수업 · 행사에서 의견을 모으는 데 쓰도록 만들었어요. 법이나 규정으로 절차가 정해진 공식 선거 · 표결의 수단으로 쓰도록 만든 서비스가 아니에요. 그런 곳에 쓴 결과에 대해 운영자는 책임지지 않아요.</p>
      </section>
      <section className="guide-sec">
        <h2>2. 방을 만든 사람(진행자)의 책임</h2>
        <ul className="guide-points">
          <li>방 이름 · 주제 · 선택지의 내용과, 참여자에게 하는 안내는 방을 만든 사람(방장)이 책임져요.</li>
          <li>주제를 언제 열고, 잠깐 멈추고, 시간을 늘리고, 마감할지는 진행자가 정해요.</li>
          <li>결과를 어디에 어떻게 쓸지, 내려받은 결과 · 인쇄물 · 결과 그림을 어디에 올리거나 나눌지는 방장과 그 모임이 정하고 책임져요.</li>
          <li>지켜보기 주소를 받은 사람은 그 방의 진행 상황 · 결과 · 진행 기록을 볼 수 있어요. 누구에게 줄지는 방장이 정해요.</li>
          <li>방장 비밀번호와 공동 진행자 비밀번호는 방장이 관리해요. 잃어버리면 되찾을 수 없어요.</li>
          <li>방장이 만든 방은 마지막으로 쓴 뒤 {days}일이 지나면 주제 · 결과와 함께 자동으로 지워져요. 필요한 결과는 그 전에 내려받거나 인쇄해 두세요.</li>
        </ul>
      </section>
      <section className="guide-sec">
        <h2>3. 하면 안 되는 일</h2>
        <ul className="guide-points">
          <li>남을 속이거나, 괴롭히거나, 따돌리거나, 차별 · 혐오하는 내용을 올리는 일</li>
          <li>방 이름 · 주제 · 선택지 · 의견에 다른 사람의 이름 · 연락처 같은 개인정보나 사생활을 적는 일</li>
          <li>법을 어기는 일에 쓰는 일</li>
          <li>프로그램으로 마구 접속하거나, 여러 번 참여하려고 꾀를 쓰거나, 서비스를 방해하는 일</li>
          <li>방 번호 · 입장 코드 · 비밀번호를 마구 넣어 보거나, 일부러 틀려서 다른 사람이 들어오지 못하게 하는 일</li>
          <li>남의 입장 코드를 쓰거나, 손들기 · 확인 요청 · 신고 · 오류 제보를 장난으로 되풀이하는 일</li>
          <li>운영자나 다른 단체인 척하는 일</li>
        </ul>
      </section>
      <section className="guide-sec">
        <h2>4. 운영자가 할 수 있는 일</h2>
        <ul className="guide-points">
          <li>참여자는 방을 신고할 수 있고, 운영자는 신고된 방을 확인해요.</li>
          <li>3번에 해당하는 방은 미리 알리지 않고 지울 수 있고, 그 방을 만든 곳에서 한동안 방을 만들지 못하게 막을 수 있어요.</li>
          <li>쓸 수 없는 말을 정해 누구나 만드는 방의 이름 · 주제 · 선택지에 쓰지 못하게 할 수 있어요.</li>
          <li>방 번호 · 입장 코드 · 비밀번호를 여러 번 틀린 기기나 접속 주소는 잠깐 막아요.</li>
          <li>진행자와 운영자가 한 일은 기록으로 남고, 나중에 고치거나 빼면 드러나게 해 둬요.</li>
          <li>운영자도 누가 무엇을 골랐는지는 볼 수 없어요.</li>
          <li>주제가 열려 있는 동안에는 진행자도 운영자도 받은 픽의 숫자를 볼 수 없어요 (픽 받는 중에도 공개하기로 정한 방은 모두에게 보여요). 그동안에는 저장 파일의 백업도 만들거나 내려받을 수 없어요.</li>
        </ul>
      </section>
      <section className="guide-sec">
        <h2>5. 결과와 책임의 한계</h2>
        <ul className="guide-points">
          <li>간편 방식 방(방 번호로 입장)은 사람을 구분하지 않아요. 같은 사람이 다른 기기로, 또는 다시 들어와 여러 번 참여할 수 있어요. 한 사람이 꼭 한 번만 참여해야 하면 엄격 방식(입장 코드)을 쓰세요.</li>
          <li>엄격 방식의 입장 코드는 한 번만 쓸 수 있어요. 기기를 바꾸거나 화면을 닫아 다시 들어와야 하면, 진행자가 코드를 직접 확인하고 다시 열어 줘야 해요. 코드를 잃어버리거나 남에게 보여 줘서 생긴 일은 본인 책임이에요.</li>
          <li>결과 확인 코드와 기록 지문은 결과와 기록이 바뀌지 않았는지 견줘 보는 수단이에요. 서버와 저장 파일을 모두 가진 사람이 통째로 바꾸는 것까지 막아 주지는 못해서, 중요한 자리에서는 마감 때의 화면을 사진이나 인쇄물로 남겨 두세요.</li>
          <li>인터넷이나 기기 문제로 시간 안에 픽하지 못한 경우, 그 주제는 참여하지 않은 것으로 세요.</li>
          <li>서버가 진행 중에 다시 켜져도 열려 있던 주제 · 남은 시간 · 받은 픽은 그대로 이어져요. 다만 그 사이에 보낸 픽은 닿지 않았을 수 있으니, 화면에 ‘픽했어요’ 가 보이는지 확인해 주세요.</li>
          <li>서비스는 있는 그대로 제공돼요. 점검 · 고장 · 사고로 멈추거나 자료가 사라질 수 있고, 운영자는 고의나 큰 잘못이 없는 한 그로 인한 손해를 책임지지 않아요.</li>
          <li>운영자는 서비스를 바꾸거나 그만둘 수 있어요. 그만둘 때는 첫 화면에 미리 알려요.</li>
        </ul>
      </section>
      <section className="guide-sec">
        <h2>6. 약관이 바뀌면</h2>
        <p>바뀐 내용과 시행일을 이 페이지에 미리 알려요. 바뀐 뒤에도 계속 쓰면 바뀐 약관에 동의한 것으로 봐요.</p>
        <p>최근에 바뀐 점 ({EFFECTIVE}): 방 번호 · 코드를 마구 넣어 보는 일을 하면 안 되는 일에 더했고, 주제가 열려 있는 동안 받은 픽과 백업을 볼 수 없다는 것, 간편 방식 방은 여러 번 참여할 수 있다는 것, 서버가 다시 켜질 때의 일을 분명히 적었어요.</p>
        <h2>7. 다툼이 생기면</h2>
        <p>먼저 아래 문의처로 {who}과 이야기해 풀어요. 그래도 풀리지 않으면 대한민국 법을 따라요.</p>
        <h2>8. 문의</h2>
        <Contact org={org} />
        <p className="tip">이 약관은 {EFFECTIVE}부터 시행해요 (My Pick 1.0.1). 처음 만든 날은 2026년 11월 26일이에요.</p>
      </section>
    </DocPage>
  )
}

export function Privacy() {
  const org = useDoc('개인정보 처리방침')
  const days = org?.keepDays ?? 7
  const rows: [string, string, string][] = [
    ['입장 표시 (쿠키)', '같은 사람이 한 주제에 한 번만 참여하게 하고, 새로고침해도 이어서 하게 하려고', `최대 ${org?.voterDays ?? 7}일, 또는 방이 지워질 때까지`],
    ['기기 표시 (쿠키)', '방 번호 · 코드를 여러 번 틀린 사람 때문에 같은 곳(학교 한 곳처럼 접속 주소가 같은 곳)의 다른 사람까지 막히지 않게, 틀린 횟수를 기기마다 따로 세려고. 아무 숫자와 만든 때뿐이라 누구인지 담기지 않아요. 참여자의 것은 서버에 저장하지 않아요', '30일 (기기에만)'],
    ['관리자가 로그인한 기기의 표시', '다른 사람이 비밀번호를 일부러 틀려도 관리자가 쓰던 기기는 잠기지 않게 하려고. 관리자 아이디와 그 기기의 표시(아무 숫자)를 함께 저장해요', '관리자를 뺄 때까지'],
    ['관리자 · 방장 · 공동 진행자의 로그인 표시', '서버가 다시 켜져도 로그인이 이어지게 하려고. 서버가 꺼질 때 알아볼 수 없게 바꾼 값으로 적어 뒀다가, 다시 켜지면 읽고 지워요', '로그인 기간이 끝날 때까지'],
    ['참여했는지 여부', '두 번 참여하는 것을 막으려고. 무엇을 골랐는지는 여기에 없어요', '방이 지워질 때까지'],
    ['입장 코드 (엄격 방식 방만)', '한 사람이 한 번만 참여하게 하려고. 코드는 한 번만 쓸 수 있고, 진행자가 다시 열어 준 일은 코드 끝 3자리만 기록에 남아요', '방이 지워질 때까지'],
    ['조용한 손들기 (질문 있어요 · 더 설명해 주세요)', '진행자에게 몇 명인지 알리려고. 누가 눌렀는지는 진행자에게 보이지 않아요', '저장하지 않아요. 다음 주제가 열리거나 진행자가 내리면, 또는 서버를 다시 켜면 사라져요'],
    ['방장 · 공동 진행자 비밀번호', '방을 진행할 사람인지 확인하려고. 알아볼 수 없게 바꿔 저장해요', '방이 지워질 때까지'],
    ['방을 만든 접속 주소를 바꾼 값', '문제 방을 만든 곳에서 더 만들지 못하게 막으려고. 주소 자체는 저장하지 않아요', '방이 지워질 때까지. 막은 경우에는 정한 기간(길게는 풀 때까지)'],
    ['신고 · 확인 요청으로 직접 적은 글', '운영자와 진행자가 확인하려고. 누가 적었는지는 진행자에게 보이지 않아요', '확인 요청은 방이 지워질 때까지, 신고는 운영자가 확인하고 지울 때까지'],
    ['오류 제보로 직접 적은 글, 보낸 화면의 주소(길만), 브라우저 종류', '오류를 찾아 고치려고. 이름 · 연락처 · 접속 주소는 받지 않아요', '운영자가 지울 때까지 (가장 많이 2,000개)'],
    ['관리자 아이디 · 비밀번호, 관리자 로그인(실패 포함)의 접속 주소', '관리자인지 확인하고, 누가 무엇을 했는지 · 누가 비밀번호를 맞혀 보려 했는지 기록하려고', '관리자를 뺄 때까지. 기록은 계속 남아요'],
    ['진행자 · 운영자가 한 일의 기록', '나중에 고치거나 빼면 드러나게 하려고. 주제를 마감한 순간의 결과(숫자)와 결과 확인 코드도 함께 남아요. 누가 무엇을 골랐는지는 없어요', '방이 지워진 뒤에도 계속 남아요'],
  ]
  return (
    <DocPage org={org} title="개인정보 처리방침" lead="My Pick 은 이름 · 전화번호 · 이메일 · 생년월일을 받지 않아요. 그래도 서비스가 돌아가려면 다루는 것이 있어서, 무엇을 왜 얼마 동안 다루고 어떻게 지키는지 적어요.">
      <section className="guide-sec">
        <h2>1. 가장 중요한 것</h2>
        <ul className="guide-points">
          <li>누가 무엇을 골랐는지는 저장하지 않아요. ‘누가 참여했는지’와 ‘무엇이 몇 명인지’를 따로 두고, 둘을 잇는 것은 남기지 않아요.</li>
          <li>광고 · 통계 · 글꼴 같은 바깥 서비스를 부르지 않아요. 접속한 사실이 다른 회사로 가지 않아요.</li>
          <li>다루는 것을 다른 곳에 주거나(제3자 제공) 맡기지(처리 위탁) 않아요. 법에 정해진 경우만 예외예요.</li>
          <li>지켜보기 화면에는 진행 상황 · 결과 · 그 방의 기록만 나와요. 관리자 계정 이름은 ‘운영자’로만 보이고, 참여자를 알아볼 수 있는 것은 나오지 않아요.</li>
        </ul>
      </section>
      <section className="guide-sec">
        <h2>2. 다루는 것 · 까닭 · 기간</h2>
        <div className="doc-table">
          <table className="sheet-table">
            <thead>
              <tr>
                <th scope="col">무엇을</th>
                <th scope="col">왜</th>
                <th scope="col">얼마 동안</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([what, why, how]) => (
                <tr key={what}>
                  <th scope="row">{what}</th>
                  <td>{why}</td>
                  <td>{how}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="guide-points">
          <li>방장이 만든 방은 마지막으로 쓴 뒤 {days}일이 지나면 위 내용과 함께 자동으로 지워져요.</li>
          <li>여러 번 틀린 접속이나 너무 잦은 요청을 막으려고 접속 주소나 기기 표시를 잠깐 기억하지만, 저장하지 않고 서버를 다시 켜면 사라져요.</li>
          <li>모든 자료는 {org?.name ?? '운영 기관'}이 운영하는 서버 한 곳에만 저장돼요.</li>
        </ul>
      </section>
      <section className="guide-sec">
        <h2>3. 지우는 때와 방법</h2>
        <ul className="guide-points">
          <li>위 표의 기간이 끝나면 저장 파일에서 지우고, 되살릴 수 없게 해요.</li>
          <li>{org?.backupDays ? `사고에 대비해 저장 파일을 하루에 한 번 떠 두고 최근 ${org.backupDays}일치만 보관해요. 지운 방도 그 기간에는 백업 안에 남아 있다가, 백업이 지워질 때 함께 사라져요.` : '저장 파일의 자동 백업은 꺼져 있어요.'}</li>
          <li>주제가 열려 있는 동안에는 백업을 새로 뜨지 않고, 이미 뜬 백업도 내려받을 수 없어요 (마감 전 숫자가 밖으로 나가지 않게).</li>
          <li>내려받은 결과 · 인쇄물 · 결과 그림처럼 서비스 밖으로 나간 것은 그것을 가진 사람이 관리하고 지워요.</li>
        </ul>
      </section>
      <section className="guide-sec">
        <h2>4. 쿠키와 내 기기에만 남는 것</h2>
        <ul className="guide-points">
          <li>쿠키는 네 가지만 써요: 참여자의 입장 표시, 방장 · 공동 진행자의 로그인, 관리자의 로그인, 기기 표시(틀린 횟수를 기기마다 따로 세는 데만 써요). 광고나 추적에 쓰는 쿠키는 없어요.</li>
          <li>기기 표시는 사이트를 처음 열 때 만들어져요. 어느 화면을 봤는지, 어느 방에 들어갔는지와 이어 두지 않아요.</li>
          <li>브라우저 설정에서 쿠키를 막을 수 있지만, 그러면 방에 들어가거나 진행할 수 없어요.</li>
          <li>화면 밝기, 글자 크기, 한 손 모드(와 그 안내를 본 적이 있는지), PC · 휴대폰 화면 가운데 고른 것, 지켜보기의 큰 화면 모드, 마감 때 본 결과 확인 코드, 방장의 주제 묶음은 쓰는 사람의 브라우저에만 저장돼요. 서버로 보내지 않고, 브라우저의 사이트 자료를 지우면 사라져요.</li>
          <li>결과 그림은 누른 사람의 브라우저 안에서 만들어져 그 기기에 저장돼요. 화면 꺼짐 막기는 브라우저 기능만 쓰고 아무것도 저장하지 않아요.</li>
        </ul>
      </section>
      <section className="guide-sec">
        <h2>5. 안전하게 지키는 방법</h2>
        <ul className="guide-points">
          <li>비밀번호는 그대로 저장하지 않고, 되돌릴 수 없게 바꿔(scrypt) 저장해요.</li>
          <li>관리 화면은 관리자만, 방 진행 화면은 그 방의 방장 · 공동 진행자만 열 수 있고, 여러 번 틀리면 잠깐 잠겨요.</li>
          <li>주제가 열려 있는 동안에는 받은 픽의 숫자를 진행자 · 운영자에게도 보여 주지 않고, 저장 파일의 백업도 내보내지 않아요 (픽 받는 중에도 공개하기로 정한 방은 빼고).</li>
          <li>진행 기록은 앞뒤를 잇고 열쇠로 봉해서, 저장 파일을 몰래 고치면 드러나요.</li>
          <li>바깥 서비스를 부르지 않고, 밖에서 쓸 때는 HTTPS(암호화된 연결)로 띄우도록 안내해요.</li>
        </ul>
      </section>
      <section className="guide-sec">
        <h2>6. 어린이 · 청소년</h2>
        <p>이름 · 연락처 같은 개인정보를 받지 않기 때문에, 만 14세 미만이 쓸 때 보호자 동의를 따로 받지 않아요. 방 이름 · 주제 · 의견에 자기나 다른 사람의 개인정보를 적지 않도록 진행자가 안내해 주세요.</p>
      </section>
      <section className="guide-sec">
        <h2>7. 내 권리</h2>
        <ul className="guide-points">
          <li>브라우저에서 이 사이트의 쿠키를 지우면 입장 표시가 사라져요.</li>
          <li>내가 만든 방은 방장 화면에서 언제든 지울 수 있어요.</li>
          <li>신고 · 확인 요청 · 오류 제보로 적은 글을 보거나 지워 달라고 하거나, 궁금한 점이 있으면 아래로 연락해 주세요. 늦지 않게 답해요.</li>
          <li>누가 무엇을 골랐는지는 어디에도 저장되지 않아서, 그것은 보여 드리거나 고칠 수 있는 것이 없어요.</li>
        </ul>
        <h2>8. 개인정보 보호책임자 · 문의</h2>
        <Contact org={org} />
        <h2>9. 방침이 바뀌면</h2>
        <p>바뀐 내용과 시행일을 이 페이지에 미리 알려요.</p>
        <p>최근에 바뀐 점 ({EFFECTIVE}): 기기 표시 쿠키, 관리자가 로그인한 기기의 표시, 서버가 다시 켜질 때의 로그인 표시를 표에 더했고, 주제가 열려 있는 동안에는 백업을 뜨거나 내려받지 않는다는 것을 적었어요.</p>
        <p className="tip">이 방침은 {EFFECTIVE}부터 시행해요 (My Pick 1.0.1). 처음 만든 날은 2026년 11월 26일이에요.</p>
      </section>
    </DocPage>
  )
}

/** 오류 제보 (/feedback): 누구나 오류나 바라는 점을 운영자에게 보내요. 이름 · 연락처는 받지 않아요. */
export function Feedback() {
  const org = useDoc('오류 제보')
  const [kind, setKind] = useState<'오류' | '바라는 점'>('오류')
  const [note, setNote] = useState('')
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle')
  const [error, setError] = useState('')
  // 어느 화면에서 왔는지 (바로 앞 화면의 길만. 방 번호 · 열쇠가 든 꼬리는 보내지 않아요)
  const from = (() => {
    try {
      const u = new URL(document.referrer)
      return u.host === location.host ? u.pathname.replace(/\d{6}/g, '') : ''
    } catch {
      return ''
    }
  })()
  const send = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setState('busy')
    try {
      await api('/api/feedback', 'POST', { kind, note, page: from })
      setState('done')
    } catch (err) {
      setError((err as Error).message)
      setState('idle')
    }
  }
  return (
    <div className="home">
      <TopBar org={org}>
        <a className="top-link" href="/guide">
          가이드
        </a>
      </TopBar>
      <main className="guide">
        <header className="guide-head">
          <h1>오류 제보</h1>
          <p>쓰다가 이상한 점을 찾았거나 바라는 점이 있으면 알려 주세요. 운영자가 읽고 고쳐요.</p>
        </header>
        {state === 'done' ? (
          <section className="guide-sec fb-done" role="status">
            <Stamp className="stamp-press" />
            <h2>잘 받았어요</h2>
            <p>보내 주셔서 고마워요. 운영자가 읽고 고칠게요. 답장은 드리지 못해요.</p>
            <div className="actions">
              <a className="btn btn-primary" href="/">
                첫 화면으로
              </a>
              <button
                className="btn"
                onClick={() => {
                  setNote('')
                  setState('idle')
                }}
              >
                하나 더 보내기
              </button>
            </div>
          </section>
        ) : (
          <form className="guide-sec fb" onSubmit={send}>
            <fieldset className="fb-kinds">
              <legend>무엇을 알려 주시나요?</legend>
              {(['오류', '바라는 점'] as const).map((k) => (
                <label key={k} className="fb-kind">
                  <input type="radio" name="kind" checked={kind === k} onChange={() => setKind(k)} />
                  <strong>{k}</strong>
                  <span>{k === '오류' ? '안 눌리거나, 화면이 깨지거나, 숫자가 이상해요' : '이런 것이 있으면 좋겠어요'}</span>
                </label>
              ))}
            </fieldset>
            <label className="fb-field">
              <span className="fb-label">{kind === '오류' ? '어떤 일이 있었나요?' : '무엇을 바라시나요?'}</span>
              <textarea
                className="input"
                rows={6}
                maxLength={500}
                minLength={5}
                required
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={kind === '오류' ? '예: 휴대폰에서 ‘픽하기’를 눌렀는데 계속 ‘보내는 중’으로 멈춰 있었어요.' : '예: 결과 화면의 글자가 조금 더 컸으면 좋겠어요.'}
              />
              <span className="fb-count">
                {kind === '오류' ? '어느 화면에서 무엇을 눌렀는지 적어 주면 고치기 쉬워요.' : '짧게 적어도 괜찮아요.'} <b>{note.length}</b> / 500
              </span>
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="btn btn-primary btn-big fb-send" disabled={state === 'busy' || note.trim().length < 5}>
              {state === 'busy' ? '보내는 중' : '보내기'}
            </button>
            <ul className="guide-points fb-notes">
              <li>이름 · 전화번호 같은 개인정보는 적지 말아 주세요.</li>
              <li>적은 글과 함께 어느 화면에서 왔는지, 어떤 브라우저인지만 전해져요.</li>
              <li>답장은 드리지 못해요.</li>
            </ul>
          </form>
        )}
      </main>
      <HomeFoot org={org} />
    </div>
  )
}

/** 소개 (/about): 무엇을 하는 서비스인지, 누가 왜 어떻게 만들었는지 */
export function About() {
  const org = useDoc('소개')
  return (
    <div className="home">
      <TopBar org={org}>
        <a className="top-link" href="/guide">
          가이드
        </a>
      </TopBar>
      <main className="about">
        <header className="about-hero">
          <div className="about-hero-text">
            <h1>
              방 번호 하나로 모여,
              <br />
              함께 고르고, 같이 봐요
            </h1>
            <p>My Pick 은 모임 · 수업 · 행사에서 여럿이 무언가를 정할 때 쓰는 서비스예요. 가입도 앱 설치도 없이 휴대폰으로 참여해요.</p>
            <div className="actions actions-start">
              <a className="btn btn-primary" href="/">
                참여하러 가기
              </a>
              <a className="btn" href="/guide">
                가이드 보기
              </a>
            </div>
          </div>
          <HeroArt />
        </header>

        <section aria-labelledby="about-promise">
          <h2 id="about-promise" className="about-h">세 가지 약속</h2>
          <ul className="promise">
            <li>
              <Stamp />
              <strong>아무도 몰라요</strong>
              <span>누가 무엇을 골랐는지는 어디에도 남지 않아요. 진행자도 운영자도 볼 수 없어요.</span>
            </li>
            <li>
              <Stamp />
              <strong>먼저 볼 수 없어요</strong>
              <span>마감 전에는 아무도 결과를 볼 수 없고, 마감되면 모두에게 한꺼번에 나와요.</span>
            </li>
            <li>
              <Stamp />
              <strong>바꿀 수 없어요</strong>
              <span>마감 때 만든 결과 확인 코드로, 결과가 그 뒤로 그대로인지 누구나 확인해요.</span>
            </li>
          </ul>
        </section>

        <section className="guide-sec" aria-labelledby="about-flow">
          <h2 id="about-flow">이렇게 흘러가요</h2>
          <ol className="steps about-flow">
            <li>
              <strong>방을 만들어요</strong>
              <span>진행하는 사람이 방을 만들면 방 번호 6자리가 나와요.</span>
            </li>
            <li>
              <strong>다 같이 골라요</strong>
              <span>방 번호나 QR 로 들어와, 열린 주제에 도장을 찍어요.</span>
            </li>
            <li>
              <strong>결과를 함께 봐요</strong>
              <span>마감되면 큰 화면과 모든 휴대폰에 한꺼번에 나와요.</span>
            </li>
          </ol>
        </section>

        <section className="about-why" aria-labelledby="about-why">
          <h2 id="about-why">왜 만들었나요</h2>
          <p>손을 들면 눈치가 보이고, 종이를 돌리면 세는 데 오래 걸려요.</p>
          <p>어른과 청소년이 같이 있는 자리에서도 누구나 편하게 자기 생각을 고를 수 있으면 좋겠다는 마음에서 시작했어요. 그래서 처음 쓰는 사람도 설명 없이 쓸 수 있게, 그리고 결과를 믿을 수 있게 만드는 데 가장 공을 들였어요.</p>
        </section>

        <div className="about-pair">
          <section className="guide-sec">
            <h2>누가 만들었나요</h2>
            <p>
              이명균이 만들고 <a href="https://github.com/hatility" rel="noopener">hatility(하틸리티)</a>에서 내보내요.
            </p>
            <p>이 사이트는 {org?.name ?? '운영 기관'}이 운영해요.</p>
            <p className="tip">AI(Claude)의 도움을 받아 만들었어요. 무엇을 만들지 정하고, 살펴 고르고, 내보내는 일과 그 책임은 만든 사람에게 있어요. 참여자의 정보를 AI 에 보내지 않아요.</p>
          </section>
          <section className="guide-sec">
            <h2>어떻게 만들었나요</h2>
            <ul className="about-chips" aria-label="쓴 기술">
              <li>React</li>
              <li>Node</li>
              <li>SQLite</li>
              <li>Docker</li>
            </ul>
            <ul className="guide-points">
              <li>서버 하나로 돌아가고, Docker 로 한 번에 띄워요.</li>
              <li>광고 · 통계 · 글꼴 같은 바깥 서비스를 부르지 않아요.</li>
              <li>진행자가 한 일은 앞뒤가 이어진 기록으로 남아, 중간을 고치면 드러나요.</li>
            </ul>
          </section>
        </div>

        <section className="about-open" aria-labelledby="about-open">
          <div>
            <h2 id="about-open">누구나 고쳐 쓸 수 있어요</h2>
            <p>My Pick 은 자유 소프트웨어예요 (AGPL-3.0). 소스를 받아 직접 띄우거나 고쳐 쓸 수 있고, 고쳐서 서비스하면 고친 소스도 쓰는 사람이 받을 수 있게 해야 해요.</p>
            <p className="tip">
              오류를 찾았거나 바라는 점이 있으면 <a href="/feedback">오류 제보</a>로 알려 주세요.
            </p>
          </div>
          {org?.source && (
            <div className="actions">
              <a className="btn" href={org.source} rel="noopener">
                소스 코드 보기
              </a>
              <a className="btn" href={`${org.source.replace(/\/+$/, '')}/issues/new/choose`} rel="noopener">
                오류 알리기 · 제안하기
              </a>
            </div>
          )}
        </section>
      </main>
      <HomeFoot org={org} />
    </div>
  )
}
