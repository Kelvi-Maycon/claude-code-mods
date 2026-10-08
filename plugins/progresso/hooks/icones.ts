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
  // Os demais tipos (general-purpose, Plan, claude, fork e qualquer nome sem desenho próprio): o robô da v1, com a antena.
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
    // Tipo padrão do Claude Code que só lê e busca: a mesma lupa do investigador.
    Explore: 'investigador',
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
