// 픽 화면 (PC). 들어오기 전에는 첫 화면, 들어온 뒤에는 왼쪽에 지금 주제 · 오른쪽에 지난 주제 결과.
import { HeroArt } from './art'
import { Current, Hands, TextSize, useEasy, useWakeLock, HomeFoot, HostDoor, JoinForm, Loading, ViewSwitch, Offline, OrgMark, Past, PRIVACY, ReportLink, Stamp, ThemeToggle, TopBar, useVoter } from './parts'

export function Vote() {
  const v = useVoter()
  useEasy(v.state?.room.easy)
  useWakeLock(!!v.state && !v.state.room.closed) // 방에 들어와 있는 동안 화면이 꺼지지 않게
  if (!v.ready) return <Loading />

  if (!v.state)
    return (
      <div className="home">
        <TopBar org={v.org}>
          <a className="top-link" href="/guide">
            가이드
          </a>
          {v.org?.open && (
            <a className="top-link" href="/host">
              내 방 진행하기
            </a>
          )}
        </TopBar>
        <main className="hero">
          <div className="hero-copy">
            <h1>
              모두가 믿을 수 있는
              <br />
              My Pick
            </h1>
            <p className="hero-lead">방 번호만 넣으면 바로 참여해요. 가입도, 앱 설치도 필요 없어요.</p>
            <section className="hero-card" aria-labelledby="join-title">
              <h2 id="join-title">방 들어가기</h2>
              <JoinForm onJoined={v.refresh} />
            </section>
          </div>
          <HeroArt />
        </main>
        <ul className="promise">
          <li>
            <Stamp />
            <strong>아무도 모르게</strong>
            {PRIVACY}
          </li>
          <li>
            <Stamp />
            <strong>한 사람 한 번</strong>한 주제에 한 번만 픽할 수 있어요. 확정하면 바꿀 수 없어요.
          </li>
          <li>
            <Stamp />
            <strong>끊겨도 이어서</strong>
            새로고침하거나 창을 닫았다 열어도 이어서 할 수 있어요.
          </li>
        </ul>
        <div className="home-door">
          <HostDoor org={v.org} />
        </div>
        <HomeFoot org={v.org} />
      </div>
    )

  const s = v.state
  return (
    <div className="pc" data-tone={s.room.tone || undefined}>
      <header className="bar">
        <OrgMark org={s.org} />
        <div className="bar-room">
          <strong>
            {s.room.rehearsal && <span className="tag">리허설</span>}
            {s.room.title}
          </strong>
          <span>방 번호 {s.room.code}</span>
        </div>
        <span className="bar-count">지금 {s.present}명 접속</span>
        <TextSize />
        <ThemeToggle />
      </header>
      <Offline online={v.online} />
      <main className="pc-main">
        <div className="pc-cur">
          <Current state={s} vote={v.vote} />
        <Hands state={s} />
          <p className="privacy">{PRIVACY}</p>
          <ReportLink />
          <p className="view-switch">
            <a href="/guide#join" target="_blank" rel="noopener">
              가이드
            </a>
          </p>
          <ViewSwitch to="auto" />
        </div>
        <aside className="pc-side" aria-labelledby="past-title">
          <h2 id="past-title">지난 주제</h2>
          <Past items={s.items} skew={s.skew} refresh={v.refresh} />
        </aside>
      </main>
    </div>
  )
}
