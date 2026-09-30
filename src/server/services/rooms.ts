/**
 * Rooms (party mode) — one named conversation shared by several Agents and the user.
 *
 * WP-A declares the contract only: every function below throws `NotImplemented`.
 * WP-B implements everything except `buildRoomHistory` and `onRoomTurnEnded`;
 * WP-C implements those two together with the engine's `kind === 'room'` branch.
 * The decisions these signatures encode are in docs/plans/party-mode.md.
 */

import type { HivekeepMessage } from '@/server/llm/llm/types'
import type { Room, RoomMember, RoomMessage, RoomTurn } from '@/shared/types'

/** Thrown by every unimplemented room service function until WP-B / WP-C land. */
export class NotImplementedError extends Error {
  constructor(fn: string) {
    super(`NotImplemented: rooms.${fn}`)
    this.name = 'NotImplementedError'
  }
}

/** A room together with its members, in speaking order. */
export interface RoomWithMembers {
  room: Room
  members: RoomMember[]
}

/**
 * Create a room owned by `userId`. Validates 1..`config.rooms.maxMembers` members, no
 * duplicates, no configurator Agents (decision 4). Member positions follow the order of
 * `memberAgentIds`. Emits `room:created`.
 */
export async function createRoom(params: {
  name: string
  memberAgentIds: string[]
  userId: string
}): Promise<RoomWithMembers> {
  throw new NotImplementedError('createRoom')
}

/** List the rooms `userId` may see: their own, or every room when `isAdmin` (decision 13). */
export async function listRooms(params: { userId: string; isAdmin: boolean }): Promise<Room[]> {
  throw new NotImplementedError('listRooms')
}

/** Load one room with its members, or null when it does not exist or is not visible to `userId`. */
export async function getRoom(params: {
  roomId: string
  userId: string
  isAdmin: boolean
}): Promise<(RoomWithMembers & { activeTurn?: RoomTurn }) | null> {
  throw new NotImplementedError('getRoom')
}

/**
 * Rename a room and/or replace its member list. Removing a member marks that member's
 * pending turns `failed`. Emits `room:updated`.
 */
export async function updateRoom(params: {
  roomId: string
  name?: string
  memberAgentIds?: string[]
}): Promise<RoomWithMembers> {
  throw new NotImplementedError('updateRoom')
}

/** Delete a room (rows cascade) and close its members' quick sessions. Emits `room:deleted`. */
export async function deleteRoom(roomId: string): Promise<void> {
  throw new NotImplementedError('deleteRoom')
}

/**
 * Append a user post to the room transcript and start a round (decisions 1 and 9).
 * Targets are the `@mentioned` members in room order, or every member when none is
 * mentioned; mentions of non-members are ignored. Creates one `pending` `room_turns` row
 * per target, emits `room:message`, then calls `advanceRoom`.
 */
export async function postUserMessage(params: {
  roomId: string
  userId: string
  content: string
  clientMessageId?: string
}): Promise<{ message: RoomMessage; turns: RoomTurn[] }> {
  throw new NotImplementedError('postUserMessage')
}

/**
 * Build the model history for `forAgentId`'s turn from the last `cap` `room_messages`,
 * oldest first (decisions 7, 8 and 12). The Agent's own replies are `role: 'assistant'`;
 * user posts are `role: 'user'` prefixed `[<pseudonym>] `; other members' replies are
 * `role: 'user'` prefixed `[Agent "<name>"]\n`.
 */
export async function buildRoomHistory(
  roomId: string,
  forAgentId: string,
  cap: number,
): Promise<HivekeepMessage[]> {
  throw new NotImplementedError('buildRoomHistory')
}

/**
 * Start the next turn of a round. No-op while a turn is `processing`. Otherwise takes the
 * oldest `pending` turn by `(created_at, position)`, ensures the member's `kind: 'room'`
 * quick session exists, enqueues exactly one queue item, marks the turn `processing` and
 * emits `room:turn` (decision 9).
 */
export async function advanceRoom(roomId: string): Promise<void> {
  throw new NotImplementedError('advanceRoom')
}

/**
 * Called when a room session's turn ends. Finds the `processing` turn for `sessionId`,
 * appends the reply to `room_messages` (`author_type: 'agent'`) or, when `error` is set,
 * a `system` line "<name> could not reply: <reason>"; marks the turn `done` or `failed`
 * with `ended_at`; emits `room:message` and `room:turn`; then calls `advanceRoom` so a
 * round never hangs on one member (decision 9).
 */
export async function onRoomTurnEnded(params: {
  sessionId: string
  messageId?: string
  content?: string
  error?: string
}): Promise<void> {
  throw new NotImplementedError('onRoomTurnEnded')
}

/**
 * Stop a room: abort the `processing` session through the quick lane's abort controller,
 * mark that turn and every `pending` turn `failed` with `error: 'stopped'`, and emit
 * `room:turn` for each.
 */
export async function stopRoom(roomId: string): Promise<void> {
  throw new NotImplementedError('stopRoom')
}
