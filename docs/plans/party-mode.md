# Party mode — one room, several agents, one thread

Plan for the Hivekeep agent team. Overwatch orchestrates, Scout researches, Forge implements,
Bookkeep documents. Each work package is one branch and one pull request against this fork's
`main`. An agent picks up a package cold: read this file and the repo, nothing else. Written
2026-09-30 against upstream commit `7d023c95` (v1.10.0 line).

Every `file:line` below is a **hint to verify**, not a fact. Grep for the symbol, confirm it
says what this plan claims, and report drift in the PR rather than working around it.

## The defect, as it stands today

| Surface | What it does | Why a room cannot exist on it |
| --- | --- | --- |
| `src/server/db/schema.ts:185` `messages` | `agent_id NOT NULL`, scopes: `task_id`, `session_id` | there is no conversation or room id; every row belongs to exactly one agent |
| `src/server/db/schema.ts:371` `quick_sessions` | `agent_id NOT NULL`, `kind: 'quick' \| 'api'` | a session is one agent's private lane |
| `src/server/services/agent-engine.ts:2986` `buildMessageHistory` and the session history at `:2513` | every `role: 'assistant'` row is fed back as the model's own words | another agent's reply in the same history would be read as the model's own |
| `src/server/services/inter-agent.ts:112` `send_message` | enqueues into the target's **main** lane; the answer stays in the target's thread unless it calls `reply` | agents can message each other, but nobody, including the user, sees the exchange in one place |
| `src/server/services/mentions.ts` | `@agent` resolves to an agent and does nothing ("Agent mentions are ignored (visual only)") | there is nothing to route to |
| `src/client/pages/chat/ChatPage.tsx:62` | the URL is `/agent/:slug`; `ChatPanel` is keyed by one agent | the UI has no surface for more than one agent |

**The reframing:** the unit of a conversation is a room, not an agent. A room has members
and its own transcript. An agent's turn in a room is an ordinary quick-lane turn whose
history is built from the room transcript, with the other members attributed by name.
Nothing about the main timeline, quick sessions or the external API moves.

## Decisions — do not relitigate

Product calls were taken by Ben on 2026-09-30 (1–5). The rest are design calls taken here so
that no package re-derives them.

1. **Routing.** A user message with `@mentions` of room members goes to those members only, in
   room order. A message with none goes to **every** member, in room order. Mentions of
   non-members are ignored. This is deliberate: one round costs at most one turn per member.
2. **Agents do not talk to each other inside a round.** The user drives every round. In a room
   turn the inter-agent tools (`send_message`, `reply`, `list_kins`) are removed from the
   toolset; the room is the replacement for them. Bounded agent-to-agent follow-ups are a
   later plan, not an improvement to slip into this one.
3. **Web UI only.** No channel delivery for rooms. Discord rooms are a later plan.
4. **Many rooms, chosen members, persistent history, a name.** Members are existing agents;
   Queenie (`kind: 'configurator'`) is never a member.
5. **Full toolset.** A member runs its normal toolset in a room turn, exactly as in its own chat,
   minus decision 2. There is no chat-only profile.
6. **A room turn is a quick-lane turn.** Each member gets one `quick_sessions` row per room with
   `kind: 'room'` and a new `room_id` column. `processQuickMessage` gains a `kind === 'room'`
   branch. Reason: the quick lane already gives a per-agent parallel slot, session-scoped
   persistence, streaming and `chat:*` events keyed by `sessionId`. We reuse all of that
   rather than write a fourth engine path. `kind: 'room'` runs at **full** capability like
   `'api'`, not the minimal `'quick'` profile.
7. **The room transcript is canonical.** New table `room_messages` holds every user post and
   every agent reply, in order, with an author. The per-member `messages` rows the engine
   writes for a room session are working copies and are never read as history. A room turn's
   history is built from `room_messages` by a new builder, not from `buildMessageHistory` and
   not from the session query.
8. **Attribution in a room history.** For the member whose turn it is: its own replies are
   `role: 'assistant'`; user posts are `role: 'user'` prefixed `[<pseudonym>] ` exactly as the
   main lane does; other members' replies are `role: 'user'` prefixed `[Agent "<name>"]\n`,
   the same convention `buildMessageHistory` already uses for inter-agent messages
   (`agent-engine.ts:3121`). No new prefix vocabulary.
