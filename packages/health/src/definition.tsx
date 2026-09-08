import { defineNode, emptyPropsMigrations, type NodeDefinition } from '@lifeboard/node-kit'
import { METRICS, METRIC_KEYS, type Metric } from '@lifeboard/health-core'
import { Heart, Moon, Footprints, Activity, Scale, CalendarDays } from 'lucide-react'
import { T } from 'tldraw'
import { HealthNode } from './HealthNode'
import { getHealthState } from './store'

export interface HealthNodeProps {
  metric: Metric
  datasetId: string
  range: '7' | '30' | '90' | 'lastWeek' | 'yesterday' | 'fixed'
  start: string
  end: string
  chart: 'bars' | 'line' | 'heatmap' | 'stages' | 'number'
  source: string
}
export const HEALTH_TYPES = METRIC_KEYS.map(metric => `node.health.${metric}`)
export function healthDefinition(metric: Metric, overview = false): NodeDefinition<HealthNodeProps> {
  return {
    type: overview ? 'node.health.overview' : `node.health.${metric}`,
    label: overview ? 'Health overview' : METRICS[metric].label,
    icon: '♥',
    toolbarIcon: overview ? CalendarDays : metric === 'sleep' ? Moon : metric === 'steps' ? Footprints : metric === 'weight' ? Scale : metric.includes('Energy') ? Activity : Heart,
    props: {
      metric: T.literalEnum(...METRIC_KEYS), datasetId: T.string,
      range: T.literalEnum('7', '30', '90', 'lastWeek', 'yesterday', 'fixed'), start: T.string, end: T.string,
      chart: T.literalEnum('bars', 'line', 'heatmap', 'stages', 'number'), source: T.string,
    },
    migrations: emptyPropsMigrations(),
    defaultProps: () => ({ metric, datasetId: '', range: overview ? 'lastWeek' : '30', start: '', end: '', chart: ['weight', 'hrv', 'restingHeartRate', 'heartRate', 'wristTemperature', 'bodyTemperature'].includes(metric) ? 'line' : 'bars', source: '' }),
    onCreate: ({ shape }) => !shape.props.datasetId && getHealthState().snapshot ? { datasetId: getHealthState().snapshot!.datasetId } : null,
    defaultSize: overview ? { w: 690, h: 335 } : { w: 335, h: 280 },
    component: HealthNode,
    canEdit: true,
    canScroll: true,
    strips: 'below',
    getLabel: () => overview ? 'Health overview' : METRICS[metric].label,
    excludeFromAgentImages: true,
  }
}
export const healthDefinitions = [healthDefinition('steps', true), ...METRIC_KEYS.map(metric => healthDefinition(metric))]
export const healthNodes = healthDefinitions.map(defineNode)
