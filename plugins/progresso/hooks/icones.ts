import type { IconePendencia } from '../types'

// Ícones de linha monocromáticos no estilo Lucide: grade de 24, traço 2, pontas e cantos arredondados, na cor do
// texto do tema e sem preenchimento. Todos os robôs saem do mesmo robô base da v1 (o "bot" do Lucide: cabeça 16 × 12,
// antena, orelhas e olhos) e mudam só o que o tipo pede: boné, quepe, capacete, pincel, lupa, óculos, balão ou nós.
// A cor do nível nunca entra no ícone: fica no texto do nível e na barra.

export type Desenho =
  | 'leve'
  | 'executor'
  | 'pesado'
  | 'design'
  | 'investigador'
  | 'leitor'
  | 'robo'
  | 'teammate'
  | 'workflow'
  | 'tarefa'
  | 'terminal'
  | 'fluxo'

/** Normal; falhou troca os olhos por X; planejado desenha tracejado e apagado. */
export type Variante = 'normal' | 'falhou' | 'planejado'

type Robo = { acessorio: string; antena: boolean; olhos?: string; antenaCorpo?: string }

const CABECA = '<rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2M20 14h2"/>'
// Antena: haste reta com a bolinha na ponta, a silhueta que separa o robô genérico dos de chapéu em 16 px.
const ANTENA = '<path d="M12 8V4.5"/><circle cx="12" cy="3" r="1.5"/>'
// A antena dobrada da v1, para quem tem acessório no alto à direita (o balão do teammate).
const ANTENA_V1 = '<path d="M12 8V4H8"/>'
const OLHOS = '<path d="M9 13v2M15 13v2"/>'
const OLHOS_X = '<path d="m8 12.5 2 2M10 12.5l-2 2M14 12.5l2 2M16 12.5l-2 2"/>'

const ROBOS: Record<Exclude<Desenho, 'tarefa' | 'terminal' | 'fluxo'>, Robo> = {
  // Os demais tipos (general-purpose, Explore, Plan, fork): o robô da v1, com a antena.
  robo: { acessorio: '', antena: true },
  // Boné: copa redonda puxada para a esquerda e a aba longa saindo reta para a direita, além da cabeça.
  leve: { acessorio: '<path d="M4.5 8V7.5a5 4.5 0 0 1 10 0V8"/><path d="M13.5 6.5H23"/>', antena: false },
  // Quepe: topo largo e achatado, mais largo que a cabeça, e a pala curta na frente.
  executor: { acessorio: '<path d="M1.5 2h21l-4 4.5h-13z"/><path d="M9.5 10q2.5 1.5 5 0"/>', antena: false },
  // Capacete de obra: cúpula alta, aba em volta mais larga que a cabeça e a faixa no meio da cúpula.
  pesado: { acessorio: '<path d="M6 5.5a6 4.5 0 0 1 12 0"/><path d="M1.5 5.5h21"/><path d="M12 1v4.5"/>', antena: false },
  // Pincel: o cabo inclinado saindo da cabeça e as cerdas na ponta.
  design: { acessorio: '<path d="M11 8l5-5"/><path d="M16 3c.8-.8 2.6-1 3.3-.3.7.7.5 2.5-.3 3.3-.6.6-1.6.7-2.3.4"/>', antena: false },
  // Lupa ao lado da antena.
  investigador: { acessorio: '<circle cx="18" cy="4" r="2.5"/><path d="m16.2 5.8-1.7 1.7"/>', antena: true },
  // Óculos redondos no lugar dos olhos, com a ponte.
  leitor: { acessorio: '', antena: true, olhos: '<circle cx="9" cy="14" r="2"/><circle cx="15" cy="14" r="2"/><path d="M11 14h2"/>' },
  // Balão de fala no alto, à direita da antena.
  teammate: { acessorio: '<path d="M15 1.5h5.5a1.5 1.5 0 0 1 1.5 1.5v2a1.5 1.5 0 0 1-1.5 1.5H18l-2 1.5V6.5h-1a1.5 1.5 0 0 1-1.5-1.5V3A1.5 1.5 0 0 1 15 1.5z"/>', antena: true, antenaCorpo: ANTENA_V1 },
  // Nós: dois nós ligados ao topo da cabeça por uma forquilha.
  workflow: { acessorio: '<path d="M12 8V6M12 6 7.5 4.5M12 6l4.5-1.5"/><circle cx="6" cy="4" r="1.5"/><circle cx="18" cy="4" r="1.5"/>', antena: false },
}

// Lucide "terminal" (o da v1) com o cursor separado para piscar, "clipboard-check" e "workflow".
const PROMPT = '<path d="m4 17 6-6-6-6"/>'
const CURSOR = '<path d="M12 19h8"/>'
const PRANCHETA = '<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>'
const FLUXO = '<rect width="8" height="8" x="3" y="3" rx="2"/><path d="M7 11v4a2 2 0 0 0 2 2h4"/><rect width="8" height="8" x="13" y="13" rx="2"/>'

