/**
 * Rooms (party mode) — the red pin.
 *
 * WP-A of docs/plans/party-mode.md. One test describes the whole feature and is
 * marked `test.failing`: it passes while the service is unimplemented (every
 * function throws `NotImplementedError`) and starts FAILING the moment the
 * feature works, which is the signal to flip it to a plain `test(...)`.
 * WP-C does that flip as part of its acceptance.
 *
 * WHY IT FAILS TODAY: `createRoom` throws `NotImplemented: rooms.createRoom`.
 * The fixture sanity test below is a plain `it`, so a broken fixture cannot
 * hide behind `test.failing` (which would pass on ANY throw).
 *
 * Fixture: in-memory SQLite built by running the REAL migrations (so the test
 * tracks the production schema) plus the heavy leaf services mocked the way
 * tasks-scout-suspend.test.ts does it.
 */
import { describe, it, test, expect, mock, beforeAll, beforeEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { resolve } from 'path'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { asc, eq } from 'drizzle-orm'
import { v4 as uuid } from 'uuid'
import * as schema from '@/server/db/schema'
import { runMigrations } from '@/server/db/run-migrations'
import type { HivekeepMessage } from '@/server/llm/llm/types'

// ─── Mock pollution guard (matches the other DB-backed service tests) ───────
const schemaIsReal = !!(schema as any).rooms?.id && !!(schema as any).roomTurns?.id

mock.module('@/server/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, debug: () => {}, error: () => {} }),
}))

mock.module('@/server/sse/index', () => ({
  sseManager: { sendToAgent: () => {}, sendToUser: () => {}, broadcast: () => {} },
}))

// Queue: capture enqueued messages. Every symbol agent-engine / tasks import is
// stubbed, because the real module would need a real queue_items table.
const enqueued: Array<Record<string, unknown>> = []
mock.module('@/server/services/queue', () => ({
  enqueueMessage: async (m: Record<string, unknown>) => { enqueued.push(m) },
  dequeueMessage: async () => null,
  markQueueItemDone: async () => {},
  isAgentProcessing: async () => false,
  getQueueSize: async () => 0,
  recoverStaleProcessingItems: () => {},
  popQueueMessageMetadata: () => undefined,
}))

// No test in this file may reach a provider.
mock.module('@/server/llm/core/resolve', () => ({
  resolveLLM: async () => { throw new Error('no-llm-in-test') },
}))

const sqlite = new Database(':memory:')
sqlite.run('PRAGMA foreign_keys = ON')
const db = schemaIsReal ? drizzle(sqlite, { schema }) : (null as any)

if (schemaIsReal) {
  mock.module('@/server/db/index', () => ({ db, sqlite, initVirtualTables: () => {} }))
}

const svc = schemaIsReal
  ? await import('@/server/services/rooms')
  : ({} as typeof import('@/server/services/rooms'))

// `test.failing` needs a real schema to be meaningful; without one, skip.
const itReal = schemaIsReal ? it : it.skip
const failingReal = schemaIsReal ? test.failing : test.skip

// ─── Fixture ─────────────────────────────────────────────────────────────────
const USER_ID = 'user_ben'
const AGENT_A = 'agent_a'
const AGENT_B = 'agent_b'

beforeAll(() => {
  if (!schemaIsReal) return
  // Same mechanism the app and migrations.test.ts use.
  runMigrations(
    sqlite,
    drizzle(sqlite) as Parameters<typeof runMigrations>[1],
    resolve(import.meta.dir, '../db/migrations'),
  )
})

beforeEach(() => {
  if (!schemaIsReal) return
  enqueued.length = 0
  for (const table of [
    'room_turns', 'room_messages', 'room_members', 'quick_sessions', 'rooms',
    'agents', 'user_profiles', 'user',
  ]) {
    sqlite.run(`DELETE FROM ${table}`)
  }
  const now = new Date()
  db.insert(schema.user).values({
    id: USER_ID, name: 'Ben', email: 'ben@example.test', createdAt: now, updatedAt: now,
  }).run()
  db.insert(schema.userProfiles).values({
    userId: USER_ID, firstName: 'Ben', lastName: 'R', pseudonym: 'Ben',
  }).run()
  for (const [id, name] of [[AGENT_A, 'A'], [AGENT_B, 'B']] as const) {
    db.insert(schema.agents).values({
      id, slug: name.toLowerCase(), name, role: 'tester', character: 'terse', expertise: 'tests',
      model: 'test-model', workspacePath: `/tmp/${id}`, createdAt: now, updatedAt: now,
    }).run()
  }
})

