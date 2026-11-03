import { extras, semExtra } from './modelo'
import type { Pilula, Tom } from './modelo'

// Desenho com uma paleta própria de cores, tipografia e medidas, na mesma
// pele da barra de progresso logo abaixo: cada grupo é uma superfície `soft` de 24 px, raio pill e sem contorno, um
// passo mais clara que a trilha do progresso (#2D2C29 no escuro) para destacar do fundo da banda; as pílulas da faixa
// de pendências (progresso/hooks/svg.ts) usam o mesmo `soft`. Dentro, ícone `muted`, rótulo mono em caixa alta `ink`, medidor de 6 px
// (`line` com o cheio em `orange` ou na cor de estado), valor em sans 13 px 600 e o secundário em `muted`.
export const ALTURA = 28
const ALT_PILULA = 24
const TOPO = (ALTURA - ALT_PILULA) / 2
const MEIO = ALTURA / 2
// As pilhas da barra de progresso: o desenho é uma imagem isolada e, sem as fontes do DS instaladas, cai na
// fonte do app e na do sistema, sem buscar nada em rede.
const SANS = "'Instrument Sans','Anthropic Sans',system-ui,sans-serif"
const MONO = "'JetBrains Mono',ui-monospace,'SF Mono',Menlo,monospace"

/** Os tokens de cor do DS nos dois temas. `ink` e `muted` sobre `soft` passam de 4,5:1. */
export const PALETA = {
  claro: {
    soft: '#E2DDD3',
    // Trilha do medidor e fio: `line` aparece sobre `soft` nos dois temas.
    line: '#CBC6BB',
    ink: '#1D1D1B',
    muted: '#5A5952',
    orange: '#F05A37',
    pos: '#2F7A36',
    warn: '#946200',
    neg: '#C42B3E',
    // Preenchimento não é texto: o degradê do cache e o ctx em alerta usam os tons vivos da paleta.
    g0: '#FF7A6B',
    g1: '#F2B53A',
    g2: '#2F7A36',
  },
  escuro: {
    soft: '#33322E',
    line: '#4E4B46',
    ink: '#F1EDE4',
    muted: '#ABA69B',
    orange: '#F05A37',
    pos: '#D8F35A',
    warn: '#F2B53A',
    neg: '#FF7A6B',
    g0: '#FF7A6B',
    g1: '#F2B53A',
    g2: '#D8F35A',
  },
} as const

const css = (t: (typeof PALETA)[keyof typeof PALETA]) =>
  `.p{fill:${t.soft}}.i{stroke:${t.muted}}.ip{fill:${t.muted}}.r,.v{fill:${t.ink}}.s{fill:${t.muted}}.tr{fill:${t.line}}.tf{fill:${t.orange}}.pos{fill:${t.pos}}.warn{fill:${t.warn}}.neg{fill:${t.neg}}.off{fill:${t.muted}}.g0{stop-color:${t.g0}}.g1{stop-color:${t.g1}}.g2{stop-color:${t.g2}}.mk{fill:${t.ink};stroke:${t.soft}}.dv{fill:${t.muted}}.tf.warn{fill:${t.g1}}.tf.neg{fill:${t.g0}}.lg{fill:${t.pos}}.dl{fill:none;stroke:${t.muted}}`
const ESTILO = `<style>text{dominant-baseline:central}.v{font:600 13px ${SANS};font-variant-numeric:tabular-nums}
.s{font:500 12px ${SANS};font-variant-numeric:tabular-nums}.r{font:500 10.5px ${MONO};letter-spacing:.08em;text-transform:uppercase}
.i{fill:none;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}.mk{stroke-width:2;paint-order:stroke}.dl{stroke-width:1.5}
${css(PALETA.claro)}
@media (prefers-color-scheme:dark){${css(PALETA.escuro)}}</style>`

