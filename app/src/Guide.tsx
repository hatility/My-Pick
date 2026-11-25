// 안내 (/guide): 참여하는 법 · 방 여는 법 · 비밀을 지키는 방법 · 자주 묻는 것.
// 첫 화면은 ‘들어가기’만 남기고, 읽을거리는 모두 여기로 옮겼어요.
import { useEffect, useState, type FormEvent } from 'react'
import { api, type Org } from './api'
import { HomeFoot, Stamp, TopBar } from './parts'

type Checked = { same: boolean; room: string; title: string; practice: boolean; options: { label: string; votes: number }[]; voted: number; eligible: number; abstain: number; closedAt: number; outcome: 'pass' | 'fail' | null }

export function Guide() {
  const [org, setOrg] = useState<Org | null>(null)
  useEffect(() => {
    api<Org>('/api/org').then(setOrg, () => {})
    document.title = '안내 · My Pick'
  }, [])
  const days = org?.keepDays ?? 7
  const faq: [string, string][] = [
    ['픽한 뒤에 바꿀 수 있나요?', '아니요. ‘픽 확정’을 누르면 바꿀 수 없어요. 그래서 확정하기 전에 한 번 더 물어봐요.'],
    ['새로고침하거나 인터넷이 끊기면 어떻게 되나요?', '이미 한 픽은 그대로 남아요. 다시 열면 이어서 할 수 있고, 같은 안건에 두 번 픽할 수는 없어요.'],
    ['시간 안에 픽하지 못하면요?', '그 안건은 픽하지 않은 것으로 세요. 다음 안건부터 다시 참여할 수 있어요.'],
    ['이름이나 전화번호를 적어야 하나요?', '아니요. 개인정보를 받지 않아요. 이 브라우저에 ‘들어왔다’는 표시 하나만 남겨요.'],
    ['같은 사람이 두 번 픽할 수는 없나요?', '한 번 들어온 브라우저는 한 안건에 한 번만 고를 수 있어요. 더 엄격하게 하려면 방을 만들 때 ‘엄격’ 방식을 골라 한 사람에게 입장 코드를 하나씩 나눠 주세요.'],
    ['결과는 언제 볼 수 있나요?', '안건이 마감되면 모두에게 한꺼번에 나와요. 방을 만들 때 ‘실시간 공개’를 켠 방만 픽 받는 중에도 보여요.'],
    ...(org?.open ? ([['만든 방은 언제 지워지나요?', `마지막으로 쓴 뒤 ${days}일이 지나면 안건 · 결과와 함께 자동으로 지워져요. 필요한 결과는 방장 화면에서 내려받거나 인쇄해 두세요.`]] as [string, string][]) : []),
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
          <h1>My Pick 안내</h1>
          <p>방 번호 하나로 모여 함께 정하는 My Pick예요. 가입도, 앱 설치도 필요 없어요.</p>
          <nav className="guide-nav" aria-label="안내 차례">
            <a href="#join">참여하기</a>
            {org?.open && <a href="#host">My Pick 열기</a>}
            <a href="#secret">비밀 보장</a>
            <a href="#faq">자주 묻는 것</a>
          </nav>
        </header>

        <section id="join" className="guide-sec">
          <h2>참여하기</h2>
          <ol className="steps">
            <li>
              <strong>방 번호를 넣어요.</strong> 진행자가 알려 준 6자리 숫자예요. 큰 화면의 QR 을 찍으면 번호가 미리 들어가 있어요.
            </li>
            <li>
              <strong>안건이 열리면 고르고 픽해요.</strong> 화면에 픽 카드가 저절로 나와요. 고른 뒤 ‘픽하기’, 한 번 더 확인하고 ‘픽 확정’.
            </li>
            <li>
              <strong>결과를 함께 봐요.</strong> 시간이 끝나거나 모두 픽하면 마감되고, 결과가 모두에게 한꺼번에 나와요.
            </li>
          </ol>
        </section>

        {org?.open && (
          <section id="host" className="guide-sec">
            <h2>My Pick 열기</h2>
            <ol className="steps">
              <li>
                <strong>방을 만들어요.</strong> 방 이름과 방장 비밀번호만 정하면 돼요. 방 번호가 바로 나와요.
              </li>
              <li>
                <strong>사람들을 불러요.</strong> ‘큰 화면 열기’로 QR 과 방 번호를 띄우거나, 방 번호를 알려 주세요. 다 모이면 ‘입장 마감’.
              </li>
              <li>
                <strong>안건을 하나씩 열어요.</strong> 처음이라면 ‘연습 픽’로 한 번 맞춰 보세요. 찬반 안건은 가결 기준을 정해 둘 수 있어요.
              </li>
              <li>
                <strong>결과를 남겨요.</strong> 내려받거나 인쇄해 두세요. 방은 마지막으로 쓴 뒤 {days}일이 지나면 자동으로 지워져요.
              </li>
            </ol>
            <div className="actions actions-start">
              <a className="btn btn-primary" href="/new">
                방 만들기
              </a>
              <a className="btn" href="/host">
                내가 만든 방 진행하기
              </a>
            </div>
          </section>
        )}

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
            <li>한 번 연 안건은 고치거나 지울 수 없고, 진행자가 한 일은 기록으로 남아요.</li>
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
          안내
        </a>
      </TopBar>
      <main className="guide">
        <header className="guide-head">
          <h1>결과 확인</h1>
          <p>안건이 마감될 때 화면에 나온 ‘결과 확인 코드’를 넣어 보세요. 지금 저장된 결과가 그때와 같은지 알려 드려요.</p>
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
            <p className={`seal ${found.same ? 'seal-ok' : 'seal-bad'}`}>
              <Stamp />
              {found.same ? '마감했을 때의 결과 그대로예요.' : '마감한 뒤에 결과가 바뀌었어요. 아래 숫자는 믿을 수 없어요. 진행자나 관리자에게 알려 주세요.'}
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
                  <th scope="row">기권</th>
                  <td>{found.abstain}명</td>
                </tr>
              </tbody>
            </table>
            <p className="tip">
              들어온 {found.eligible}명 중 {found.voted}명 픽, {new Date(found.closedAt).toLocaleString('ko-KR', { dateStyle: 'long', timeStyle: 'short' })} 마감
              {found.outcome ? `, ${found.outcome === 'pass' ? '가결' : '부결'}` : ''}
            </p>
          </section>
        )}
        <section className="guide-sec">
          <h2>이 코드는 무엇인가요?</h2>
          <ul className="guide-points">
            <li>안건이 마감되는 순간의 결과 전체(선택지, 받은 픽, 인원, 시각)로 만든 12자리예요. 숫자가 하나라도 달라지면 전혀 다른 코드가 돼요.</li>
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
const EFFECTIVE = '2026년 11월 25일'
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
          안내
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
  return (
    <DocPage org={org} title="이용약관" lead="My Pick 을 쓰기 전에 알아 둘 약속이에요. 방을 만들거나 방에 들어오면 이 약관에 동의한 것으로 봐요.">
      <section className="guide-sec">
        <h2>1. My Pick 은</h2>
        <p>방 번호로 모여 여럿이 함께 고르고 결과를 같이 보는 서비스예요. {org?.name ?? '운영 기관'}이 운영해요. 가입 없이 쓸 수 있어요.</p>
        <p>모임 · 수업 · 행사에서 의견을 모으는 데 쓰도록 만들었어요. 법이나 규정으로 절차가 정해진 공식 선거 · 표결의 수단으로 쓰도록 만든 서비스가 아니에요. 그런 곳에 쓴 결과에 대해 운영자는 책임지지 않아요.</p>
      </section>
      <section className="guide-sec">
        <h2>2. 방을 만든 사람의 책임</h2>
        <ul className="guide-points">
          <li>방 이름 · 안건 · 선택지의 내용과, 참여자에게 하는 안내는 방을 만든 사람(방장)이 책임져요.</li>
          <li>결과를 어디에 어떻게 쓸지도 방장과 그 모임이 정하고 책임져요.</li>
          <li>방장 비밀번호와 공동 진행자 비밀번호는 방장이 관리해요. 잃어버리면 되찾을 수 없어요.</li>
          <li>방은 마지막으로 쓴 뒤 {days}일이 지나면 안건 · 결과와 함께 자동으로 지워져요. 필요한 결과는 그 전에 내려받거나 인쇄해 두세요.</li>
        </ul>
      </section>
      <section className="guide-sec">
        <h2>3. 하면 안 되는 일</h2>
        <ul className="guide-points">
          <li>남을 속이거나, 괴롭히거나, 따돌리거나, 차별 · 혐오하는 내용을 올리는 일</li>
          <li>방 이름 · 안건 · 선택지 · 의견에 다른 사람의 이름 · 연락처 같은 개인정보나 사생활을 적는 일</li>
          <li>법을 어기는 일에 쓰는 일</li>
          <li>프로그램으로 마구 접속하거나, 여러 번 참여하려고 꾀를 쓰거나, 서비스를 방해하는 일</li>
          <li>운영자나 다른 단체인 척하는 일</li>
        </ul>
      </section>
      <section className="guide-sec">
        <h2>4. 운영자가 할 수 있는 일</h2>
        <ul className="guide-points">
          <li>참여자는 방을 신고할 수 있고, 운영자는 신고된 방을 확인해요.</li>
          <li>위 3번에 해당하는 방은 미리 알리지 않고 지울 수 있고, 그 방을 만든 곳에서 한동안 방을 만들지 못하게 막을 수 있어요.</li>
          <li>쓸 수 없는 말(금칙어)을 정해 방 이름 · 안건에 쓰지 못하게 할 수 있어요.</li>
          <li>운영자도 누가 무엇을 골랐는지는 볼 수 없어요.</li>
        </ul>
      </section>
      <section className="guide-sec">
        <h2>5. 결과와 책임의 한계</h2>
        <ul className="guide-points">
          <li>간편 방식 방은 같은 사람이 다른 기기로 한 번 더 들어올 수 있어요. 한 사람이 꼭 한 번만 참여해야 하면 엄격 방식(입장 코드)을 쓰세요.</li>
          <li>인터넷이나 기기 문제로 참여하지 못한 경우, 그 안건은 참여하지 않은 것으로 세요.</li>
          <li>서비스는 있는 그대로 제공돼요. 점검 · 고장 · 사고로 멈추거나 자료가 사라질 수 있고, 운영자는 고의나 큰 잘못이 없는 한 그로 인한 손해를 책임지지 않아요.</li>
          <li>운영자는 서비스를 바꾸거나 그만둘 수 있어요. 그만둘 때는 첫 화면에 미리 알려요.</li>
        </ul>
      </section>
      <section className="guide-sec">
        <h2>6. 약관이 바뀌면</h2>
        <p>바뀐 내용과 시행일을 이 페이지에 적어요. 바뀐 뒤에도 계속 쓰면 바뀐 약관에 동의한 것으로 봐요.</p>
        <h2>7. 문의</h2>
        <Contact org={org} />
      </section>
    </DocPage>
  )
}