/** O desenho de um subagente pelo tipo; tipo vazio (comando) não chega aqui. */
export function desenhoDoTipo(tipo: string): Desenho {
  const nome = tipo.replace(/^.*:/, '')
  const PORTIPO: Record<string, Desenho> = {
    'executor-leve': 'leve',
    executor: 'executor',
    'executor-pesado': 'pesado',
    'executor-design': 'design',
    investigador: 'investigador',
    leitor: 'leitor',
    teammate: 'teammate',
  }
  if (PORTIPO[nome]) return PORTIPO[nome]
  if (/workflow/i.test(nome)) return 'workflow'
  if (/teammate/i.test(nome)) return 'teammate'

  return 'robo'
}

// A antena (ou, sem ela, os olhos) pisca de leve no robô rodando; no terminal, o cursor. Na banda (imagem) vai por
// CSS, o mecanismo que já anima o relógio; no painel (Svg isInteractive) por SMIL, o que o doc dele promete.
export const ICONE_CSS = `.ib{animation:ib 2.4s steps(1,end) infinite}@keyframes ib{0%{opacity:1}70%{opacity:.25}85%{opacity:1}}
.cb{animation:cb 1.2s steps(1,end) infinite}@keyframes cb{0%{opacity:1}50%{opacity:0}}@media (prefers-reduced-motion:reduce){.ib,.cb{animation:none}}`
const SMIL_PISCA = '<animate attributeName="opacity" values="1;.25;1" keyTimes="0;.7;.85" dur="2.4s" calcMode="discrete" begin="0s" repeatCount="indefinite"/>'
const SMIL_CURSOR = '<animate attributeName="opacity" values="1;0" keyTimes="0;.5" dur="1.2s" calcMode="discrete" begin="0s" repeatCount="indefinite"/>'

export type Anima = 'css' | 'smil' | false

const pisca = (corpo: string, anima: Anima, cursor = false) =>
  anima === 'css' ? `<g class="${cursor ? 'cb' : 'ib'}">${corpo}</g>` : anima === 'smil' ? `<g>${cursor ? SMIL_CURSOR : SMIL_PISCA}${corpo}</g>` : corpo

/** O traçado do ícone na grade de 24, sem estilo: quem o põe num Svg dá o traço pela classe. */
export function corpoDoIcone(desenho: Desenho, opcoes: { variante?: Variante; anima?: Anima } = {}) {
  const variante = opcoes.variante ?? 'normal'
  const anima = variante === 'normal' ? (opcoes.anima ?? false) : false
  if (desenho === 'terminal') return PROMPT + pisca(CURSOR, anima, true)
  if (desenho === 'tarefa') return PRANCHETA
  if (desenho === 'fluxo') return FLUXO
  const robo = ROBOS[desenho]
  const olhos = variante === 'falhou' ? OLHOS_X : (robo.olhos ?? OLHOS)

  return CABECA + robo.acessorio + (robo.antena ? pisca(robo.antenaCorpo ?? ANTENA, anima) : '') + (robo.antena ? olhos : pisca(olhos, anima))
}

// Escuro por padrão e claro pela media query, como os tokens da banda.
const TINTA = `svg{--ic:#F1EDE4;--ic-apagado:#8A857B;--casa:#363532}@media (prefers-color-scheme:light){svg{--ic:#1D1D1B;--ic-apagado:#807B70;--casa:#ECE8DF}}`
export const ESTILO_ICONE = `.ic{fill:none;stroke:var(--ic);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}.ic.pl{stroke:var(--ic-apagado);stroke-dasharray:2.5 2.5}`

/** O ícone num ponto de um Svg maior, de lado `lado` px; a classe de traço vem do chamador (ESTILO_ICONE ou outra). */
export function iconeEm(desenho: Desenho, x: number, y: number, lado: number, opcoes: { variante?: Variante; anima?: Anima; classe?: string } = {}) {
  const classe = opcoes.classe ?? `ic${opcoes.variante === 'planejado' ? ' pl' : ''}`

  return `<g class="${classe}" transform="translate(${x} ${y}) scale(${(lado / 24).toFixed(4)})">${corpoDoIcone(desenho, opcoes)}</g>`
}

/**
 * O ícone do painel: uma casa de `casa` px arredondada, num tom um pouco mais claro que o fundo, com o ícone de
 * `lado` px no centro. `largura` maior que a casa deixa o resto transparente à direita: é o vão até o texto.
 */