// Ícones desenhados para esta faixa numa grade de 14 px, sem escala: traço de 1,5 com pontas redondas, a
// mesma caixa útil (1,75 a 12,25) e os pontos cheios, para que todos tenham o mesmo peso a 1x e 2x.
const LADO = 14
const ICONE: Record<Tom | 'ds', string> = {
  // Velocímetro: o limite de 5 h é ritmo de uso.
  cinco: '<path d="M2.2 10.6A5.4 5.4 0 1 1 11.8 10.6"/><path d="m7 8.3 2.4-2.4"/>',
  // Calendário: a janela de 7 dias.
  sete: '<rect x="1.75" y="2.75" width="10.5" height="9.5" rx="2"/><path d="M1.75 6h10.5M4.75 1.5V4M9.25 1.5V4"/>',
  // Camadas: o contexto empilhado.
  ctx: '<path d="M7 1.9 12.25 4.8 7 7.7 1.75 4.8Z"/><path d="m1.75 8.2 5.25 2.9 5.25-2.9"/>',
  // Cilindro: o cache do prompt.
  cache: '<ellipse cx="7" cy="3.6" rx="5.25" ry="1.85"/><path d="M1.75 3.6v6.8c0 1 2.35 1.85 5.25 1.85s5.25-.85 5.25-1.85V3.6"/><path d="M1.75 7c0 1 2.35 1.85 5.25 1.85S12.25 8 12.25 7"/>',
  // Paleta: o design system.
  ds: '<path d="M7 1.75a5.25 5.25 0 0 0 0 10.5c.85 0 1.3-.65 1.05-1.4-.3-.85.3-1.6 1.2-1.6h1.2a1.8 1.8 0 0 0 1.8-1.8c0-3.1-2.35-5.7-5.25-5.7Z"/>',
}
// Os pontos da paleta vão cheios: traço de 1,5 em raio de meio pixel some a 1x.
const PONTOS_DS = '<circle cx="4.4" cy="6.9" r=".95"/><circle cx="5.6" cy="4.2" r=".95"/><circle cx="8.6" cy="4" r=".95"/>'
// Relógio do tempo até zerar, menor que os ícones das pílulas (12 px), no mesmo traço.
const RELOGIO = '<circle cx="6" cy="6" r="4.75"/><path d="M6 3.6V6l1.6 1.1"/>'
const LADO_RELOGIO = 12

// Largura estimada do texto, porque o SVG não mede: avanço por letra, em em, da fonte do sistema a 12 px e
// peso 500 (a que a imagem usa sem essas fontes instaladas), na mesma tabela da barra de progresso; o 600 é 2,3% mais
// largo. Dígitos tabulares contam todos 0,62. Rótulo mono: 0,6 em mais o espaçamento de .08 em.
const AVANCOS: [number, string][] = [
  [0.26, 'ij'],
  [0.276, ' l|'],
  [0.315, ",./:·"],
  [0.379, 'f'],
  [0.396, 'rt'],
  [0.483, '-'],
  [0.521, 's'],
  [0.562, 'ackvxyz'],
  [0.597, 'ehnou–'],
  [0.62, '0123456789'],
  [0.641, 'bdgpq'],
  [0.887, 'm'],
  [0.962, '%'],
]
const AVANCO = new Map(AVANCOS.flatMap(([em, letras]) => [...letras].map(letra => [letra, em] as const)))
const sans = (s: string, px = 12, peso: 500 | 600 = 500) =>
  [...s].reduce((w, ch) => w + (AVANCO.get(ch) ?? 0.6), 0) * px * (peso === 600 ? 1.023 : 1) * 1.03
const mono = (s: string) => s.length * 10.5 * 0.68

const n = (v: number) => String(Math.round(v * 10) / 10)
// O app desenha cada imagem em células de 8 px: uma largura fora da grade crescia na tela e a soma estourava a
// linha. Cabeça, cauda e DS fecham num múltiplo de 8, com a sobra dividida dos dois lados do conteúdo.
const CELULA = 8
const naGrade = (natural: number) => Math.ceil(natural / CELULA) * CELULA
const desloca = (dx: number, conteudo: string) => (dx > 0 ? `<g transform="translate(${n(dx)} 0)">${conteudo}</g>` : conteudo)
const icone = (x: number, lado: number, desenho: string, cheios = '') =>
  `<g transform="translate(${n(x)} ${n(MEIO - lado / 2)})"><g class="i">${desenho}</g>${cheios ? `<g class="ip">${cheios}</g>` : ''}</g>`