9. **Rounds are strictly sequential.** A user post creates one `room_turns` row per target
   member, positions in room order. The room service enqueues one turn at a time and enqueues
   the next only when the previous one has ended (done or failed). A second user post while a
   round is running queues behind it. A member whose turn fails (provider error, timeout)
   gets a system line in the transcript and the round advances; a round never hangs on one
   member.
10. **A member must say something.** The engine refuses to persist an empty assistant row
    (`agent-engine.ts:2027`, "permanently blocks later turns"), so a room turn always produces
    a reply. The room system prompt asks for brevity and for "nothing to add" to be said in one
    line. A "pass" tool is a later refinement.
11. **No new SSE event for streaming.** Room turns stream through the existing `chat:token`,
    `chat:reasoning-token`, `chat:done` and `chat:message` events, which already carry
    `sessionId`. The room client maps `sessionId → member` from the room's member list. New
    events are only for room state: `room:message` (a `room_messages` row was appended),
    `room:turn` (a turn changed status), and `room:created` / `room:updated` / `room:deleted`.
12. **History cap, not compaction.** A room turn reads the last `config.rooms.historyMaxMessages`
    room messages (default 200). Room compaction is a later plan.
13. **Visibility.** A room is visible to its creator and to admins. Nothing else in v1.
14. **Locales.** Every user-facing string is a key under a new top-level `rooms` namespace.
    `en.json` and `fr.json` are translated. The other eight locale files receive the English
    strings so that `bun scripts/check-locales.ts` passes; that is the parity rule the repo
    enforces, and translation is a follow-up.
15. **Nothing is superseded, so nothing is deleted.** Inter-agent tools, `agent_inform`,
    quick sessions and the external API stay exactly as they are. A package that finds itself
    "cleaning up" one of them is out of scope.
16. **Migrations.** Next number is `0119`. After `bun run db:generate`, open
    `src/server/db/migrations/meta/_journal.json` and make sure the new entry's `when` is
    greater than `1786479200000`, or the migrator will silently skip it on existing installs
    (the 0117 lesson, guarded by `src/server/db/migrations.test.ts:130`). New tables go into
    `fullMockSchema` in `src/test-helpers.ts` and into `schema.md`.

## Verification gate — every package, before the PR is opened

Run **in the workspace**, every time:

```
bun install --frozen-lockfile
bun run test
bun scripts/check-locales.ts
```

Run **in CI**, by opening the PR: `bun run typecheck` and `bun run build`. CI runs them on
every PR (`.github/workflows/ci.yml`); paste the CI run URL and its conclusion in the PR
body. Do not run `bun run typecheck` or `bun run build` inside the workspace: the typecheck
script asks for an 8 GB heap and the build for 6 GB, and on 2026-09-30 the first attempt
killed the whole platform twice (an emptyDir eviction, then an OOM kill). `bun run test` is
fine; run it with the npm script, never bare `bun test`, because the sorted file order limits
`mock.module` leakage (`.husky/pre-commit`). If CI fails on typecheck or build, read the CI
log, fix, push, and wait for CI again; a PR is not ready while CI is red.

Repo hygiene in the workspace: clone with `--depth 50` (the plan needs recent history, not
2,600 commits); only Forge runs `bun install`, and only once per workspace (`node_modules`
persists on the volume); Scout, Overwatch and Bookkeep read the plan from a depth-1 clone or
from the GitHub API and never install dependencies. Delete `node_modules` from a workspace
you are finished with.

Paste the tail of each workspace command's output in the PR under "How I verified it".
Commits are conventional, no `Co-Authored-By`. Branch names follow the team rules:
`forge/feat/party-mode-wp-a` and so on.

## The red pin

WP-A writes `src/server/services/rooms.test.ts` with one test that describes the whole
feature and **sees it fail** against the current commit:

> posting "hello" to a room with members A and B creates two turns in order A, B; after
> both turns end, `room_messages` holds three rows: the user post, A's reply authored by A,
> and B's reply authored by B; and the history built for B's turn contains A's reply as a
> `role: 'user'` row prefixed `[Agent "A"]`.

