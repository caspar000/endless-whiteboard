/**
 * The lab's sync server: `node sync-server.ts`. Rooms of the canvas fork's default shapes, one SQLite
 * file each in `LAB_SYNC_DIR`, over `ws://localhost:$LAB_SYNC_PORT/sync/<room>`. No accounts: it is
 * for checking sync in the lab, not for serving anyone (Lifeboard's server is apps/server).
 */
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { SyncRoom } from '@lifeboard/canvas-sync'
import { SqliteRoomStorage } from '@lifeboard/canvas-sync/sqlite'
import { createTLSchema, DocumentRecordType, PageRecordType, TLDOCUMENT_ID, type TLRecord } from '@tldraw/tlschema'
import type { IndexKey } from '@tldraw/utils'
import { WebSocketServer } from 'ws'

const port = Number(process.env.LAB_SYNC_PORT ?? 5192)
const dir = process.env.LAB_SYNC_DIR ?? join(tmpdir(), 'canvas-lab-sync')
mkdirSync(dir, { recursive: true })

const schema = createTLSchema()
const rooms = new Map<string, { room: SyncRoom<TLRecord>; db: DatabaseSync }>()

function room(name: string): SyncRoom<TLRecord> {
	const open = rooms.get(name)
	if (open) return open.room
	const db = new DatabaseSync(join(dir, `${name}.sqlite`))
	const room = new SyncRoom<TLRecord>({
		schema,
		storage: new SqliteRoomStorage(db),
		initial: {
			store: {
				[TLDOCUMENT_ID]: DocumentRecordType.create({ id: TLDOCUMENT_ID }),
				'page:page': PageRecordType.create({ id: PageRecordType.createId('page'), name: 'Page 1', index: 'a1' as IndexKey }),
			},
			schema: schema.serialize(),
		},
		onEmpty: () => {
			rooms.delete(name)
			room.close()
			db.close()
		},
	})
	rooms.set(name, { room, db })
	return room
}

const server = new WebSocketServer({ port })
server.on('connection', (socket, request) => {
	const name = /^\/sync\/([\w-]+)$/.exec(new URL(request.url ?? '/', 'http://lab').pathname)?.[1]
	if (!name) return socket.close(4404, 'No such room.')
	const session = room(name).join(socket)
	socket.on('message', (data) => session.receive(String(data)))
	socket.on('close', () => session.leave())
})
server.on('listening', () => console.log(`Lab sync server on ws://localhost:${port}, rooms in ${dir}`))