export function svgDoIcone(
  desenho: Desenho,
  opcoes: { variante?: Variante; animado?: boolean; casa?: number; lado?: number; largura?: number } = {},
) {
  const casa = opcoes.casa ?? 40
  const lado = opcoes.lado ?? 22
  const largura = Math.max(casa, opcoes.largura ?? casa)
  const d = (casa - lado) / 2

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${largura}" height="${casa}" viewBox="0 0 ${largura} ${casa}"><style>${TINTA}${ESTILO_ICONE}</style>` +
    `<rect width="${casa}" height="${casa}" rx="10" fill="var(--casa)"/>` +
    iconeEm(desenho, d, d, lado, { variante: opcoes.variante, anima: opcoes.animado ? 'smil' : false }) +
    '</svg>'
  )
}

/** Um Svg só com o ícone, de lado `lado`, sem casa: para a prévia e para quem precisar dele solto. */
export const svgDoIconeSolto = (desenho: Desenho, lado: number, variante: Variante = 'normal') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${lado}" height="${lado}" viewBox="0 0 ${lado} ${lado}"><style>${TINTA}${ESTILO_ICONE}</style>${iconeEm(desenho, 0, 0, lado, { variante })}</svg>`

/** O glifo de uma célula do terminal, um por tipo, na mesma ideia do ícone (sem cor de nível). */
export function glifoDe(desenho: Desenho) {
  const GLIFO: Record<Desenho, string> = {
    robo: '⊡',
    leve: '◠',
    executor: '⊓',
    pesado: '⌓',
    design: '✎',
    investigador: '⌕',
    leitor: '⊙',
    teammate: '❞',
    workflow: '⋔',
    tarefa: '▤',
    terminal: '>_',
    fluxo: '⋔',
  }

  return GLIFO[desenho]
}

export const DESENHOS: Desenho[] = ['robo', 'leve', 'executor', 'pesado', 'design', 'investigador', 'leitor', 'teammate', 'workflow', 'tarefa', 'terminal', 'fluxo']

// Pendências: um nome de um conjunto fixo, desenhado na mesma família (Lucide, grade de 24, traço 2, pontas redondas).
export type { IconePendencia }

// Lucide: clock, video, plug, rocket, key-round, credit-card, image, mail, bug, chart-column, eye, file-text, circle-check.
const DESENHO_DA_PENDENCIA: Record<IconePendencia, string> = {
  espera: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  video: '<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
  automacao: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
  publicar:
    '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
  acesso:
    '<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5"/>',
  pagamento: '<rect width="20" height="14" x="2" y="5" rx="2"/><path d="M2 10h20"/>',
  imagem: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  email: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  bug:
    '<path d="m8 2 1.88 1.88M14.12 3.88 16 2M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6M12 20v-9M6.53 9C4.6 8.8 3 7.1 3 5M6 13H2M3 21c0-2.1 1.7-3.9 3.8-4M20.97 5c0 2.1-1.6 3.8-3.5 4M22 13h-4M17.2 17c2.1.1 3.8 1.9 3.8 4"/>',
  dados: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9M13 17V5M8 17v-3"/>',
  revisar: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  documento: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4M10 9H8M16 13H8M16 17H8"/>',
  aprovacao: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
}

export const ICONES_PENDENCIA = Object.keys(DESENHO_DA_PENDENCIA) as IconePendencia[]

// A faixa: o pino (Lucide "pin") no rótulo e a seta (chevron-down / chevron-up) no fim da linha.
const PINO =
  '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>'
// O caderno (Lucide "notebook-text") das anotações, no botão do barra-uso e no painel.
const NOTA = '<path d="M2 6h4M2 10h4M2 14h4M2 18h4"/><rect width="16" height="20" x="4" y="2" rx="2"/><path d="M9.5 8h5M9.5 12H16M9.5 16H14"/>'
const SETA_ABAIXO = '<path d="m6 9 6 6 6-6"/>'
const SETA_ACIMA = '<path d="m18 15-6-6-6 6"/>'

/** O traçado na grade de 24 de um ícone de pendência, do pino ou da seta. */
export const corpoDaPendencia = (nome: IconePendencia | 'pino' | 'abrir' | 'fechar' | 'nota') =>
  nome === 'nota' ? NOTA : nome === 'pino' ? PINO : nome === 'abrir' ? SETA_ABAIXO : nome === 'fechar' ? SETA_ACIMA : DESENHO_DA_PENDENCIA[nome]

/** O ícone de pendência num ponto de um Svg maior, de lado `lado`, com a classe de traço do chamador. */
export const iconeDaPendenciaEm = (nome: IconePendencia | 'pino' | 'abrir' | 'fechar' | 'nota', x: number, y: number, lado: number, classe: string) =>
  `<g class="${classe}" transform="translate(${x} ${y}) scale(${(lado / 24).toFixed(4)})">${corpoDaPendencia(nome)}</g>`