It compiles against the service signatures WP-A declares (stubs that throw
`NotImplemented`), and lands as `test.failing(...)` so CI stays green while the defect stands.
**WP-C flips it to a plain `test(...)` as part of its acceptance.** Written first and seen
red, it is the specification; written after, it would only be a regression test.

Use an in-memory SQLite with the production Drizzle schema, the pattern in
`src/server/services/toolboxes.test.ts:21`, and mock `@/server/services/queue` and
`@/server/llm/core/resolve` the way `tasks-scout-suspend.test.ts` does. Guard with
`schemaIsReal` / `itReal`.

## Work packages

### WP-0 · Scout: four facts, no code

**Goal:** the four questions below are answered with a cited source before Forge starts.

1. Does Bun 1.3.13 (the CI version) support `test.failing` from `bun:test`? If not, what is
   the idiom for a test that is expected to fail (an `it.skip` with a `TODO(WP-C)` comment
   is the fallback)?
2. What does `bun run db:generate` (`drizzle-kit generate`) write for a new table plus a new
   nullable column, and does it update `meta/_journal.json` itself? Confirm the `when`
   hand-raise rule in decision 16 against `src/server/db/run-migrations.ts`.
3. Does `parseMentions` in `src/server/services/mentions.ts` match an agent whose name has a
   space or capitals (`@Overwatch`, `@bookkeep`)? Quote the regex and the resolution order.
4. In `src/client/components/chat/MessageInput.tsx`, can `mentionableAgents` be restricted to
   a subset (room members only) without touching `useMentionables.ts`? Name the prop.

**Acceptance:** a reply to Overwatch with the four answers, each with a file path and line,
stored in OpenViking under `viking://user/hivekeep/scout/party-mode-wp0.md`.
Owns: nothing. Size **S**. Depends: none.

### WP-A · Schema, types, config, stubs, red pin

**Goal:** the room data model exists, migrates cleanly on a populated database, is typed for
both sides, and the failing test that defines "done" is in the tree.