const letras = (x: number, s: string, classe: string) => `<text x="${n(x)}" y="${MEIO}" class="${classe}">${s}</text>`
// O fundo da pílula atravessa os três pedaços: a cabeça leva a ponta redonda da esquerda e passa da borda dela (a
// imagem corta), o meio é reto em 100% e a cauda leva a ponta da direita.
const fundo = (x: number, largura: number | string, tom = '', rx = ALT_PILULA / 2) =>
  `<rect class="p"${tom ? ` data-tom="${tom}"` : ''} x="${x}" y="${TOPO}" width="${largura}" height="${ALT_PILULA}"${rx ? ` rx="${rx}"` : ''}/>`

// Ritmo horizontal de toda pílula, com um vão de 6 entre os itens: 8 de respiro à esquerda, ícone de 14, 6 até
// o rótulo, 6 entre rótulo, medidor e valor, e 10 à direita (o valor em negrito pesa mais que o ícone na outra
// ponta). Apertado assim, a 112 colunas cabem os cinco grupos com todo o dado secundário.
const ESQ = 8
const DIR = 10
const GAP_ICONE = 6
const GAP = 6
// O secundário vem depois de um ponto de 3 px, com 6 de cada lado; nos limites, um relógio e 4 até o texto.
const GAP_SEP = 6
const GAP_RELOGIO = 4

// Os limites trazem um relógio antes do tempo até zerar; ctx e cache, só o texto.
const temRelogio = (p: Pilula) => p.tom === 'cinco' || p.tom === 'sete'
const extraDe = (p: Pilula) => p.extra.join(' · ')
const ALT_BARRA = 6

type Pedaco = { largura: number; svg: string }

/** Ícone e rótulo, com o vão até o medidor: largura natural, na grade de 8. */
function cabeca(p: Pilula): Pedaco {
  const rotulo = ESQ + LADO + GAP_ICONE
  const natural = Math.round(rotulo + mono(p.rotulo) + GAP)
  const largura = naGrade(natural)

  return {
    largura,
    svg: fundo(0, largura + ALT_PILULA, p.tom) + desloca((largura - natural) / 2, icone(ESQ, LADO, ICONE[p.tom]) + letras(rotulo, p.rotulo, 'r')),
  }
}

/** O vão depois do medidor, o valor, o secundário e o respiro direito: largura natural, na grade de 8. */
function cauda(p: Pilula): Pedaco {
  const partes: string[] = []
  let cx = GAP
  partes.push(letras(cx, p.valor, p.tinta ? `v b ${p.tinta}` : 'v b'))
  cx += sans(p.valor, 13, 600)

  if (p.extra.length > 0) {
    const sep = Math.round(cx + GAP_SEP) + 1.5
    partes.push(`<circle class="dv" cx="${sep}" cy="${MEIO}" r="1.5"/>`)
    cx = sep + 1.5 + GAP_SEP

    if (temRelogio(p)) {
      partes.push(icone(cx, LADO_RELOGIO, RELOGIO))
      cx += LADO_RELOGIO + GAP_RELOGIO
    }

    partes.push(letras(cx, extraDe(p), 's'))
    cx += sans(extraDe(p))
  }

  const natural = Math.ceil(cx + DIR)
  const largura = naGrade(natural)

  return { largura, svg: fundo(-ALT_PILULA, largura + ALT_PILULA) + desloca((largura - natural) / 2, partes.join('')) }
}

const pct = (v: number) => `${n(v * 100)}%`

/**
 * O medidor, sem largura: o SVG tem width 100% e nenhum viewBox, e toda a geometria horizontal é em %, então ele
 * ocupa o que o Box que estica der. `escala` só encolhe a altura, junto com cabeça e cauda.
 */
