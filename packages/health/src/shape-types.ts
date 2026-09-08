import type { NodeBaseProps } from '@lifeboard/node-kit'
import type { HealthNodeProps } from './definition'
declare module '@tldraw/tlschema' {
  interface TLGlobalShapePropsMap {
    'node.health.overview': HealthNodeProps & NodeBaseProps
    'node.health.steps': HealthNodeProps & NodeBaseProps
    'node.health.activeEnergy': HealthNodeProps & NodeBaseProps
    'node.health.basalEnergy': HealthNodeProps & NodeBaseProps
    'node.health.sleep': HealthNodeProps & NodeBaseProps
    'node.health.weight': HealthNodeProps & NodeBaseProps
    'node.health.hrv': HealthNodeProps & NodeBaseProps
    'node.health.restingHeartRate': HealthNodeProps & NodeBaseProps
    'node.health.heartRate': HealthNodeProps & NodeBaseProps
    'node.health.wristTemperature': HealthNodeProps & NodeBaseProps
    'node.health.bodyTemperature': HealthNodeProps & NodeBaseProps
    'node.health.oxygen': HealthNodeProps & NodeBaseProps
    'node.health.respiratoryRate': HealthNodeProps & NodeBaseProps
  }
}