- `src/server/db/schema.ts`: add
  - `rooms`: `id`, `name`, `created_by → user.id`, `created_at`, `updated_at`.
  - `room_members`: `id`, `room_id → rooms.id (cascade)`, `agent_id → agents.id (cascade)`,
    `position` int, `session_id → quick_sessions.id` nullable (created lazily on first turn),
    unique `(room_id, agent_id)`.
  - `room_messages`: `id`, `room_id → rooms.id (cascade)`, `author_type: 'user' | 'agent' |
    'system'`, `author_id` (user id or agent id, null for system), `content`, `message_id`
    nullable (the engine's `messages.id` for an agent reply, for reactions later),
    `created_at`. Index `(room_id, created_at)`.
  - `room_turns`: `id`, `room_id`, `room_message_id → room_messages.id` (the triggering user
    post), `agent_id`, `position`, `status: 'pending' | 'processing' | 'done' | 'failed'`,
    `error` nullable, `created_at`, `started_at`, `ended_at`. Index `(room_id, status,
    created_at)`.
  - `quick_sessions.kind` gains `'room'`; add nullable `room_id → rooms.id`.
  - Conventions from `CLAUDE.md:67`: text UUID keys, integer ms timestamps, JSON in text.
- Migration `0119_rooms.sql` via `bun run db:generate`, then decision 16. Run
  `migrations.test.ts`; the populated-database case must pass.
- `src/shared/types.ts`: `Room`, `RoomMember`, `RoomMessage`, `RoomTurn` DTOs (timestamps as
  `number`), and `RoomMessageAuthorType`. `src/shared/constants.ts`: `ROOM_MAX_MEMBERS = 8`.
- `src/server/config.ts`: `rooms: { historyMaxMessages: Number(process.env.ROOMS_HISTORY_MAX_MESSAGES ?? 200), maxMembers: ... }`; mirror in `fullMockConfig`.
- `src/test-helpers.ts`: the four tables in `fullMockSchema`.
- `src/server/services/rooms.ts`: exported signatures only, each throwing `NotImplemented`:
  `createRoom`, `listRooms`, `getRoom`, `updateRoom`, `deleteRoom`, `postUserMessage`,
  `buildRoomHistory`, `advanceRoom`, `onRoomTurnEnded`, `stopRoom`. Document each in a
  JSDoc line so WP-B and WP-C implement the same contract.
- The red pin test, as above, `test.failing`.
- `schema.md`: the four tables, in the existing style.

**Acceptance:** migrations test green including the populated-database case; typecheck green
with the stubs; `rooms.test.ts` present, compiling, and failing for the reason the comment
states; `check-locales` unaffected.
Owns: `src/server/db/schema.ts`, `src/server/db/migrations/0119_*` + `meta/*`,
`src/shared/types.ts`, `src/shared/constants.ts`, `src/server/config.ts`,
`src/test-helpers.ts`, `src/server/services/rooms.ts` (stubs), `src/server/services/rooms.test.ts`,
`schema.md`. Size **M**. Depends: WP-0.

### WP-B · Room service and HTTP routes

**Goal:** rooms can be created, listed, edited and deleted, and a user post creates the right
turns in the right order and enqueues the first one; all through `/api/rooms`.

- Implement in `src/server/services/rooms.ts` everything except the engine-side pair
  (`buildRoomHistory`, `onRoomTurnEnded` stay stubs for WP-C):
  - `createRoom({name, memberAgentIds, userId})`: validates 1..`ROOM_MAX_MEMBERS` members, no
    configurator agents (`agents.kind`), no duplicates; positions in the order given.
  - `postUserMessage({roomId, userId, content, clientMessageId?})`: inserts the
    `room_messages` row, emits `room:message`, resolves targets per decision 1 using
    `parseMentions` (`src/server/services/mentions.ts`) intersected with members, creates
    `room_turns` rows, calls `advanceRoom`.
  - `advanceRoom(roomId)`: if a turn is `processing`, return. Take the oldest `pending` turn by
    `(created_at, position)`. Ensure the member's session exists (`quick_sessions` with
    `kind: 'room'`, `room_id`, `created_by` = room creator; store on `room_members.session_id`).
    Enqueue with `enqueueMessage({agentId, messageType: 'user', content: <the user post
    content>, sourceType: 'user', sourceId: userId, sessionId, priority: config.queue.userPriority})`.
    Mark the turn `processing`, emit `room:turn`.
  - `stopRoom(roomId)`: abort the processing session via the existing quick-lane abort
    (`quickAbortControllers` keyed by sessionId, `agent-engine.ts:209`), mark it and all
    pending turns `failed` with `error: 'stopped'`, emit `room:turn` for each.
  - `deleteRoom`: cascades; close the member sessions (`status: 'closed'`).
  - Rate: nothing new; the quick lane's per-agent lock is the limiter.
- `src/server/routes/rooms.ts`, mounted in `src/server/app.ts` at `/api/rooms`, behind
  `authMiddleware` like everything else. Error shape `{ error: { code, message } }`.
  - `GET /` → `{ rooms: Room[] }` for the caller (creator or admin).
  - `POST /` `{name, memberAgentIds}` → 201 `{ room }` with members.
  - `GET /:id` → `{ room, members: (RoomMember & {agent: {id, slug, name, avatarUrl},
    sessionId})[], activeTurn?: RoomTurn }`.
  - `PATCH /:id` `{name?, memberAgentIds?}`; removing a member marks its pending turns failed.
  - `DELETE /:id` → 204.
  - `GET /:id/messages?before=<id>&limit=N` → `{ messages: RoomMessage[] (oldest first,
    with author name/avatar resolved), hasMore }`, same cursor semantics as
    `routes/messages.ts:85` (limit default 50, max 100, `INVALID_CURSOR`).
  - `POST /:id/messages` `{content, clientMessageId?}` → 202 `{ messageId, turns: RoomTurn[] }`.
    Validate `EMPTY_MESSAGE` / `MESSAGE_TOO_LONG` with `MAX_MESSAGE_LENGTH`.
  - `POST /:id/stop` → `{ ok: true }`.
- SSE: add `room:message`, `room:turn`, `room:created`, `room:updated`, `room:deleted` to
  `SSEEventType` in `src/server/sse/types.ts` (no cast), emit with `sseManager.sendToUser`
  to the creator, and document each payload in `api.md` under a new "Rooms" heading, per
  `sse.md` §3.