/** End `agentId`'s running turn with a reply, the way the engine will in WP-C. */
async function endTurnWith(roomId: string, agentId: string, content: string) {
  const member = db.select().from(schema.roomMembers)
    .where(eq(schema.roomMembers.roomId, roomId)).all()
    .find((m: { agentId: string }) => m.agentId === agentId)
  expect(member?.sessionId).toBeTruthy() // advanceRoom must have created the lane
  await svc.onRoomTurnEnded({ sessionId: member!.sessionId!, messageId: uuid(), content })
}

function textOf(m: HivekeepMessage): string {
  const c = m.content as unknown
  if (typeof c === 'string') return c
  return (c as Array<{ type: string; text?: string }>)
    .filter((b) => b.type === 'text').map((b) => b.text ?? '').join('')
}

describe('rooms', () => {
  // Plain `it`: proves the fixture is sound, so the failing pin below can only
  // be failing-as-specified. `test.failing` passes on ANY throw, including a
  // typo in this setup.
  itReal('fixture: migrated schema and two seeded agents are in place', () => {
    const tables = sqlite
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all().map((r) => r.name)
    for (const t of ['rooms', 'room_members', 'room_messages', 'room_turns']) {
      expect(tables).toContain(t)
    }
    const cols = sqlite
      .query<{ name: string }, []>('PRAGMA table_info(quick_sessions)')
      .all().map((c) => c.name)
    expect(cols).toContain('room_id')
    expect(db.select().from(schema.agents).all().map((a: { id: string }) => a.id).sort())
      .toEqual([AGENT_A, AGENT_B])
  })

  // RED PIN. Fails today because `createRoom` throws NotImplemented. WP-C flips
  // this to a plain `test(...)` once the room service and the engine branch land.
  failingReal(
    'a post to a room of A and B runs A then B, lands three transcript rows, and B sees A as [Agent "A"]',
    async () => {
      const { room } = await svc.createRoom({
        name: 'Party', memberAgentIds: [AGENT_A, AGENT_B], userId: USER_ID,
      })

      await svc.postUserMessage({ roomId: room.id, userId: USER_ID, content: 'hello' })

      // Two turns, in room order A, B.
      const turns = db.select().from(schema.roomTurns)
        .where(eq(schema.roomTurns.roomId, room.id))
        .orderBy(asc(schema.roomTurns.position)).all()
      expect(turns.map((t: { agentId: string }) => t.agentId)).toEqual([AGENT_A, AGENT_B])

      // A answers; the round advances to B.
      await endTurnWith(room.id, AGENT_A, 'alpha says hi')

      // History built for B's turn: A's reply is a user-role row attributed to A.
      const historyForB = await svc.buildRoomHistory(room.id, AGENT_B, 200)
      const aLine = historyForB.find((m) => textOf(m) === '[Agent "A"]\nalpha says hi')
      expect(aLine?.role).toBe('user')

      await endTurnWith(room.id, AGENT_B, 'bravo says hi')

      // Three rows, in order: the user post, A's reply by A, B's reply by B.
      const rows = db.select().from(schema.roomMessages)
        .where(eq(schema.roomMessages.roomId, room.id))
        .orderBy(asc(schema.roomMessages.createdAt)).all()
      expect(rows.map((r: { authorType: string; authorId: string | null; content: string }) =>
        [r.authorType, r.authorId, r.content],
      )).toEqual([
        ['user', USER_ID, 'hello'],
        ['agent', AGENT_A, 'alpha says hi'],
        ['agent', AGENT_B, 'bravo says hi'],
      ])
    },
  )
})
