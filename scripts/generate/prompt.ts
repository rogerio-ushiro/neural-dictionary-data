// Prompt for one GenerationTask (T5.1, D12). The subagent/model estimates,
// per candidate: a `relation_type` from the §7 taxonomy (D1) and an
// `association_strength` (0..1, replaces v0.3's "proximity" — D3). Still
// dormant on the API path (`--source api`, D15 keeps it off); documents the
// contract any provider — file, subagent, API — must produce.

import { RELATION_TYPE_WORKING_SET } from '../../src/model/v04/config'
import type { GenerationTask } from './contract'

export const MODEL = 'claude-haiku-4-5'

/** How many candidates to request per task (before dedup/relevance cuts). */
export const CANDIDATES_PER_TASK = 14

export const SYSTEM = [
  "Sei un lessicografo dell'italiano che costruisce un grafo di associazioni semantiche tipizzate.",
  'Dato un lemma, i suoi rapporti già noti e le dimensioni semantiche ancora scoperte,',
  'proponi nuovi candidati — non ripetere rapporti già elencati come "existing_relations".',
  `Ogni candidato ha: "lemma" (italiano, forma di dizionario, una sola parola salvo locuzioni note),`,
  `"relation_type" (uno tra: ${RELATION_TYPE_WORKING_SET.join(', ')}),`,
  '"association_strength" da 0 a 1 (1 = rapporto fortissimo, 0 = nessuno),',
  'opzionalmente "confidence" da 0 a 1 (quanto sei sicuro del candidato).',
  'Se il lemma proposto è nuovo nel grafo, indica anche "pos"',
  '(sostantivo|verbo|aggettivo|avverbio|locuzione) e, se ovvia, "region".',
  'Priorità: copri prima le dimensioni mancanti elencate ("missing_relation_types"),',
  'soprattutto quelle strutturali (categoria, costituzione, parti, contenuto)',
  'prima di quelle evocative. Niente nomi propri. Niente duplicati.',
  'Rispondi SOLO con JSON valido, senza testo attorno, in questa forma:',
  '{"candidates":[{"lemma":"...","relation_type":"...","association_strength":0.0}]}',
].join(' ')

export function buildUserPrompt(task: GenerationTask): string {
  return [
    `Lemma: "${task.word}" (concept_id: ${task.concept_id}).`,
    `Rapporti già noti: ${JSON.stringify(task.existing_relations)}.`,
    `Dimensioni già coperte: ${task.covered_relation_types.join(', ') || '(nessuna)'}.`,
    `Dimensioni mancanti: ${task.missing_relation_types.join(', ')}.`,
    `Regione attuale: ${task.region ?? '(nessuna)'}.`,
    `Dammi fino a ${CANDIDATES_PER_TASK} candidati.`,
  ].join(' ')
}
