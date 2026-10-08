import { extras, semExtra } from './modelo'
import type { Pilula, Tom } from './modelo'

// Desenho com uma paleta própria de cores, tipografia e medidas, na mesma
// pele da barra de progresso logo abaixo: cada grupo é uma superfície `soft` de 24 px, raio pill e sem contorno,
// a mesma da trilha do progresso. Dentro, ícone `muted`, rótulo mono em caixa alta `ink`, medidor de 6 px
// (`line` com o cheio em `orange` ou na cor de estado), valor em sans 13 px 600 e o secundário em `muted`.
export const ALTURA = 28
const ALT_PILULA = 24
const TOPO = (ALTURA - ALT_PILULA) / 2
const MEIO = ALTURA / 2
// As pilhas da barra de progresso: o desenho é uma imagem isolada e, sem essas fontes instaladas, cai na
// fonte do app e na do sistema, sem buscar nada em rede.
const SANS = "'Instrument Sans','Anthropic Sans',system-ui,sans-serif"
const MONO = "'JetBrains Mono',ui-monospace,'SF Mono',Menlo,monospace"

/** A paleta nos dois temas. `ink` e `muted` sobre `soft` passam de 4,5:1. */
export const PALETA = {
  claro: {
    soft: '#E8E4DB',
    // Trilha do medidor e fio: `line` aparece sobre `soft` nos dois temas.
    line: '#CBC6BB',
    ink: '#1D1D1B',
    muted: '#5A5952',
    orange: '#F05A37',
    pos: '#2F7A36',
    warn: '#946200',
    neg: '#C42B3E',
    // Preenchimento não é texto: o degradê do cache e o ctx em alerta usam os tons vivos do DS.
    g0: '#FF7A6B',
    g1: '#F2B53A',
    g2: '#2F7A36',
  },
  escuro: {
    soft: '#2D2C29',
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
  // Paleta: a mesma do desenho.
  ds: '<path d="M7 1.75a5.25 5.25 0 0 0 0 10.5c.85 0 1.3-.65 1.05-1.4-.3-.85.3-1.6 1.2-1.6h1.2a1.8 1.8 0 0 0 1.8-1.8c0-3.1-2.35-5.7-5.25-5.7Z"/>',
}
// Os pontos da paleta vão cheios: traço de 1,5 em raio de meio pixel some a 1x.
const PONTOS_DS = '<circle cx="4.4" cy="6.9" r=".95"/><circle cx="5.6" cy="4.2" r=".95"/><circle cx="8.6" cy="4" r=".95"/>'
// Relógio do tempo até zerar, menor que os ícones das pílulas (12 px), no mesmo traço.
const RELOGIO = '<circle cx="6" cy="6" r="4.75"/><path d="M6 3.6V6l1.6 1.1"/>'
const LADO_RELOGIO = 12

// Largura estimada do texto, porque o SVG não mede: avanço por letra, em em, da fonte do sistema a 12 px e
// peso 500 (a que a imagem usa sem as fontes do DS), na mesma tabela da barra de progresso; o 600 é 2,3% mais
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
// linha (a pílula DS encolhia pela metade). Toda pílula fecha num múltiplo de 8, com a sobra dividida dos dois
// lados dentro dela, e a linha soma exatamente o que foi calculado.
const CELULA = 8
function naGrade(natural: number, tom: string, conteudo: string) {
  const largura = Math.ceil(natural / CELULA) * CELULA
  const sobra = (largura - natural) / 2

  return { largura, svg: fundo(largura, tom) + (sobra > 0 ? `<g transform="translate(${n(sobra)} 0)">${conteudo}</g>` : conteudo) }
}
const icone = (x: number, lado: number, desenho: string, cheios = '') =>
  `<g transform="translate(${n(x)} ${n(MEIO - lado / 2)})"><g class="i">${desenho}</g>${cheios ? `<g class="ip">${cheios}</g>` : ''}</g>`
const letras = (x: number, s: string, classe: string) => `<text x="${n(x)}" y="${MEIO}" class="${classe}">${s}</text>`
const fundo = (largura: number, tom: string) =>
  `<rect class="p" data-tom="${tom}" x="0" y="${TOPO}" width="${largura}" height="${ALT_PILULA}" rx="${ALT_PILULA / 2}"/>`

// Ritmo horizontal de toda pílula, com o `gap-inline` (6) do DS: 8 de respiro à esquerda, ícone de 14, 6 até
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

/** Desenha a pílula com o medidor de `trilha` px e diz quanto ela ocupa: a mesma conta mede e desenha. */
function pilula(p: Pilula, trilha: number): { largura: number; svg: string } {
  const partes: string[] = []
  let cx = ESQ
  partes.push(icone(cx, LADO, ICONE[p.tom]))
  cx += LADO + GAP_ICONE
  partes.push(letras(cx, p.rotulo, 'r'))
  // O medidor começa num pixel inteiro, para as pontas redondas não borrarem a 1x.
  cx = Math.round(cx + mono(p.rotulo) + GAP)

  const yb = MEIO - ALT_BARRA / 2
  partes.push(`<rect class="tr" x="${n(cx)}" y="${yb}" width="${trilha}" height="${ALT_BARRA}" rx="${ALT_BARRA / 2}"/>`)

  // O cache leva o degradê `neg` → `warn` → `pos` na largura da trilha: o cheio mostra até onde resta.
  if (p.tom === 'cache') {
    partes.push(
      `<linearGradient id="dg" gradientUnits="userSpaceOnUse" x1="${n(cx)}" x2="${n(cx + trilha)}" y1="0" y2="0"><stop offset="0" class="g0"/><stop offset=".5" class="g1"/><stop offset="1" class="g2"/></linearGradient>`,
    )
  }

  const cheio = trilha * (p.cheio ?? 0)

  if (cheio > 0) {
    const cor = p.tom === 'cache' ? 'tf" style="fill:url(#dg)' : p.cor === 'orange' ? 'tf' : `tf ${p.cor}`
    // Nunca menor que a própria altura: o cheio mínimo é um ponto redondo, não uma lasca.
    partes.push(`<rect class="${cor}" x="${n(cx)}" y="${yb}" width="${n(Math.max(ALT_BARRA, cheio))}" height="${ALT_BARRA}" rx="${ALT_BARRA / 2}"/>`)
  }

  // O ritmo: barra de tinta de 2 x 12 com halo da superfície, que separa a marca do cheio sem tracejado.
  if (p.ritmo !== null) {
    const mx = cx + Math.min(trilha - 1, Math.max(1, trilha * p.ritmo))
    partes.push(`<rect class="mk" x="${n(mx - 1)}" y="${MEIO - 6}" width="2" height="12" rx="1"/>`)
  }

  cx += trilha + GAP
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

  return naGrade(Math.ceil(cx + DIR), p.tom, partes.join(''))
}

// A pílula do DS só mostra o estado e troca-se com /ds on|off: uma camada Client clicável por cima dela não
// carregava no app (log do host: "Client frame torn down: did not load within 10s"). Ícone, rótulo e uma luz
// de estado: ponto cheio em `pos` ligado, anel `muted` desligado, e o valor `on` em `pos` ou `off` em `muted`;
// sem medidor nem secundário, nunca encolhe.
const LUZ = 7
function pilulaDs(ligado: boolean): { largura: number; svg: string } {
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
  return naGrade(Math.ceil(cx + DIR), 'ds', partes.join(''))
}

// Distribuição da linha: as pílulas ficam à esquerda com vão fixo de 8 px entre elas; o medidor cresce de 28 até
// 96 px para aproveitar a largura e o que sobra vai para a direita, depois da última pílula.
// `respiro` é a faixa transparente embaixo da imagem, que separa a linha do bloco de baixo (o progresso).
export const TRILHA_MIN = 28
export const TRILHA_MAX = 96
export const VAO = 8
export const RESPIRO = 12

export type PilulaSvg = { key: string; source: string; alt: string; largura: number }
export type LinhaDoUso = { itens: PilulaSvg[]; vao: number; trilha: number; altura: number }

const escapa = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
const embrulha = (desenho: { largura: number; svg: string }, caixa: number, escala: number, alt: string, altura: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${n(caixa * escala)}" height="${n(altura * escala)}" viewBox="0 0 ${caixa} ${altura}" role="img" aria-label="${escapa(alt)}">${ESTILO}${desenho.svg}</svg>`

/**
 * A linha de grupos, uma imagem por pílula, para a faixa distribuir na largura real dela (o app não diz a
 * largura em px; `largura` é a estimativa). Faltando espaço o medidor encurta até 32 px e depois sai o dado
 * secundário, parte a parte, do último grupo para o primeiro; medidor e valor ficam sempre. Mais estreito
 * que o mínimo, as pílulas encolhem juntas em vez de cortar. `alts` dá o texto de cada grupo.
 */
export function linhaDoUso(lista: Pilula[], largura: number, alts: string[], ds?: boolean, altDs = '', respiro = 0): LinhaDoUso {
  const dsDesenho = ds === undefined ? null : pilulaDs(ds)
  const fixo = dsDesenho?.largura ?? 0
  const quantas = lista.length + (dsDesenho ? 1 : 0)
  const vaos = VAO * Math.max(0, quantas - 1)
  const base = (grupos: Pilula[]) => grupos.reduce((soma, p) => soma + pilula(p, 0).largura, 0)

  let grupos = semExtra(lista, extras(lista))
  let trilha = TRILHA_MIN
  for (let sem = 0; sem <= extras(lista); sem++) {
    const tentativa = semExtra(lista, sem)
    const sobra = largura - base(tentativa) - fixo - vaos
    let cabe = tentativa.length === 0 ? TRILHA_MAX : Math.min(TRILHA_MAX, Math.floor(sobra / tentativa.length))
    // A grade de 8 arredonda cada pílula para cima: encurta o medidor até a soma caber de verdade.
    const soma = (t: number) => tentativa.reduce((total, p) => total + pilula(p, t).largura, 0) + fixo + vaos
    while (cabe >= TRILHA_MIN && soma(cabe) > largura) cabe -= 1
    if (cabe >= TRILHA_MIN) {
      grupos = tentativa
      trilha = cabe
      break
    }
  }

  const desenhos = grupos.map(p => pilula(p, trilha))
  if (dsDesenho) desenhos.push(dsDesenho)
  const ocupado = desenhos.reduce((soma, d) => soma + d.largura, 0)
  // Encolhe só quando nem o mínimo cabe.
  const escala = Math.min(1, largura / (ocupado + vaos))
  const altura = ALTURA + respiro
  const chaves = [...grupos.map(p => p.tom), ...(dsDesenho ? ['ds'] : [])]
  const textos = [...grupos.map((_, i) => alts[i] ?? ''), ...(dsDesenho ? [altDs] : [])]

  const itens = desenhos.map((desenho, i) => {
    // Cada imagem leva o vão de 8 à direita, menos a última.
    const caixa = i < desenhos.length - 1 ? desenho.largura + VAO : desenho.largura

    return { key: chaves[i]!, source: embrulha(desenho, caixa, escala, textos[i]!, altura), alt: textos[i]!, largura: Math.round(caixa * escala * 10) / 10 }
  })

  return { itens, vao: VAO, trilha, altura: Math.round(altura * escala * 10) / 10 }
}
