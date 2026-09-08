import { createNodeShape, type Extension } from '@lifeboard/node-kit'
import { Heart } from 'lucide-react'
import { healthNodes } from './definition'
import { HealthSettings } from './HealthSettings'
import { refreshHealth } from './store'

export const healthExtension: Extension = {
  id: 'lifeboard.health', name: 'Apple Health', icon: Heart, version: '0.1.0', author: 'Lifeboard',
  description: 'Daily activity, sleep and recovery on your board. Connect Health Auto Export through iCloud Drive and a local service, then explore your history offline.',
  details: [
    'Steps, energy, sleep, weight, heart rate, HRV, temperature and breathing each have their own card. Change a card between daily bars, a trend, a heat strip or one number. The overview brings the previous week together.',
    'Your iPhone exports daily summaries to iCloud Drive. A separate local service keeps the history in SQLite, and the whiteboard caches it for offline use. Only metrics actually exported from Apple Health are available.',
    'Disabling this extension hides its creation tools and pauses browser refresh. Existing cards keep rendering their cached data. Stop the separate service to stop importing files.',
  ],
  nodes: healthNodes,
  settings: { title: 'Sync and history', Component: HealthSettings },
  commands: [
    { id: 'health.refresh', title: 'Refresh Apple Health history', group: 'Apple Health', run: () => { void refreshHealth() } },
    {
      id: 'health.dashboard', title: 'Create Apple Health dashboard', group: 'Apple Health', icon: Heart,
      when: ctx => ctx.editor !== null,
      run: ctx => {
        const editor = ctx.editor
        if (!editor) return
        const center = editor.getViewportPageBounds().center
        const ids: ReturnType<typeof createNodeShape>[] = []
        const types = ['overview', 'steps', 'activeEnergy', 'sleep', 'weight', 'hrv', 'restingHeartRate']
        editor.markHistoryStoppingPoint('create-health-dashboard')
        editor.run(() => {
          types.forEach((type, index) => {
            const def = healthNodes.find(n => n.type === `node.health.${type}`)!
            const column = (index - 1) % 3
            const row = Math.floor((index - 1) / 3)
            const point = index === 0 ? { x: center.x, y: center.y - 335 } : { x: center.x + (column - 1) * 355, y: center.y + row * 300 }
            ids.push(createNodeShape(editor, def, point, { range: 'lastWeek' }))
          })
        })
        editor.select(...ids)
        editor.zoomToSelection()
      },
    },
  ],
}
