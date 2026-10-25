// The syllabus is a source for skill trees; the package barrel registers it for the app, and tests
// that import modules directly get it here.
import { registerTreeSource } from '@lifeboard/skill-tree'
import { syllabusTreeSource } from './syllabusSource'

registerTreeSource(syllabusTreeSource)