export function Privacy() {
  const org = useDoc('개인정보 처리방침')
  const days = org?.keepDays ?? 7
  const rows: [string, string, string][] = [
    ['입장 표시 (쿠키)', '같은 사람이 한 안건에 한 번만 참여하게 하고, 새로고침해도 이어서 하게 하려고', `최대 ${org?.voterDays ?? 7}일, 또는 방이 지워질 때까지`],
    ['참여했는지 여부', '두 번 참여하는 것을 막으려고. 무엇을 골랐는지는 여기에 없어요', '방이 지워질 때까지'],
    ['입장 코드 (엄격 방식 방만)', '한 사람이 한 번만 참여하게 하려고', '방이 지워질 때까지'],
    ['방장 · 공동 진행자 비밀번호', '방을 진행할 사람인지 확인하려고. 알아볼 수 없게 바꿔 저장해요', '방이 지워질 때까지'],
    ['방을 만든 접속 주소를 바꾼 값', '문제 방을 만든 곳에서 더 만들지 못하게 막으려고. 주소 자체는 저장하지 않아요', '방이 지워질 때까지. 막은 경우에는 정한 기간(길게는 풀 때까지)'],
    ['신고 · 이의로 직접 적은 글', '운영자와 진행자가 확인하려고. 누가 적었는지는 진행자에게 보이지 않아요', '이의는 방이 지워질 때까지, 신고는 운영자가 지울 때까지'],
    ['관리자 아이디 · 비밀번호 · 로그인한 접속 주소', '관리자인지 확인하고, 누가 무엇을 했는지 기록하려고', '관리자를 뺄 때까지. 기록은 계속 남아요'],
  ]
  return (
    <DocPage org={org} title="개인정보 처리방침" lead="My Pick 은 이름 · 전화번호 · 이메일 · 생년월일을 받지 않아요. 그래도 서비스가 돌아가려면 다루는 것이 있어서, 무엇을 왜 얼마 동안 다루는지 적어요.">
      <section className="guide-sec">
        <h2>1. 가장 중요한 것</h2>
        <ul className="guide-points">
          <li>누가 무엇을 골랐는지는 저장하지 않아요. ‘누가 참여했는지’와 ‘무엇이 몇 명인지’를 따로 두고, 둘을 잇는 것은 남기지 않아요.</li>
          <li>광고 · 통계 · 글꼴 같은 바깥 서비스를 부르지 않아요. 접속한 사실이 다른 회사로 가지 않아요.</li>
          <li>다루는 것을 다른 곳에 주거나 맡기지 않아요.</li>
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
          <li>{org?.backupDays ? `사고에 대비해 저장 파일을 하루에 한 번 떠 두고 최근 ${org.backupDays}일치를 보관해요. 지워진 방도 그 기간에는 백업 안에 남아 있어요.` : '저장 파일의 자동 백업은 꺼져 있어요.'}</li>
          <li>여러 번 틀린 접속을 잠그려고 접속 주소를 잠깐 기억하지만, 저장하지 않고 서버를 다시 켜면 사라져요.</li>
        </ul>
      </section>
      <section className="guide-sec">
        <h2>3. 내 기기에만 남는 것</h2>
        <p>화면 밝기, 한 손 모드, 마감 때 본 결과 확인 코드, 방장의 안건 묶음은 쓰는 사람의 브라우저에만 저장돼요. 서버로 보내지 않고, 브라우저의 사이트 자료를 지우면 사라져요.</p>
      </section>
      <section className="guide-sec">
        <h2>4. 어린이 · 청소년</h2>
        <p>이름 · 연락처 같은 개인정보를 받지 않기 때문에, 만 14세 미만이 쓸 때 보호자 동의를 따로 받지 않아요. 방 이름 · 안건 · 의견에 자기나 다른 사람의 개인정보를 적지 않도록 진행자가 안내해 주세요.</p>
      </section>
      <section className="guide-sec">
        <h2>5. 내 권리</h2>
        <ul className="guide-points">
          <li>브라우저에서 이 사이트의 쿠키를 지우면 입장 표시가 사라져요.</li>
          <li>내가 만든 방은 방장 화면에서 언제든 지울 수 있어요.</li>
          <li>신고나 이의로 적은 글을 지워 달라고 하거나, 궁금한 점이 있으면 아래로 연락해 주세요.</li>
        </ul>
        <h2>6. 책임지는 곳</h2>
        <Contact org={org} />
        <h2>7. 방침이 바뀌면</h2>
        <p>바뀐 내용과 시행일을 이 페이지에 적어요.</p>
      </section>
    </DocPage>
  )
}
