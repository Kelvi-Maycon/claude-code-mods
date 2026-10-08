// Preços da API da Anthropic em US$ por milhão de tokens e janela de contexto, da tabela da skill claude-api
// (cache de 2026-10-06). Cache escrito conta 1,25x a entrada (TTL de 5 min); cache lido, o valor da tabela.
// Modelo fora da tabela fica sem custo estimado.

type Preco = { entrada: number; saida: number; lido: number; janela: number }

const M = 1_000_000
const PRECOS: Record<string, Preco> = {
  'fable-5-1': { entrada: 10, saida: 50, lido: 0.25, janela: M },
  'mythos-5-1': { entrada: 10, saida: 50, lido: 0.25, janela: M },
  'fable-5': { entrada: 10, saida: 50, lido: 1, janela: M },
  'mythos-5': { entrada: 10, saida: 50, lido: 1, janela: M },
  'opus-5-5': { entrada: 4, saida: 20, lido: 0.2, janela: M },
  'opus-5': { entrada: 5, saida: 25, lido: 0.5, janela: M },
  'opus-4-8': { entrada: 5, saida: 25, lido: 0.5, janela: M },
  'opus-4-7': { entrada: 5, saida: 25, lido: 0.5, janela: M },
  'opus-4-6': { entrada: 5, saida: 25, lido: 0.5, janela: M },
  'sonnet-5-5': { entrada: 2, saida: 10, lido: 0.2, janela: M },
  'sonnet-5': { entrada: 2, saida: 10, lido: 0.2, janela: M },
  'sonnet-4-6': { entrada: 3, saida: 15, lido: 0.3, janela: M },
  'haiku-5-5': { entrada: 0.1, saida: 0.5, lido: 0.01, janela: M },
  'haiku-4-5': { entrada: 1, saida: 5, lido: 0.1, janela: 200_000 },
}
// Haiku 5.5 cobra 5x acima de 100 mil tokens de prompt.
const HAIKU_LONGO = 100_000

export type UsoDaApi = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

/** "us.anthropic.claude-opus-5-5-20260401[1m]" vira "opus-5-5". */
function chaveDoModelo(id: string) {
  return id
    .toLowerCase()
    .replace(/\[.*\]$/, '')
    .replace(/^.*claude-/, '')
    .replace(/[-@]\d{8}$/, '')
    .replace(/-v\d+(:\d+)?$/, '')
}

const precoDe = (modelo: string): Preco | undefined => PRECOS[chaveDoModelo(modelo)]

export const janelaDe = (modelo: string) => precoDe(modelo)?.janela ?? 0

/** Contexto que o passo ocupou: entrada, cache lido e cache escrito. */
export const contextoDe = (uso: UsoDaApi) => uso.input_tokens + uso.cache_read_input_tokens + uso.cache_creation_input_tokens

/** Custo de uma resposta em US$; null para modelo sem preço conhecido. */
export function custoDe(modelo: string, uso: UsoDaApi): number | null {
  const preco = precoDe(modelo)
  if (!preco) return null
  const fator = chaveDoModelo(modelo) === 'haiku-5-5' && contextoDe(uso) > HAIKU_LONGO ? 5 : 1
  const usd =
    uso.input_tokens * preco.entrada * fator +
    uso.cache_creation_input_tokens * preco.entrada * 1.25 * fator +
    uso.cache_read_input_tokens * preco.lido * fator +
    uso.output_tokens * preco.saida * fator

  return usd / M
}

export const somarUsd = (a: number | null, b: number | null) => (a === null || b === null ? null : a + b)
