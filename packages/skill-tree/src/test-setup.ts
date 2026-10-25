// The syllabus is a source for skill trees (sources.ts); the app registers it from the package
// barrel, and tests that import modules directly get it here.
import { registerTreeSource } from './sources'
import { syllabusTreeSource } from './syllabusSource'

registerTreeSource(syllabusTreeSource)
