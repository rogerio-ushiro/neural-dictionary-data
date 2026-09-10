import { describe, expect, it, vi } from 'vitest'
import { fileSource } from './file-source'
import type { GenerationTask } from './contract'

const taskFor = (word: string): GenerationTask => ({
  concept_id: 'c_9999',
  word,
  existing_relations: [],
  covered_relation_types: [],
  missing_relation_types: [],
  region: null,
})

describe('fileSource', () => {
  it('returns [] and warns to stderr when the concept has no data file', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      const out = fileSource(taskFor('zzz-parola-inesistente-per-teste'))
      expect(out).toEqual([])
      expect(stderr).toHaveBeenCalledTimes(1)
      expect(String(stderr.mock.calls[0][0])).toContain('0 associations for "zzz-parola-inesistente-per-teste"')
    } finally {
      stderr.mockRestore()
    }
  })
})