- Tests: `rooms.test.ts` gains cases for routing (mention → subset; none → all; non-member
  mention ignored), ordering, the `ROOM_MAX_MEMBERS` and configurator rejections, and
  `advanceRoom` enqueueing exactly one item at a time (with `@/server/services/queue`
  mocked). A route test in `src/server/routes/rooms.test.ts` for the 201/202/400/403 paths,
  modelled on `routes/messages-window.test.ts`.

**Acceptance:** all listed cases green; a room with three members and a post with no mention
yields three `pending` turns in position order and exactly one `enqueueMessage` call; a post
`@B` yields one turn for B; a second post during a running round yields turns that stay
`pending` until `onRoomTurnEnded` is called (simulate it). The red pin is still failing.
Owns: `src/server/services/rooms.ts` (all but the two engine functions),
`src/server/services/rooms.test.ts`, `src/server/routes/rooms.ts`,
`src/server/routes/rooms.test.ts`, `src/server/app.ts` (one mount line),
`src/server/sse/types.ts`, `api.md`. Size **L**. Depends: WP-A.

### WP-C · The engine's room branch

**Goal:** a room turn runs on the quick lane with the room transcript as its history and its
reply lands in the transcript; the red pin turns green.

- `src/server/services/rooms.ts`:
  - `buildRoomHistory(roomId, forAgentId, cap)`: the last `cap` `room_messages`, oldest first,
    mapped per decision 8. Return the same message-array shape `processQuickMessage` feeds to
    the model today (see the session history at `agent-engine.ts:2513`; verify the type).
  - `onRoomTurnEnded({sessionId, messageId?, content?, error?})`: find the `processing` turn
    for that session; append the reply to `room_messages` (`author_type: 'agent'`) or, on
    error, a `system` row "<name> could not reply: <reason>"; mark the turn done/failed with
    `ended_at`; emit `room:message` and `room:turn`; call `advanceRoom`.
- `src/server/services/agent-engine.ts`, inside `processQuickMessage` only:
  - Read `kind` and `room_id` from the session (it already reads `kind` at `:2443`).
  - When `kind === 'room'`: treat capability as full (the `isApiSession` branch), load
    contacts/directory/MCP as that branch does; replace the session history with
    `buildRoomHistory(roomId, agentId, config.rooms.historyMaxMessages)`; pass `participants`
    built from room members plus the user so the prompt builder's group-conversation block
    fires (`prompt-builder.ts:933`); delete `send_message`, `reply`, `list_kins` from the
    toolset (decision 2); add a room block to the system prompt via a new
    `buildSystemPrompt` param `room: { name, members: [{name, role}], selfName }` implemented
    in `src/server/services/prompt-builder.ts` (ten lines: who is in the room, that
    `[Agent "X"]` lines are other members, reply briefly, say "nothing to add" in one line
    rather than repeating others).
  - After the assistant row is persisted (the existing session-lane persistence), call
    `onRoomTurnEnded` with the message id and content. In the error path of the quick lane,
    call it with the error. Both calls are guarded by `kind === 'room'` and wrapped so a
    room-service failure can never break a non-room session.
  - Do not touch `processNextMessage` or `buildMessageHistory`.
- Flip the red pin to `test(...)`. Add a history test: for member B, A's reply appears as
  `role: 'user'` with the `[Agent "A"]` prefix and B's own earlier reply as `role: 'assistant'`.
  Add a failure test: a turn whose LLM throws (mock `resolveLLM` throwing) ends `failed`,
  writes the system row, and the next turn is enqueued.
- `docs/dev-notes/engine-reliability.md`: one paragraph on the room branch and its guard.

**Acceptance:** red pin green; the two new tests green; `agent-engine.test.ts` unchanged and
green; typecheck and build green. In a running dev instance (see "Manual check" below), a
room with two members answers a post with two replies in order, and the second reply
visibly refers to the first.
Owns: `src/server/services/agent-engine.ts` (the `processQuickMessage` branch only),
`src/server/services/prompt-builder.ts` (the room block), `src/server/services/rooms.ts`
(the two engine functions), `src/server/services/rooms.test.ts` (flip + two tests),
`docs/dev-notes/engine-reliability.md`. Size **L**. Depends: WP-B. **Runs alone**:
`agent-engine.ts` is a choke point and is never co-owned.