function medidor(p: Pilula, altura: number, escala: number): string {
  const e = (v: number) => n(v * escala)
  const yb = MEIO - ALT_BARRA / 2
  const partes = [
    `<rect class="p" y="${e(TOPO)}" width="100%" height="${e(ALT_PILULA)}"/>`,
    `<rect class="tr" y="${e(yb)}" width="100%" height="${e(ALT_BARRA)}" rx="${e(ALT_BARRA / 2)}"/>`,
  ]

  // O cache leva o degradê `neg` → `warn` → `pos` na largura da trilha: o cheio mostra até onde resta.
  if (p.tom === 'cache') {
    partes.push(
      '<linearGradient id="dg" gradientUnits="userSpaceOnUse" x1="0" x2="100%" y1="0" y2="0"><stop offset="0" class="g0"/><stop offset=".5" class="g1"/><stop offset="1" class="g2"/></linearGradient>',
    )
  }

  const cheio = p.cheio ?? 0

  if (cheio > 0) {
    const classe = p.tom === 'cache' ? 'tf' : p.cor === 'orange' ? 'tf' : `tf ${p.cor}`
    // Nunca menor que a própria altura: o cheio mínimo é um ponto redondo, não uma lasca.
    const estilo = `${p.tom === 'cache' ? 'fill:url(#dg);' : ''}width:max(${e(ALT_BARRA)}px,${pct(Math.min(1, cheio))})`
    partes.push(`<rect class="${classe}" style="${estilo}" y="${e(yb)}" width="${pct(Math.min(1, cheio))}" height="${e(ALT_BARRA)}" rx="${e(ALT_BARRA / 2)}"/>`)
  }

  // O ritmo: barra de tinta de 2 x 12 com halo da superfície, que separa a marca do cheio sem tracejado. Um SVG
  // aninhado no x em % leva a marca centrada nele.
  if (p.ritmo !== null) {
    partes.push(
      `<svg x="${pct(Math.min(0.98, Math.max(0.02, p.ritmo)))}" overflow="visible"><rect class="mk" x="-1" y="${e(MEIO - 6)}" width="2" height="${e(12)}" rx="1"/></svg>`,
    )
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="${n(altura * escala)}" role="img" aria-label="${escapa(`medidor ${p.rotulo}`)}">${ESTILO}${partes.join('')}</svg>`
}

// A pílula do DS só mostra o estado e troca-se com /ds on|off: uma camada Client clicável por cima dela não
// carregava no app (log do host: "Client frame torn down: did not load within 10s"). Ícone, rótulo e uma luz
// de estado: ponto cheio em `pos` ligado, anel `muted` desligado, e o valor `on` em `pos` ou `off` em `muted`;
// sem medidor nem secundário, nunca encolhe.
const LUZ = 7
function pilulaDs(ligado: boolean): Pedaco {
  const valor = ligado ? 'on' : 'off'
  let cx = ESQ
  const partes = [icone(cx, LADO, ICONE.ds, PONTOS_DS)]
  cx += LADO + GAP_ICONE
  partes.push(letras(cx, 'ds', 'r'))
  cx = Math.round(cx + mono('ds') + GAP)
  partes.push(
    ligado
      ? `<circle class="lg" cx="${n(cx + LUZ / 2)}" cy="${MEIO}" r="${LUZ / 2}"/>`
      : `<circle class="dl" cx="${n(cx + LUZ / 2)}" cy="${MEIO}" r="${(LUZ - 1.5) / 2}"/>`,
  )
  cx += LUZ + 6
  partes.push(letras(cx, valor, ligado ? 'v b pos' : 'v b off'))
  cx += sans(valor, 13, 600)
  const natural = Math.ceil(cx + DIR)
  const largura = naGrade(natural)
  return { largura, svg: fundo(0, largura, 'ds') + desloca((largura - natural) / 2, partes.join('')) }
}

// Distribuição da linha: as pílulas ocupam a linha inteira, com vão fixo de 8 px entre elas; o que sobra vai para os
// medidores, em partes iguais, pelo flex do app (nada aqui sabe a largura da linha em px). `TRILHA_MIN` é o medidor
// mínimo que a conta de caber supõe; no app ele é o `minWidth` em colunas do Box do medidor (MEDIDOR_MIN_COLUNAS,
// 4 colunas dão de 31 a 34 px nas medidas de 7,7 a 8,5 px por coluna).
// `respiro` é a faixa transparente embaixo das imagens, que separa a linha do bloco de baixo (o progresso).
export const TRILHA_MIN = 32
export const MEDIDOR_MIN_COLUNAS = 4
export const VAO = 8
export const RESPIRO = 12

export type ImagemDoUso = { source: string; largura: number }
/** Uma pílula em três pedaços: a cabeça e a cauda na largura natural e, entre elas, o medidor que estica. */
export type PilulaDoUso = { key: string; alt: string; cabeca: ImagemDoUso; medidor: string; cauda: ImagemDoUso }
export type LinhaDoUso = { pilulas: PilulaDoUso[]; ds: (ImagemDoUso & { alt: string }) | null; altura: number; escala: number }

const escapa = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
const embrulha = (desenho: Pedaco, caixa: number, escala: number, alt: string, altura: number): ImagemDoUso => ({
  source: `<svg xmlns="http://www.w3.org/2000/svg" width="${n(caixa * escala)}" height="${n(altura * escala)}" viewBox="0 0 ${caixa} ${altura}" role="img" aria-label="${escapa(alt)}">${ESTILO}${desenho.svg}</svg>`,
  largura: Math.round(caixa * escala * 10) / 10,
})

/**
 * A linha de grupos, cada um em cabeça, medidor e cauda, para a faixa montar em flex. `largura` é só a estimativa
 * que decide o dado secundário: faltando espaço para os medidores mínimos, ele sai parte a parte, do último grupo para
 * o primeiro; medidor e valor ficam sempre. Mais estreito que o mínimo, cabeça e cauda encolhem juntas em vez de
 * cortar. `alts` dá o texto de cada grupo. A cauda do último grupo leva o vão até o DS quando ele vem depois.
 */
export function linhaDoUso(lista: Pilula[], largura: number, alts: string[], ds?: boolean, altDs = '', respiro = 0): LinhaDoUso {
  const dsDesenho = ds === undefined ? null : pilulaDs(ds)
  const fixo = dsDesenho?.largura ?? 0
  const quantas = lista.length + (dsDesenho ? 1 : 0)
  const vaos = VAO * Math.max(0, quantas - 1)
  const minimo = (grupos: Pilula[]) => grupos.reduce((soma, p) => soma + cabeca(p).largura + cauda(p).largura + TRILHA_MIN, 0) + fixo + vaos

  const tentativas = Array.from({ length: extras(lista) + 1 }, (_, sem) => semExtra(lista, sem))
  const grupos = tentativas.find(t => minimo(t) <= largura) ?? tentativas[tentativas.length - 1]!
  // Encolhe só quando nem o mínimo cabe; os medidores ficam no mínimo deles.
  const medidores = TRILHA_MIN * grupos.length
  const escala = Math.min(1, Math.max(0.1, (largura - medidores) / Math.max(1, minimo(grupos) - medidores)))
  const altura = ALTURA + respiro

  const pilulas = grupos.map((p, i): PilulaDoUso => {
    const alt = alts[i] ?? ''
    const fim = cauda(p)
    const vao = i < grupos.length - 1 || dsDesenho ? VAO : 0

    return {
      key: p.tom,
      alt,
      cabeca: embrulha(cabeca(p), cabeca(p).largura, escala, alt, altura),
      medidor: medidor(p, altura, escala),
      cauda: embrulha(fim, fim.largura + vao, escala, alt, altura),
    }
  })

  return {
    pilulas,
    ds: dsDesenho ? { ...embrulha(dsDesenho, dsDesenho.largura, escala, altDs, altura), alt: altDs } : null,
    altura: Math.round(altura * escala * 10) / 10,
    escala,
  }
}
