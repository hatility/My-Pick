import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { Lost } from './parts'

// 주소 → 화면 (서버는 아는 주소에만 index.html 을 200 으로 줘요)
//   /              픽 (PC)            /m     픽 (휴대폰 · 태블릿)
//   /new           방 만들기 (누구나)    /host  방장 화면      /guide  안내
//   /admin         관리자               /screen/방번호?k=열쇠   큰 화면
const Vote = lazy(() => import('./Vote').then((m) => ({ default: m.Vote })))
const MobileVote = lazy(() => import('./MobileVote').then((m) => ({ default: m.MobileVote })))
const Admin = lazy(() => import('./Admin').then((m) => ({ default: m.Admin })))
const NewRoom = lazy(() => import('./Host').then((m) => ({ default: m.NewRoom })))
const HostPage = lazy(() => import('./Host').then((m) => ({ default: m.HostPage })))
const Guide = lazy(() => import('./Guide').then((m) => ({ default: m.Guide })))
const Terms = lazy(() => import('./Guide').then((m) => ({ default: m.Terms })))
const Privacy = lazy(() => import('./Guide').then((m) => ({ default: m.Privacy })))
const Verify = lazy(() => import('./Guide').then((m) => ({ default: m.Verify })))
const Screen = lazy(() => import('./Screen').then((m) => ({ default: m.Screen })))
const Observe = lazy(() => import('./Screen').then((m) => ({ default: m.Observe })))
const Remote = lazy(() => import('./Host').then((m) => ({ default: m.Remote })))

// 화면을 그리기 전에 밝기부터 (깜빡임 없이): 고른 적이 있으면 그것, 없으면 기기 설정
try {
  document.documentElement.dataset.theme = localStorage.getItem('mypick-theme') ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
} catch {
  /* 저장을 못 쓰는 브라우저는 밝은 화면으로 */
}

const path = location.pathname.replace(/\/+$/, '') || '/'
const screen = /^\/screen\/(\d{6})$/.exec(path)?.[1]
const observe = /^\/observe\/(\d{6})$/.exec(path)?.[1]

// 휴대폰 · 태블릿(손가락으로 누르는 기기)이나 좁은 화면은 /m 으로 넘겨요. 방 번호(?room=)는 그대로 들고 가요.
if (path === '/' && (matchMedia('(pointer: coarse)').matches || innerWidth < 900)) location.replace('/m' + location.search)

function Route() {
  if (path === '/') return <Vote />
  if (path === '/m') return <MobileVote />
  if (path === '/new') return <NewRoom />
  if (path === '/host') return <HostPage />
  if (path === '/guide') return <Guide />
  if (path === '/verify') return <Verify />
  if (path === '/terms') return <Terms />
  if (path === '/privacy') return <Privacy />
  if (path === '/admin') return <Admin />
  if (path === '/remote') return <Remote />
  if (screen) return <Screen code={screen} />
  if (observe) return <Observe code={observe} />
  return <Lost title="없는 주소예요">주소를 다시 확인하거나 첫 화면에서 방 번호로 들어와 주세요.</Lost>
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>
      <Route />
    </Suspense>
  </StrictMode>,
)