### WP-D · The Rooms UI

**Goal:** a user can create a room, pick members, talk in it, watch each member reply in
turn with streaming, and address one member with `@`.

- Routes in `src/client/App.tsx`: `/rooms` and `/rooms/:roomId`, lazy like `/terminal`
  (`App.tsx:26`, `:226`). Nav: `ActivityBar.tsx` `ITEMS` + `SECTION_PREFIXES`, and the
  mobile `AppTopBar.tsx` `modeItems` + `sectionPrefixes` (both, per `CLAUDE.md:101`).
- `src/client/pages/rooms/RoomsPage.tsx`: `PageHeader`, list of rooms (cards below `sm`),
  `EmptyState`, a `FormDialog` to create a room with a name and a member picker built on
  `AgentSelector` / `AgentSelectItem` from `components/common`, excluding configurator agents.
- `src/client/pages/rooms/RoomPage.tsx`: header with member avatars (`ChatAvatar`), the
  transcript, a typing indicator naming whose turn is running (`TypingIndicator` with that
  member's name and avatar), a stop button wired to `POST /rooms/:id/stop`, and
  `MessageInput` with `mentionableAgents` restricted to members (WP-0 answer 4) and
  `mentionableUsers` empty.
- `src/client/hooks/useRoom.ts` and `useRooms.ts`, on the `useQuickChat.ts` pattern:
  - load `GET /rooms/:id` and `GET /rooms/:id/messages`, older pages via `before`;
  - subscribe with `useSSE` to `room:message`, `room:turn`, and to `chat:token`,
    `chat:reasoning-token`, `chat:done` **filtered by `sessionId ∈ members[].sessionId`**,
    mapping the session to the member for attribution; ignore events with no `sessionId`;
  - one `streamingMessage` at a time is enough (decision 9 guarantees one turn at a time);
    reuse `useChatStreaming`;
  - optimistic user bubble reconciled by `clientMessageId` through `mergeIncomingMessage`
    (`src/client/lib/reconcile-messages.ts`), and `useSSEResync(refetch)`.
- Rendering: reuse `MessageBubble` with `senderName`/`avatarUrl` from the room message
  author; user posts as the user bubble; agent replies as the agent's own bubble
  (`bg-muted`), **not** the `isFromOtherAgent` accent style, since in a room every agent is a
  first-class speaker. Group consecutive messages only when the author id matches.
- i18n: `rooms.*` namespace in all ten locales per decision 14; `activityBar.rooms`.
- Tests: pure-logic only, as the repo does (`InlineToolCall.test.ts` pattern): a
  `src/client/lib/room-events.test.ts` for the session-to-member mapping and the event filter.

**Acceptance:** typecheck, test, build, check-locales green; the manual check below
performed and screenshots attached to the PR (create room, post, two replies streaming in
turn, `@member` post answered by that member only, stop mid-turn). If the dev instance
cannot be booted in the sandbox, say so under "Not done" and list exactly which of these
were not seen; do not describe screenshots you did not take.
Owns: `src/client/App.tsx`, `src/client/components/layout/ActivityBar.tsx`,
`src/client/components/layout/AppTopBar.tsx`, `src/client/pages/rooms/*`,
`src/client/hooks/useRoom.ts`, `src/client/hooks/useRooms.ts`,
`src/client/lib/room-events.ts` + test, all ten files under `src/client/locales/`.
Size **L**. Depends: WP-B for the API shape; WP-C for the manual check to mean anything.
**Runs alone**: the locale files and `App.tsx` are choke points.

### WP-E · Bookkeep: documentation

**Goal:** a reader of the docs site knows what rooms are, how routing works, and what the
limits are; `api.md` and `schema.md` match the code that merged.

- `docs-site/src/content/docs/features/rooms.md` (+ `astro.config.mjs` sidebar entry, as the
  terminal feature did): what a room is, decisions 1, 2, 5, 10, 12, 13 in user terms, the
  `@mention` rule with an example, the stop button, limits.
- Verify `api.md` "Rooms" and `schema.md` against the merged WP-B/WP-C code and fix drift.
- `README.md`: one line in the feature list.
- Record in OpenViking under `viking://user/hivekeep/bookkeep/party-mode.md`: where the
  feature lives, the decisions, and the follow-ups below.

**Acceptance:** the docs build (`docs-site` has its own CI; run its build locally); every
route in `api.md` "Rooms" exists in `routes/rooms.ts`; no claim in the docs that the code
does not implement. Docs-only PRs skip CI (`paths-ignore`), so state in the PR that the
docs-site build was run and paste its tail.
Owns: `docs-site/**`, `README.md`, `api.md` (drift fixes only), `schema.md` (drift fixes
only). Size **S**. Depends: WP-D open (not merged).

## Manual check (WP-C and WP-D)

Boot a dev instance in the agent's own workspace, never against any existing database:

```
DB_PATH=$PWD/.tmp/party.db HIVEKEEP_DATA_DIR=$PWD/.tmp PORT=4178 \
PUBLIC_URL=http://localhost:4178 HIVEKEEP_MODEL_REGISTRY=false bun src/server/index.ts
```

Complete onboarding through the API, add the LiteLLM provider the way Settings does, create
two agents, then exercise the room. `testing-instance.md` has the rules that bite:
`waitUntil: 'domcontentloaded'` in Playwright because SSE never idles, and a shell that
inherits `DB_PATH` from the environment targets someone else's database, so set it
explicitly every time.

## Wave table

Waves come from file disjointness. With one implementer the waves are also the order Forge
works in; Scout and Bookkeep run in parallel where their files are disjoint.

| Wave | Packages | Notes |
| --- | --- | --- |
| 0 | WP-0 | Scout, no files |
| 1 | WP-A | Forge alone: schema, migration, stubs, red pin |
| 2 | WP-B | Forge alone: service + routes; touches `app.ts` and `sse/types.ts` |
| 3 | WP-C | Forge alone; owns `agent-engine.ts`, never co-owned |
| 4 | WP-D | Forge alone; owns `App.tsx` and all locale files, never co-owned |
| 5 | WP-E | Bookkeep, after WP-D is open; docs only |

Standing rules: `agent-engine.ts`, `App.tsx`, `schema.ts` and the locale files are never
co-owned, whatever the wave. Each package is one PR; Ben merges in wave order, and the next
wave branches from `main` after that merge, so a PR never contains another PR's diff.

Rough total: six waves, five PRs.

## The regression to fear

What must **not move at all**: the main timeline (`processNextMessage`, `buildMessageHistory`),
quick sessions of kind `quick` and `api`, the external API conversation tests
(`external-api.test.ts`), inter-agent messaging, and `migrations.test.ts`'s ordering check.
The only shared code that changes is the `kind === 'room'` branch in `processQuickMessage`
and one optional parameter on `buildSystemPrompt`; both are guarded and both default to
today's behaviour.

The assumption to hunt for, in every package: **"an assistant row in this history is the
running agent's own words."** It is true everywhere in the engine today and false in a room.
Every place that reads history, builds participants, masks tool results or attributes a
message must be checked against it. Name the assumption in the PR when you find it, whether
or not you had to change anything.

The shape the fixtures avoid: two well-behaved members with one-line replies. The live
defect will be found with five members, one of whose provider is down mid-round, a user who
posts twice in three seconds, an `@mention` of an agent who was removed from the room a
minute earlier, and a member with tool calls in its reply. WP-B's tests must build the
five-member round and the double post; WP-C's must build the failing member; WP-D's manual
check must include the removed-member mention.

## Follow-ups, deliberately outside this plan

- Bounded agent-to-agent follow-ups inside a round (decision 2).
- A `room_pass` tool so a member can decline to speak (decision 10).
- Room compaction (decision 12) and reactions on room messages (`room_messages.message_id`).
- Discord delivery for rooms (decision 3).
- Translation of the eight untranslated locales (decision 14).
- The cluster runs upstream's image plus git. Once this merges, the derived image at
  `ralton-dev/hivekeep_image` switches its `FROM` to a build of this fork, which is how party
  mode reaches the live instance. That is a homelab-k8s change, not part of this plan.
