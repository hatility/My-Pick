// 서버와 주고받는 것 (모양은 server.mjs 의 roomView 와 같아요)
export type Option = { id: number; label: string; votes?: number }
export type Item = {
  id: number
  title: string
  note: string
  maxPick: number
  /** 통과 기준: 첫 번째 선택지가 투표한 사람의 절반 넘게 · 3분의 2 이상 */
  rule: 'none' | 'majority' | 'two_thirds'
  practice: boolean
  outcome: 'pass' | 'fail' | null
  seconds: number
  status: 'draft' | 'open' | 'closed'
  closesAt: number | null
  /** 쉬어 가는 중인지, 그때 남아 있던 시간(밀리초) */
  paused: boolean
  pausedLeft: number | null
  /** 예약해 둔 여는 때 (준비 중인 주제만) */
  openAt: number | null
  /** 예약해 둔 마감 때 */
  closeAt: number | null
  openedAt: number | null
  closedAt: number | null
  /** 결과 확인 코드 (마감된 주제만) */
  proof: string | null
  reason: string | null
  voted: number
  eligible: number | null
  /** 득표가 실려 있는지 (마감됐거나 ‘실시간 공개’ 방) */
  revealed: boolean
  abstain: number | null
  options: Option[]
  mine: boolean | null
  /** 최소 참여 인원 (0 이면 없음) · 통과를 따질 기준 인원 */
  /** 선택지 순서를 사람마다 섞는지 */
  shuffle: boolean
  /** 확인 요청: 건수 · 받는 마감 때 · 내가 냈는지 · (진행자만) 내용 */
  objections: number
  objectUntil: number | null
  objected: boolean | null
  objectionNotes?: { note: string; at: number }[]
  quorum: number
  basis: 'voted' | 'valid' | 'joined'
  /** 진행자가 독려 알림을 보낸 때 (열린 주제만) */
  nudgeAt: number | null
  /** 진행자 메모 (진행자에게만 와요) */
  memo?: string
}
export type Org = { name: string; logo: string | null; open?: boolean; keepDays?: number; source?: string; contact?: string; voterDays?: number; backupDays?: number; objectMinutes?: number; seconds?: number; grace?: number }
export type RoomState = {
  now: number
  org: Org
  room: { easy: boolean; rehearsal: boolean; tone: string; screenMode: 'auto' | 'join' | 'result' | 'notice'; notice: string; code: string; title: string; mode: 'simple' | 'strict'; live: boolean; locked: boolean; closed: boolean; needPass: boolean }
  joined: number
  /** 조용한 손들기: 참여자에게는 내가 든 손, 진행자에게는 몇 명인지 */
  myHand?: 'question' | 'more' | null
  hands?: { question: number; more: number }
  nextOpenAt: number | null
  /** 주제가 몇 개 중 몇 개 끝났는지 · 다음 주제 제목 */
  agenda: { total: number; done: number; next: string | null }
  present: number
  items: Item[]
  admin?: { mark: { mark: string; count: number }; observerKey: string; rehearsalOf: number | null; archived: boolean; hasLogo: boolean; role: 'admin' | 'host' | 'cohost'; cohost: boolean; canBlock: boolean; owner: 'admin' | 'host'; expiresAt: number | null; id: number; capacity: number; seconds: number; grace: number; closeAll: boolean; screenKey: string; codes: { total: number; used: number } }
  siteUrl?: string
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

/** 상태를 바꾸는 요청에는 서버가 확인하는 머리글을 붙여요 (다른 사이트가 흉내 내지 못하게) */
export async function api<T = any>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const raw = body instanceof Blob
  let res: Response
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { ...(method === 'GET' ? {} : { 'X-Requested-With': 'mypick' }), ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}) },
      body: raw ? body : body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(0, '서버에 닿지 않아요. 인터넷 연결을 확인해 주세요.')
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, data?.error ?? '문제가 생겼어요. 잠시 뒤에 다시 해 주세요.')
  return data as T
}
