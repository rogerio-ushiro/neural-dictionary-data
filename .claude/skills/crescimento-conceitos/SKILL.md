---
name: crescimento-conceitos
description: Roda um ciclo de crescimento do grafo do neural-dictionary — seleciona um lote de conceitos na fronteira, gera associações E definições novas seguindo as regras de conteúdo, aplica no seed, refaz os packs e abre um PR. Use quando quiser expandir o volume de conceitos/associações do dicionário. NÃO faz deploy — o deploy é pós-merge, pelo workflow.
---

# Crescimento de conceitos

Orquestra um ciclo completo da routine de crescimento **dentro do repo
`neural-dictionary-data`** (caminho canônico
`/Users/rushiro/Documents/git/neural-dictionary-data/`). É a implementação de D15
(a própria sessão do Claude Code é o "subagente" gerador, sem chave de API
separada). Detalhe do fluxo em `docs/projetos/neural-dictionary-data/design/routine-espansione.md`.

**Gate de revisão humana:** esta skill produz um **PR** e para aí. A promoção
`candidate → validated` e o deploy dos packs só acontecem depois que um humano
mergeia o PR (`.github/workflows/promote-merged-candidates.yml` →
`.github/workflows/pages.yml`). **Nunca** rode `build-packs`/deploy contra `main`
nem chame `gh pr merge` como parte desta skill.

## Passo 0 — Pré-condições

- Estar numa branch nova dedicada ao lote (`git checkout -b routine/<data>-<n>` a
  partir de `main` atualizada) — segue [[branch-nova-por-tarefa]] e
  [[commits-autorizacao]] (propor o nome, aguardar confirmação).
- `git status` limpo. `npm test` verde no ponto de partida.
- Confirmar que não há PR de rotina aberto tocando os mesmos conceitos
  (limitação conhecida — ver `routine-espansione.md` §"Limitação conhecida").

## Passo 1 — Selecionar o lote

```
npx tsx scripts/routine/select-batch.ts --n 10
```

Escreve um array de `GenerationTask` (default `scripts/routine/.batch/tasks.json`).
São os N conceitos de maior `expansion_priority` ainda `needs_expansion`. Para
cada um, anotar: `concept_id`, lema primário, associados `validated` atuais.

`--n 10` é o default D13 (`DEFAULT_BATCH_SIZE` em `select-batch.ts`,
`routine-espansione.md` §"D13"). Ciclos recentes rodaram lotes maiores (até ~25):
mais throughput por PR, mas a autoria por conceito fica mais rasa/formulaica.
Manter perto de 10 quando a qualidade do conteúdo importa; só subir para
throughput bruto em conceitos-folha simples.

## Passo 2 — Gerar o conteúdo (o subagente = você)

Para **cada** conceito do lote, montar o contexto e gerar duas coisas:

### 2a. Fontes de associação — `scripts/generate/data/<lemma_normalizado>.json`

Formato: `[{ lemma, relation_type, association_strength, confidence?, pos?, region? }]`.
Regras:
- `relation_type` do working set de 15 dimensões + `associata` — ver
  `design/taxonomia-relazioni.md`. Representação simétrica pura.
- Mirar o critério de saída D9 (`design/pipeline-generazione.md`): grau ≥ 8,
  ≥ 5 dimensões distintas, `categoria` presente — senão o conceito não vira
  `expanded` na promoção.
- `association_strength` 0..1 (raio do anel). `confidence` fica pro gate.
- Quando a associação natural exige um lema que ainda não é conceito, **deixar o
  pipeline mintar** (e escrever a definição, ver 2b) — não trocar por um
  quase-sinônimo mais fraco só para evitar o trabalho da definição. Trocas
  forçadas por sinônimo fraco degradam a qualidade e deixam o léxico com buracos.

### 2b. Definições — `scripts/generate/definitions/data/<concept_id>.json`

Formato: `{ concept_id, text, example }`, **italiano**. Regra **D2** (ver
`design/definizioni.md`): o `text` descreve **função / uso** da palavra (registro,
sentido figurado quando natural), **não** taxonomia nem lista de propriedades;
prefere vocabulário **fora** da lista de associados. `example` = 1 frase de uso
natural. Montar o `SenseContext` com `scripts/generate/definitions/context.ts`
para fixar o sentido certo antes de escrever.

Gerar também definição para qualquer **conceito novo** que as associações do
passo 2a introduzam (o pipeline minta conceitos para lemas ainda sem `concept_id`).

## Passo 3 — Rodar o pipeline + re-pack

```
npx tsx scripts/routine/finish-batch.ts --concepts <c_id,c_id,...>
```

Faz `runPipeline` (classify → dedup → relevance → coverage → publish, tudo como
`status: candidate`) sobre `seed ∪ batch`, promove `candidate/graph.json` →
`seed/graph.json` (ainda `candidate`), e refaz `public/data` (`build-packs` +
`manifest` + `patch`). Depois:

```
npx tsx scripts/generate/definitions/apply.ts        # merge das definições no seed (backup em .local-backups/)
```

Rodar de novo `build-packs`+`manifest`+`patch` se `apply.ts` mudou o seed
(ele bumpa `revision` dos conceitos com definição nova).

## Passo 4 — Validar

- `npm test` verde (incl. `packs-in-sync` e `dedupe` round-trip).
- `npx tsx scripts/generate/definitions/report.ts` — cobertura de definição não
  regrediu.
- `npx tsx scripts/routine/promote-candidates.ts --dry-run` — não escreve nada;
  imprime quantas associações/conceitos a promoção validaria, o resultado de
  `validatePublishedClosure` (**tem que passar** — nenhum `expanded` com 0
  associados `validated`), e a lista de conceitos ainda aquém do D9 com o motivo
  (`deg<8` / `dim<5` / `cat=false`). Se `validatePublishedClosure` falharia ou
  um conceito do lote aparece na lista, o lote está incompleto — voltar ao Passo 2.
- Amostra manual: centralizar 3-4 dos conceitos novos no preview
  (`VITE_DATA_BASE_URL` apontando pro `public/data` local) e conferir grafo +
  modal de definição.

## Passo 5 — Commit + PR

- `git add` só o que o lote tocou (`finish-batch.ts` lista em `changedPaths`):
  `src/data/v04/seed/graph.json`, `public/data/**`, `scripts/generate/data/*.json`
  novos, `scripts/generate/definitions/data/*.json` novos.
- `msg 100` no formato de [[atalhos-msg-desc]] (inglês). Commit + push da branch.
- Abrir PR (`gh pr create`) com a lista de conceitos do lote e um resumo das
  dimensões cobertas. **Parar aqui.**

## Passo 6 — Limpeza de dado de teste

Se o ciclo foi um teste (dado rastreado `ZZZ Teste ...`), reverter: novo PR que
remove as entradas de teste do seed + `data/`, re-pack, validar que o grafo volta
ao estado anterior. Segue [[rastreio-dados-teste]].

## Como pausar / não ativar

O agendamento recorrente (`/schedule`) **não** faz parte desta skill — é uma
ação autônoma com efeito real no repo (PRs recorrentes), pendente de
confirmação explícita separada. Esta skill roda **um** ciclo, sob demanda.
