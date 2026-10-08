import type { Cache, Contexto, Limite, Uso } from '../types'

const MINUTO = 60_000
const HORA = 60 * MINUTO
const JANELA = { cinco: 5 * HORA, sete: 7 * 24 * HORA }
/** O cache do prompt vale 60 min a partir do fim do último turno principal. */
export const TTL_CACHE_MS = 60 * MINUTO
const QUASE_FRIO_MS = 10 * MINUTO
const CTX_ALERTA = 0.85
/** No lugar do valor que ainda não existe. */
export const SEM_DADO = '–'

export type Tom = 'cinco' | 'sete' | 'ctx' | 'cache'
/** Cores da paleta: `orange` no uso normal, `pos`, `warn` e `neg` para estado. */
export type Cor = 'orange' | 'pos' | 'warn' | 'neg'

export type Pilula = {
  tom: Tom
  rotulo: '5h' | '7d' | 'ctx' | 'cache'
  /** Fração cheia da barrinha, de 0 a 1; null sem dado. */
  cheio: number | null
  /** Cor do cheio; no cache o desenho usa o degradê `neg` → `warn` → `pos` e a cor marca o estado. */
  cor: Cor
  /** O número em destaque (`20%`) ou `SEM_DADO`. */
  valor: string
  /** Cor do valor quando ele carrega o estado (cache frio); null no `ink` de sempre. */
  tinta: 'neg' | null
  /** Fração da janela já decorrida, de 0 a 1, para o marcador; só nos limites com horário de reset. */
  ritmo: number | null
  /** Dado secundário em partes (`resta 44m`, `hit 98%`); falta espaço, sai da última para a primeira. */
  extra: string[]
}

/** `145k`, `1M`, `1.2M`; abaixo de mil, o número inteiro. */
export function tokens(n: number): string {
  if (n >= 999_500) {
    return `${Number((n / 1_000_000).toFixed(1))}M`
  }

  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
}

/** `2h 40m`, `1d 7h`, `40m`. */
export function falta(ms: number): string {
  const min = Math.max(0, Math.round(ms / MINUTO))
  const d = Math.floor(min / 1440)
  const h = Math.floor((min % 1440) / 60)

  if (d > 0) {
    return `${d}d ${h}h`
  }

  return h > 0 ? `${h}h ${min % 60}m` : `${min}m`
}

const fracao = (v: number) => Math.min(1, Math.max(0, v))

function limite(tom: 'cinco' | 'sete', l: Limite, agora: number): Pilula {
  const resta = l.zeraEm === null ? null : Math.max(0, l.zeraEm - agora)
  const usado = Math.min(100, Math.max(0, Math.round(l.usado)))

  return {
    tom,
    rotulo: tom === 'cinco' ? '5h' : '7d',
    cheio: usado / 100,
    cor: 'orange',
    valor: `${usado}%`,
    tinta: null,
    ritmo: resta === null ? null : fracao(1 - resta / JANELA[tom]),
    extra: resta === null ? [] : [falta(resta)],
  }
}

// Contexto atual sobre o ponto de compactação: `warn` acima de 85%, `neg` a partir de 100%.
function contexto(c: Contexto | null): Pilula {
  const base = { tom: 'ctx', rotulo: 'ctx', tinta: null, ritmo: null } as const

  if (!c || c.tokens === null) {
    return { ...base, cheio: null, cor: 'orange', valor: SEM_DADO, extra: [] }
  }

  const usado = c.tokens / c.limite

  return {
    ...base,
    cheio: fracao(usado),
    cor: usado >= 1 ? 'neg' : usado > CTX_ALERTA ? 'warn' : 'orange',
    valor: `${Math.round(usado * 100)}%`,
    extra: [`${tokens(c.tokens)} / ${tokens(c.limite)}`],
  }
}

// Quanto do TTL ainda resta: cheia logo depois do turno e durante ele (o cache está sendo renovado),
// vazia quando esfriou. `pos` quente, `warn` nos últimos 10 min, `neg` frio.
function cache(c: Cache | null, agora: number): Pilula {
  const base = { tom: 'cache', rotulo: 'cache', ritmo: null } as const

  if (!c) {
    return { ...base, cheio: null, cor: 'pos', valor: SEM_DADO, tinta: null, extra: [] }
  }

  const resta = c.rodando ? TTL_CACHE_MS : Math.max(0, c.fim + TTL_CACHE_MS - agora)
  const frio = resta <= 0
  const hit = c.hit === null ? [] : [`hit ${c.hit}%`]

  return {
    ...base,
    cheio: resta / TTL_CACHE_MS,
    cor: frio ? 'neg' : resta <= QUASE_FRIO_MS ? 'warn' : 'pos',
    valor: `${Math.round((100 * resta) / TTL_CACHE_MS)}%`,
    tinta: frio ? 'neg' : null,
    extra: frio ? ['frio'] : [`resta ${Math.ceil(resta / MINUTO)}m`, ...hit],
  }
}

/** Os grupos na ordem do desenho: 5h e 7d quando a API informa, ctx e cache sempre. */
export function pilulas(uso: Uso): Pilula[] {
  return [
    ...(uso.cincoHoras ? [limite('cinco', uso.cincoHoras, uso.agora)] : []),
    ...(uso.seteDias ? [limite('sete', uso.seteDias, uso.agora)] : []),
    contexto(uso.ctx),
    cache(uso.cache, uso.agora),
  ]
}

/** Quantas partes de dado secundário a linha tem: o máximo que `semExtra` tira. */
export const extras = (lista: Pilula[]) => lista.reduce((soma, p) => soma + p.extra.length, 0)

/** A lista sem as `quantos` últimas partes de dado secundário: o que sai primeiro quando falta espaço. */
export function semExtra(lista: Pilula[], quantos: number): Pilula[] {
  let tira = quantos

  return lista
    .slice()
    .reverse()
    .map(p => {
      const fica = Math.max(0, p.extra.length - tira)
      tira -= p.extra.length - fica

      return fica === p.extra.length ? p : { ...p, extra: p.extra.slice(0, fica) }
    })
    .reverse()
}

/** Um grupo em texto, em três partes: `5h`, `▰▱▱▱▱`, `20% · 2h40m`. */
export function partes(p: Pilula): { barra: string; resto: string } {
  const cheios = Math.round((p.cheio ?? 0) * 5)
  const juntos = p.extra.join(' · ')
  const extra = p.tom === 'cache' ? juntos : juntos.replaceAll(' ', '')

  return {
    barra: '▰'.repeat(cheios) + '▱'.repeat(5 - cheios),
    resto: extra ? `${p.valor} · ${extra}` : p.valor,
  }
}

export function texto(p: Pilula): string {
  const { barra, resto } = partes(p)

  return `${p.rotulo} ${barra} ${resto}`
}

/** A linha inteira: `5h ▰▱▱▱▱ 20% · 2h40m │ … │ cache ▰▰▰▰▱ 73% · resta 44m · hit 98% │ ds on`. */
export function linha(lista: Pilula[], dsLigado?: boolean): string {
  return [...lista.map(texto), ...(dsLigado === undefined ? [] : [rotuloDs(dsLigado)])].join(' │ ')
}

/** O grupo do DS: o estado que o `ds-primeiro` publica nesta sessão. */
export const rotuloDs = (ligado: boolean) => `ds ${ligado ? 'on' : 'off'}`
