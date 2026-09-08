import { createNodeShape, type Extension } from '@lifeboard/node-kit'
import { Heart } from 'lucide-react'
import { healthNodes } from './definition'
import { HealthSettings } from './HealthSettings'
import { refreshHealth } from './store'

export const healthExtension: Extension = {
  id: 'lifeboard.health', name: 'Apple Health', icon: Heart, version: '0.1.0', author: 'Lifeboard',
  description: 'Daily activity, sleep and recovery from Health Auto Export. Start Lifeboard, choose the iCloud export folder in this extension’s settings, and explore your history offline.',
  details: [
    'Steps, energy, sleep, weight, heart rate, HRV, temperature and breathing each have their own card. Change a card between daily bars, a trend, a heat strip or one number. The overview brings the previous week together.',
    'On iPhone, use an iCloud Drive automation with Health Metrics, JSON Version 2, Date Range Day, Time Grouping Days, and Summarize Data on. Run one manual seven-day export, then enable its automatic schedule.',
    'Running pnpm dev starts the importer too. In this extension’s settings, choose the folder Health Auto Export created. Lifeboard accepts any JSON filename and searches its dated subfolders.',
    'Disabling this extension hides its creation tools and pauses browser refresh. Existing cards keep rendering their cached data. Stopping Lifeboard’s development process stops local importing.',
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
