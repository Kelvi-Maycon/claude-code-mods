// Estrutura portada de plan-progress (zycck/claude-mods, commit 549ecee6d9), MIT, Kirill Serditov.
// Licença em ../licenses/plan-progress-LICENSE. Trilha, pílula, marcas, faixas e relógio de rolos vêm de lá;
// a pílula leva também o título da barra, que na origem fica numa coluna à esquerda da trilha.
// A pele usa uma paleta própria:
// trilha e faixas são superfícies `soft` sem contorno, a pílula é um `card` com fio `line` por cima da trilha,
// o preenchido é a textura de pixels que cintila na cor do estado (a da origem), laranja só no que está ativo e cor
// de estado na marca, na palavra e no fundo tingido de cada faixa.
import type { Estado } from '../types'
import { ICONE_CSS, desenhoDoTipo, iconeEm } from './icones'
import type { Desenho } from './icones'
import { decorrido, relogio as relogioTexto } from './modelo'
import type { LinhaVista, Tom, Vista } from './modelo'

// Trilha de 24 px, a altura das pílulas do uso; a faixa tem 20 com 4 de vão, na grade de 4 px.
export const ALT_TRILHA = 24
const ALT_FAIXA = 20
const VAO_FAIXA = 4
const ESTREITA = 360
const CALHA_PX = 36 // ícone de linha (16 px) e número, à esquerda da faixa, como na v1
const RELOGIO_W = 48 // "59m 59s"
const LINHA = 16
const RAMPA = 240 // rampa mínima do preenchido: trilha curta já começa forte
const HORA = 3_600_000
/** Duração do deslize da cabeça (dur-enter); passado esse tempo a trilha fica sem animação na fonte. */
export const DESLIZE_MS = 480
// Pilhas do sistema. O desenho é uma imagem isolada: usa a Instrument Sans e a JetBrains Mono quando o macOS
// as tem instaladas e, sem elas, cai na fonte do app e na do sistema, sem buscar nada em rede.
const SANS = "'Instrument Sans','Anthropic Sans',system-ui,sans-serif"
const MONO = "'JetBrains Mono',ui-monospace,'SF Mono',Menlo,monospace"
const LARANJA = '#F05A37'
/** Terracota do símbolo do Claude: a cor da estrela, sinal de vida de tudo que o Claude está rodando. */
export const TERRACOTA = '#D97757'

/**
 * A faísca de 8 pontas do Claude, centrada em 0,0 e de raio r: pontas alternando longa (eixos) e curta (diagonais) e
 * vales finos, com o traço da mesma cor arredondando as pontas.
 */
export function caminhoDaEstrela(r: number) {
  const pontos: string[] = []
  for (let k = 0; k < 16; k++) {
    const angulo = (k * Math.PI) / 8 - Math.PI / 2
    const raio = k % 2 === 1 ? r * 0.26 : k % 4 === 0 ? r : r * 0.74
    pontos.push(`${(Math.cos(angulo) * raio).toFixed(2)} ${(Math.sin(angulo) * raio).toFixed(2)}`)
  }

  return `M${pontos.join('L')}Z`
}
const corpoDaEstrela = (r: number) =>
  `<path d="${caminhoDaEstrela(r)}" fill="${TERRACOTA}" stroke="${TERRACOTA}" stroke-width="${(r * 0.16).toFixed(2)}" stroke-linejoin="round"/>`
// Gira um quarto de volta (a simetria da faísca) em 3,2 s e respira em escala (0,9 a 1,1) no mesmo ciclo: uma volta inteira leva
// 12,8 s, devagar o bastante para não puxar o olho.
const ESTRELA_CSS = `.eg{transform-box:fill-box;transform-origin:50% 50%;animation:eg 3.2s linear infinite}.ep{transform-box:fill-box;transform-origin:50% 50%;animation:ep 3.2s ease-in-out infinite}
@keyframes eg{to{transform:rotate(90deg)}}@keyframes ep{25%{transform:scale(1.1)}75%{transform:scale(.9)}}@media (prefers-reduced-motion:reduce){.eg,.ep{animation:none}}`

/**
 * A estrela em (cx, cy). `css` anima pelo CSS (a banda, desenhada como imagem, o mesmo mecanismo do relógio);
 * `smil` anima por SMIL (o Svg isInteractive do painel, o que o doc dele promete rodar); `parada` não anima.
 */
export function estrela(cx: number, cy: number, r: number, modo: 'css' | 'smil' | 'parada') {
  const corpo = corpoDaEstrela(r)
  const em = `transform="translate(${cx.toFixed(1)} ${cy.toFixed(1)})"`
  if (modo === 'parada') return `<g ${em}>${corpo}</g>`
  if (modo === 'css') return `<g ${em}><g class="eg"><g class="ep">${corpo}</g></g></g>`

  return (
    `<g ${em}><g><animateTransform attributeName="transform" type="rotate" from="0" to="90" dur="3.2s" begin="0s" repeatCount="indefinite"/>` +
    `<g><animateTransform attributeName="transform" type="scale" values="1;1.1;.9;1" keyTimes="0;.25;.75;1" calcMode="spline" keySplines=".45 0 .55 1;.45 0 .55 1;.45 0 .55 1" dur="3.2s" begin="0s" repeatCount="indefinite"/>${corpo}</g></g></g>`
  )
}

// O escuro é o padrão e o claro entra pela media query. --f-* é o fundo tingido de cada faixa pelo estado, opaco e
// forte o bastante para se destacar da área (1,38 a 1,5:1 no claro, 1,28 a 1,58:1 no escuro, contra #FAF9F5 e
// #262624) com `muted` em AA por cima (4,45 a 5,66:1). --espera e --erro são a palavra da faixa: no claro o warn e o
// neg sobre o próprio fundo ficam abaixo de AA e a palavra vai em tinta; o ponto segue na cor do estado.
// --cor pinta o preenchido e o ponto; --marca, o ícone da pílula sobre o `card`.
const TOKENS = `svg{--ink:#F1EDE4;--card:#1E1D1B;--soft:#2D2C29;--line:#4E4B46;--ctl:#8A857B;--muted:#B8B3A8;--pos:#D8F35A;--warn:#F2B53A;--neg:#FF7A6B;--espera:#F2B53A;--erro:#FF7A6B;--f-andamento:#5C2F22;--f-esperando:#54431A;--f-erro:#5A282C;--f-concluido:#3B4619}
@media (prefers-color-scheme:light){svg{--ink:#1D1D1B;--card:#FFFDFA;--soft:#E8E4DB;--line:#CBC6BB;--ctl:#807B70;--muted:#5A5952;--pos:#2F7A36;--warn:#946200;--neg:#C42B3E;--espera:#1D1D1B;--erro:#1D1D1B;--f-andamento:#F8C7B6;--f-esperando:#F1D38A;--f-erro:#F4C1C7;--f-concluido:#C3DC9E}}
.andamento{--cor:${LARANJA};--marca:${LARANJA}}.esperando{--cor:var(--warn);--marca:var(--warn)}.erro{--cor:var(--neg);--marca:var(--neg)}
.concluido{--cor:var(--pos);--marca:var(--pos)}.parada{--cor:var(--ctl);--marca:var(--ctl)}.neutro{--cor:var(--ctl)}`
const CINTILA = `.t0,.t1,.t2,.t3{animation:tw 2.2s ease-in-out infinite}.t1{animation-duration:2.8s;animation-delay:-.7s}.t2{animation-duration:1.9s;animation-delay:-1.3s}.t3{animation-duration:3.3s;animation-delay:-.4s}
@keyframes tw{0%,100%{opacity:1}50%{opacity:.45}}.sd{animation:sp 1.1s ease-in-out infinite}@keyframes sp{50%{opacity:.3}}`

// Marca do estado na pílula, em caixa de 24 px: "alert" do sistema na espera; "x" e "check" do Lucide, a fonte
// externa que o sistema admite para o ícone que o conjunto dele não tem. Em andamento a marca é um ponto.
const MARCA: Partial<Record<Estado, string>> = {
  esperando: 'M12 4 2 20h20zM12 10.5v4M12 17.5h.01',
  erro: 'M18 6 6 18M6 6l12 12',
  concluido: 'M20 6 9 17l-5-5',
  parada: 'M7 7h10v10H7z',
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
const hash = (a: number, b: number, k: number) => {
  const x = Math.sin(a * 127.1 + b * 311.7 + k * 74.7) * 43758.5453
  return x - Math.floor(x)
}
// Avanço de cada letra em em, medido na fonte do sistema a 12 px e peso 500 (a que o quadro isolado usa de fato);
// o peso 400 é 2,3% mais estreito e o 600, 2,3% mais largo. Letra fora da tabela conta 0,6; ideograma, 1.
const AVANCOS: [number, string][] = [
  [0.26, 'ijí'],
  [0.276, ' Il|Í'],
  [0.315, "!',./:;\\·"],
  [0.379, 'f'],
  [0.396, '()[]rt{}'],
  [0.483, '*-1`'],
  [0.521, '"?s'],
  [0.562, 'JL_ackvxyzáâãçà'],
  [0.597, '27EFehnouéóúêôõÉÊ–'],
  [0.641, '#$+0345689<=>PST^bdgpq~'],
  [0.683, 'ABKRVXYZÁÂÃÀ'],
  [0.726, '&CDÇ'],
  [0.763, 'GHNOQUÓÚÔÕ'],
  [0.799, 'w'],
  [0.854, '…'],
  [0.887, 'Mm—'],
  [0.921, '@'],
  [0.962, '%'],
  [0.981, 'W'],
]
const AVANCO = new Map(AVANCOS.flatMap(([em, letras]) => [...letras].map(letra => [letra, em] as const)))
export const larguraTexto = (s: string, px: number, peso: 400 | 500 | 600 = 500) =>
  [...s].reduce((w, ch) => w + (AVANCO.get(ch) ?? (/[\u3000-\u9fff]/.test(ch) ? 1 : 0.6)), 0) * px * (1 + (peso - 500) / 4350)
// Rótulo mono de 10,5 px em caixa alta, o mesmo do uso: 0,6 em de avanço mais 0,08 em de espaçamento.
const larguraMono = (s: string) => s.length * 7.14

// Os pontos de 2 px de uma mesma classe entram num path só: um nó no lugar de milhares.
function ponto(pontos: Map<string, string>, classe: string, x: number, y: number) {
  pontos.set(classe, `${pontos.get(classe) ?? ''}M${x} ${y}h2v2h-2z`)
}

// Um mapa por desenho guarda o que já foi mostrado; passou de 200 entradas, recomeça.
function guardar<T>(mapa: Map<string, T>, chave: string, valor: T) {
  if (mapa.size > 200) mapa.clear()
  mapa.set(chave, valor)
}

// O relógio conta sozinho dentro do SVG, sem redesenho por segundo (redesenhar recarrega o quadro e tudo pisca):
// cada dígito é um rolo atrás de uma janela de uma linha, movido por animação CSS cujo atraso negativo é o tempo
// já corrido. {{T:inicio}} vira esses segundos só quando o desenho da faixa muda de verdade (fonteViva).
const RELOGIO_CSS = `.ckt{font-variant-numeric:tabular-nums}
.rs1{animation:r10 10s steps(10) var(--d) infinite}.rs10{animation:r6 60s steps(6) var(--d) infinite}
.rm1{animation:r10 600s steps(10) var(--d) infinite}.rm10{animation:r10 6000s steps(10) var(--d) infinite}.rmm{animation:hm 60s steps(1,end) var(--d) both}
@keyframes r10{to{transform:translateY(-${LINHA * 10}px)}}@keyframes r6{to{transform:translateY(-${LINHA * 6}px)}}@keyframes hm{from{opacity:0}to{opacity:1}}`

function relogioVivo(x: number, topo: number, inicio: number, classeTexto: string) {
  const base = topo + 12
  const rolo = (cx: number, figuras: string[], classeRolo: string) =>
    `<g class="${classeRolo}"><text class="${classeTexto} ckt" text-anchor="middle">${figuras
      .map((f, i) => `<tspan x="${cx.toFixed(1)}" y="${base + i * LINHA}">${f}</tspan>`)
      .join('')}</text></g>`
  const digitos = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']
  const id = `ck${inicio}x${Math.round(x)}y${Math.round(topo)}`

  return (
    `<style>.${id}{--d:-{{T:${inicio}}}s}</style><g class="${id}"><clipPath id="${id}"><rect x="${(x - 2).toFixed(1)}" y="${topo}" width="${RELOGIO_W + 4}" height="${LINHA}"/></clipPath>` +
    `<g clip-path="url(#${id})"><g class="rmm">${rolo(x + 3.5, ['', ...digitos.slice(1)], 'rm10')}${rolo(x + 10.5, digitos, 'rm1')}` +
    `<text x="${(x + 14).toFixed(1)}" y="${base}" class="${classeTexto}">m</text></g>` +
    `${rolo(x + 31, digitos.slice(0, 6), 'rs10')}${rolo(x + 38, digitos, 'rs1')}<text x="${(x + 41.5).toFixed(1)}" y="${base}" class="${classeTexto}">s</text></g></g>`
  )
}

// O quadro de uma faixa recarrega quando o markup muda; se só o instante do desenho mudou, fica a fonte já
// mostrada e o relógio segue correndo.
const fontes = new Map<string, { modelo: string; source: string }>()
function fonteViva(id: string, modelo: string, agora: number) {
  const ultima = fontes.get(id)
  if (ultima?.modelo === modelo) return ultima.source
  const source = modelo.replace(/\{\{T:(\d+)\}\}/g, (_, t: string) => Math.max(0, (agora - Number(t)) / 1000).toFixed(1))
  guardar(fontes, id, { modelo, source })

  return source
}

// Onde a cabeça de cada barra parou, em fração da trilha e com o total de passos de então, para o deslize sair de lá.
// Em fração, mudar a largura (painel docado, janela) não desliza; total que cresce (agente novo, plano maior) pula sem
// deslize, para a pílula não andar para trás à vista.
const cabecas = new Map<string, { fracao: number; total: number }>()
// O deslize fica na fonte só enquanto toca: recarregar depois uma fonte que ainda o descreve faria a pílula
// voltar à posição antiga e avançar de novo a cada redesenho.
const trilhas = new Map<string, { chave: string; em: number; viva: string; parada: string }>()

const ESTILO_TRILHA = `<style>${TOKENS}
.tr{fill:var(--soft)}.ch{fill:url(#lav)}.lv{stop-color:var(--cor)}
.p0,.p1,.p2,.p3,.p4{fill:var(--cor)}.p0{fill-opacity:.3}.p1{fill-opacity:.46}.p2{fill-opacity:.64}.p3{fill-opacity:.82}.p4{fill-opacity:1}
.ma{fill:var(--ctl)}.mp{fill:var(--ink);stroke:var(--soft);stroke-width:1.5;paint-order:stroke}
.pl{fill:var(--card);stroke:var(--line)}.mk{fill:var(--marca)}.mi{fill:none;stroke:var(--marca);stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}
.kt{font:600 12px ${SANS};fill:var(--ink);font-variant-numeric:tabular-nums}.kc{font-weight:400;fill:var(--muted)}
.ks{font:500 12px ${SANS};fill:var(--muted)}.esperando .ks{fill:var(--warn)}.erro .ks{fill:var(--neg)}.concluido .ks{fill:var(--pos)}
.kq{fill:var(--card);fill-opacity:.92}.ki{fill:none;stroke:var(--marca);stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}.parada .ki,.parada .mi{fill:var(--marca);stroke-width:1.5}
.pu{fill:var(--warn);opacity:.1;animation:pu 2.8s ease-in-out infinite}@keyframes pu{50%{opacity:.28}}
.sh{animation:sh 2.8s cubic-bezier(.45,0,.55,1) infinite}
.ck{stroke-dasharray:24;stroke-dashoffset:24;animation:ck .36s cubic-bezier(.16,1,.3,1) forwards}@keyframes ck{to{stroke-dashoffset:0}}
${CINTILA}
${ESTRELA_CSS}
@media (prefers-reduced-motion:reduce){.t0,.t1,.t2,.t3,.sd,.pu,.sh{animation:none}.ck{animation:none;stroke-dashoffset:0}}</style>`

/** Encurta com reticências até caber em `px` de largura, medido como a pílula mede. */
function encurtar(s: string, px: number, tamanho: number, peso: 400 | 500 | 600 = 500) {
  if (larguraTexto(s, tamanho, peso) <= px) return s
  let curto = s
  while (curto.length > 1 && larguraTexto(curto.trimEnd() + '…', tamanho, peso) > px) curto = curto.slice(0, -1)

  return curto.length > 1 ? curto.trimEnd() + '…' : ''
}

/**
 * A trilha de uma barra: fundo, preenchido em pixels, marcas de passo e de etapa, e a pílula com título e etapa.
 * `desliza` diz que a fonte devolvida ainda leva o deslize; quem desenha pede outro desenho depois de DESLIZE_MS.
 */
export function svgDaTrilha(vista: Vista, W: number, agora: number): { source: string; alt: string; desliza: boolean } {
  // Feitos sobre o total: barra concluída com passos pulados não enche até o fim.
  const fracao = Math.min(1, vista.feito / Math.max(1, vista.total))
  const pct = Math.round(fracao * 100)
  const alt = `${vista.titulo}: ${vista.rotulo}, ${vista.feito} de ${vista.total}, ${pct}%`
  const chave = JSON.stringify([W, vista.tom, vista.feito, vista.total, vista.cortes, vista.titulo, vista.pilula, vista.situacao])
  const pronta = trilhas.get(vista.id)
  if (pronta?.chave === chave) {
    const desliza = pronta.viva !== pronta.parada && agora - pronta.em < DESLIZE_MS

    return { source: desliza ? pronta.viva : pronta.parada, alt, desliza }
  }

  const H = ALT_TRILHA
  const fx = fracao * W
  const antes = cabecas.get(vista.id)
  const de = antes && vista.total <= antes.total ? antes.fracao * W : fx
  guardar(cabecas, vista.id, { fracao, total: vista.total })

  // Fronteira de etapa é uma cápsula curta, passo é um ponto; depois de passados viram tinta com um fio da trilha em volta.
  const marcasEm: { x: number; svg: string }[] = []
  for (let k = 1; k < vista.total; k++) {
    const x = (k / vista.total) * W
    const classe = x < fx - 1 ? 'mp' : 'ma'
    marcasEm.push({ x, svg: vista.cortes.includes(k)
      ? `<rect x="${(x - 1.5).toFixed(1)}" y="${(H - 10) / 2}" width="3" height="10" rx="1.5" class="${classe}"/>`
      : `<circle cx="${x.toFixed(1)}" cy="${H / 2}" r="1.5" class="${classe}"/>` })
  }

  // Pílula `card` com a marca do estado, o título e a etapa atual; em trilha estreita, um disco com o número da etapa.
  const marca = MARCA[vista.tom]
  let pilula = ''
  let kw = H
  if (W < ESTREITA) {
    const ativo = vista.segmentos.findIndex(estado => estado !== 'feito')
    const posicao = ativo < 0 ? vista.total - 1 : ativo
    const numero = vista.cortes.length === 0 ? posicao + 1 : vista.cortes.filter(corte => corte <= posicao).length + 1
    pilula = `<circle cx="0" cy="${H / 2}" r="${H / 2 - 0.5}" class="pl"/>${
      marca
        ? `<path d="${marca}" transform="translate(-6 ${H / 2 - 6}) scale(.5)" class="mi"/>`
        : vista.tom === 'andamento'
          ? estrela(0, H / 2, 6.5, 'css')
          : `<text x="0" y="${H / 2 + 4.2}" text-anchor="middle" class="kt">${numero}</text>`
    }`
  } else {
    // Marca de 12 px e 6 de vão (gap-inline) antes do texto, 10 de respiro de cada lado. O título vai em 600:
    // a medida conta 500 e a folga de 2,3% cabe no respiro.
    const larguraMarca = 18
    const maxima = Math.max(80, W * 0.55)
    const medir = (titulo: string, etapa: string) => larguraTexto(titulo, 12, 500) + (etapa ? larguraTexto(` · ${etapa}`, 12, 400) : 0)
    const cabe = (titulo: string, etapa: string) => 20 + larguraMarca + medir(titulo, etapa) <= maxima
    // Faltando espaço a etapa encurta com reticências e só sai quando não sobra lugar para 6 letras dela;
    // o título só encurta se nem sozinho couber.
    let etapa = vista.pilula
    if (!cabe(vista.titulo, etapa)) {
      while (etapa.length > 6 && !cabe(vista.titulo, etapa.trimEnd() + '…')) etapa = etapa.slice(0, -1)
      etapa = cabe(vista.titulo, etapa.trimEnd() + '…') ? etapa.trimEnd() + '…' : ''
    }
    let nome = vista.titulo
    if (!cabe(nome, '')) {
      while (nome.length > 3 && !cabe(nome + '…', '')) nome = nome.slice(0, -1)
      nome = nome.trimEnd() + '…'
    }
    const larguraNome = medir(nome, etapa)
    kw = Math.round(20 + larguraMarca + larguraNome)
    const esquerda = -(larguraMarca + larguraNome) / 2
    const meio = esquerda + larguraMarca + larguraNome / 2
    pilula =
      `<rect x="${-kw / 2 + 0.5}" y=".5" width="${kw - 1}" height="${H - 1}" rx="${(H - 1) / 2}" class="pl"/>` +
      (marca
        ? `<path d="${marca}" transform="translate(${esquerda.toFixed(1)} ${H / 2 - 6}) scale(.5)" class="mi${vista.tom === 'concluido' ? ' {{CK}}' : ''}"/>`
        : estrela(esquerda + 6, H / 2, 6.5, 'css')) +
      `<text x="${meio.toFixed(1)}" y="${H / 2 + 4.2}" text-anchor="middle" class="kt">${esc(nome)}${etapa ? `<tspan class="kc"> · ${esc(etapa)}</tspan>` : ''}</text>`
  }
  const prender = (x: number) => Math.max(kw / 2, Math.min(W - kw / 2, x))
  const kx = prender(fx)

  // Preenchido na cor do estado do começo da trilha até a pílula: um véu que vai de quase nada a 30% e, por cima,
  // pixels na grade de 3 px que adensam e ganham opacidade até ficarem cheios junto da pílula. A rampa cobre o
  // preenchido inteiro (no mínimo RAMPA px), para ler como uma barra que enche e não como chuvisco.
  const borda = kx - kw / 2
  const rampa = Math.max(RAMPA, borda)
  const pontos = new Map<string, string>()
  for (let col = 0; col * 3 < fx; col++) {
    const x = col * 3
    const u = Math.max(0, Math.min(1, 1 - (borda - x - 1.5) / rampa))
    const denso = 0.3 + 0.7 * Math.pow(u, 1.2)
    const tinta = `p${Math.min(4, Math.floor(Math.pow(u, 1.1) * 5))}`
    for (let r = 0; r * 3 + 2 < H; r++) {
      if (hash(col, r, 1) > denso) continue
      ponto(pontos, `${tinta} t${Math.floor(hash(col, r, 2) * 4)}`, x, (H % 3) / 2 + r * 3)
    }
  }
  const pixels = [...pontos].map(([classe, d]) => `<path class="${classe}" d="${d}"/>`).join('')

  // O estado escrito na própria trilha, sem linha embaixo: à direita da pílula, sobre o trilho liso, quando cabem
  // 120 px ali; senão à esquerda, sobre o preenchido, num chip `card` que deixa o texto legível em cima dos pixels.
  // Esperando, erro, parada e concluído levam o ícone do estado antes do texto; em andamento, só o passo ativo.
  let estado = ''
  let livreDe = [0, 0]
  let textoNaDireita = false
  if (W >= ESTREITA && vista.situacao) {
    const icone = MARCA[vista.tom]
    const larguraIcone = icone ? 18 : 0
    const direitaLivre = W - 12 - (kx + kw / 2 + 12)
    const esquerdaLivre = borda - 12 - 12 - 20
    const precisa = larguraIcone + larguraTexto(vista.situacao, 12)
    const naDireita = direitaLivre >= Math.min(precisa, 120)
    // Concluída sem espaço à direita fica sem o texto: a pílula já leva o ✓ e o tempo total.
    const sala = (naDireita ? direitaLivre : vista.tom === 'concluido' ? 0 : esquerdaLivre) - larguraIcone
    const texto = sala >= 40 ? encurtar(vista.situacao, sala, 12) : ''
    if (texto) {
      const w = larguraIcone + larguraTexto(texto, 12)
      const x0 = naDireita ? kx + kw / 2 + 12 : 22
      const fundo = naDireita ? '' : `<rect x="${x0 - 10}" y="2" width="${(w + 20).toFixed(1)}" height="${H - 4}" rx="${(H - 4) / 2}" class="kq"/>`
      const marcaDoEstado = icone ? `<path d="${icone}" transform="translate(${x0} ${H / 2 - 6}) scale(.5)" class="ki"/>` : ''
      livreDe = [x0 - 10, x0 + w + 10]
      textoNaDireita = naDireita
      estado = `${fundo}${marcaDoEstado}<text x="${(x0 + larguraIcone).toFixed(1)}" y="${H / 2 + 4.2}" class="ks">${esc(texto)}</text>`
    }
  }
  // Andamento: um brilho atravessa a parte cheia a cada 2,8 s. Esperando: a trilha toda pulsa em âmbar, devagar.
  const brilho =
    vista.tom === 'andamento' && fx > 24
      ? `<rect x="-96" width="96" height="${H}" fill="url(#shm)" class="sh"/>`
      : ''
  // As marcas de passo saem de baixo do texto do estado; com o texto à direita, saem todas as de lá (um ponto
  // solto depois do texto lia como pontuação).
  const marcas = marcasEm.filter(({ x }) => x < (livreDe[0] ?? 0) || (!textoNaDireita && x > (livreDe[1] ?? 0))).map(({ svg }) => svg).join('')
  const pulso = vista.tom === 'esperando' ? `<rect width="${W}" height="${H}" class="pu"/>` : ''

  // ease-out do sistema: cubic-bezier(.16,1,.3,1).
  const curva = `dur="${DESLIZE_MS / 1000}s" calcMode="spline" keyTimes="0;1" keySplines=".16 1 .3 1" fill="freeze"`
  const montar = (desliza: boolean) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" class="${vista.tom}">${ESTILO_TRILHA.replace('</style>', brilho ? `@keyframes sh{0%{transform:translateX(0)}70%,100%{transform:translateX(${(fx + 96).toFixed(0)}px)}}</style>` : '</style>')}
<defs><linearGradient id="shm"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient><linearGradient id="lav" gradientUnits="userSpaceOnUse" x1="0" x2="${Math.max(1, borda).toFixed(1)}"><stop offset="0" class="lv" stop-opacity=".06"/><stop offset="1" class="lv" stop-opacity=".3"/></linearGradient><clipPath id="pill"><rect width="${W}" height="${H}" rx="${H / 2}"/></clipPath><clipPath id="fill"><rect width="${fx.toFixed(1)}" height="${H}">${
    desliza ? `<animate attributeName="width" from="${de.toFixed(1)}" to="${fx.toFixed(1)}" ${curva}/>` : ''
  }</rect></clipPath></defs>
<g clip-path="url(#pill)"><rect width="${W}" height="${H}" class="tr"/>${pulso}
<g clip-path="url(#fill)"><rect width="${fx.toFixed(1)}" height="${H}" class="ch"/>${pixels}${brilho}</g>${marcas}</g>${estado}
<g transform="translate(${kx.toFixed(1)} 0)">${
    desliza ? `<animateTransform attributeName="transform" type="translate" from="${prender(de).toFixed(1)} 0" to="${kx.toFixed(1)} 0" ${curva}/>` : ''
  }${pilula.replace(' {{CK}}', desliza ? ' ck' : '')}</g></svg>`

  const desliza = Math.abs(de - fx) > 0.5
  const parada = montar(false)
  const viva = desliza ? montar(true) : parada
  guardar(trilhas, vista.id, { chave, em: agora, viva, parada })

  return { source: viva, alt, desliza }
}

// Nome em sans 12, modelo e relógio em muted, ferramenta e estado no rótulo mono em caixa alta do uso.
const ESTILO_FAIXA = `<style>${TOKENS}
.sn{font:500 12px ${SANS};fill:var(--ink)}.st{font-weight:400;fill:var(--muted)}
.sw{font:500 10.5px ${MONO};letter-spacing:.08em;text-transform:uppercase;fill:var(--muted)}.sw.esperando{fill:var(--espera)}.sw.erro{fill:var(--erro)}
.sr{font:500 11.5px ${SANS};fill:var(--muted)}.sg{font:500 11px ${SANS};fill:var(--muted);font-variant-numeric:tabular-nums}
.fx{fill:var(--soft)}.fx.andamento{fill:var(--f-andamento)}.fx.esperando{fill:var(--f-esperando)}.fx.erro{fill:var(--f-erro)}.fx.concluido{fill:var(--f-concluido)}
.gi{fill:none;stroke:var(--muted);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.px{fill:var(--cor)}.dt{fill:var(--cor)}.dk{fill:none;stroke:var(--pos);stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
${CINTILA}
.w0,.w1,.w2,.w3,.w4,.w5,.w6,.w7{animation:wv 1.6s linear infinite;opacity:.35}${[1, 2, 3, 4, 5, 6, 7].map(k => `.w${k}{animation-delay:-${((8 - k) * 0.2).toFixed(1)}s}`).join('')}
@keyframes wv{0%,30%,100%{opacity:.35}12%{opacity:1}}
${RELOGIO_CSS}
${ESTRELA_CSS}
${ICONE_CSS}
@media (prefers-reduced-motion:reduce){.sd,.w0,.w1,.w2,.w3,.w4,.w5,.w6,.w7{animation:none}}</style>`

const ESTADO_FAIXA: Record<Tom, string> = {
  andamento: 'em andamento',
  esperando: 'aguardando aprovação',
  erro: 'falhou',
  concluido: 'concluído',
  parada: 'parado',
  neutro: 'parado',
}

const linhas = new Map<string, { chave: string; html: string }>()

// O texto de 12 px fica opticamente no meio da faixa de 20 com a linha de base a 14.
const BASE = 14
// Na calha, o ícone de linha do tipo do agente (ou o terminal do comando) em 16 px e o número, como na v1. Rodando,
// a antena (ou o cursor) pisca de leve.
const calha = (y: number, rotulo: string, desenho: Desenho, animado = false) =>
  iconeEm(desenho, 0, y + 2, 16, { anima: animado ? 'css' : false, classe: 'gi' }) + `<text x="20" y="${y + BASE}" class="sg">${rotulo}</text>`

function faixa(id: string, linha: LinhaVista, i: number, y: number, W: number, agora: number, comCalha = true) {
  // Sem a calha (a banda, onde o ícone e o número clicável vêm fora do desenho) a faixa começa em x = 0.
  const CALHA = comCalha ? CALHA_PX : 0
  // Passou de uma hora, o relógio de rolos da origem não tem casa para a hora: fica o tempo escrito.
  const longo = linha.fim === null && agora - linha.inicio >= HORA ? decorrido(agora - linha.inicio) : ''
  const chave = JSON.stringify([W, y, i, { ...linha, relogio: '' }, longo, comCalha])
  const pronta = linhas.get(id)
  if (pronta?.chave === chave) return pronta.html

  const SW = W - CALHA
  const meio = y + ALT_FAIXA / 2
  // O concluído troca o ponto por um check `pos`; falha e parada levam a palavra, para o estado não depender só da cor.
  const palavra = linha.tom === 'concluido' ? '' : linha.selo
  // Em faixa apertada o estado e o relógio ficam inteiros: sai primeiro o modelo com o esforço, depois o título encurta.
  // A palavra segue o nome no mesmo texto, 8 px depois dele, qualquer que seja a fonte que o quadro tiver.
  const nomeX = CALHA + 20
  const sala = W - 10 - RELOGIO_W - 12 - nomeX - (palavra ? larguraMono(palavra) + 8 : 0)
  const inteiro = linha.titulo + (linha.meta ? ` (${linha.meta})` : '')
  let nome = larguraTexto(inteiro, 12) > sala ? linha.titulo : inteiro
  const cabe = nome
  while (nome.length > 4 && larguraTexto(nome, 12) > sala) nome = nome.slice(0, -1)
  if (nome !== cabe) nome = nome.trimEnd() + '…'
  const parentese = nome === inteiro ? nome.lastIndexOf(' (') : -1
  const marcado = parentese > 0 ? `${esc(nome.slice(0, parentese))}<tspan class="st">${esc(nome.slice(parentese))}</tspan>` : esc(nome)

  // Com o agente rodando, entre o nome e o relógio passa uma onda de pixels de 2 px a cada 6, na cor do estado; nos
  // outros estados o vão fica liso e o fundo tingido diz o estado.
  let pixels = ''
  if (linha.tom === 'andamento') {
    const livre = nomeX + larguraTexto(nome, 12) + (palavra ? 8 + larguraMono(palavra) : 0) + 12
    const ate = W - 10 - (longo ? larguraTexto(longo, 11.5) : RELOGIO_W) - 12
    const pontos = new Map<string, string>()
    for (let x = Math.ceil(livre / 6) * 6, k = 0; x + 2 <= ate; x += 6, k++) ponto(pontos, `w${k % 8}`, x, meio - 1)
    pixels = [...pontos].map(([classe, d]) => `<path class="px ${classe}" d="${d}"/>`).join('')
  }
  const tempo = longo
    ? `<text x="${W - 10}" y="${y + BASE}" text-anchor="end" class="sr ckt">${longo}</text>`
    : linha.fim === null
      ? relogioVivo(W - 10 - RELOGIO_W, y + BASE - 12, linha.inicio, 'sr')
      : `<text x="${W - 10}" y="${y + BASE}" text-anchor="end" class="sr ckt">${decorrido(linha.fim - linha.inicio)}</text>`

  const faixaDe = (classe: string) => `<rect x="${CALHA}" y="${y}" width="${SW}" height="${ALT_FAIXA}" rx="${ALT_FAIXA / 2}" class="${classe}"/>`
  const html =
    `<g class="${linha.tom}">` +
    (comCalha ? calha(y, String(linha.numero), linha.comando ? 'terminal' : desenhoDoTipo(linha.tipo), linha.tom === 'andamento') : '') +
    faixaDe(`fx ${linha.tom}`) +
    pixels +
    (linha.tom === 'concluido'
      ? `<path d="M${CALHA + 7.5} ${meio}l2.5 2.6 4.6-5.2" class="dk"/>`
      : linha.tom === 'andamento' && !linha.comando
        ? estrela(CALHA + 11, meio, 5.5, 'css')
        : `<circle cx="${CALHA + 11}" cy="${meio}" r="3" class="dt${linha.tom === 'andamento' ? ' sd' : ''}"/>`) +
    `<text x="${nomeX}" y="${y + BASE}" class="sn">${marcado}${palavra ? `<tspan dx="8" class="sw ${linha.tom}">${esc(palavra)}</tspan>` : ''}</text>` +
    tempo +
    '</g>'
  guardar(linhas, id, { chave, html })

  return html
}

export type FaixaSvg = { key: string; source: string; alt: string; altura: number; icone: string; rotulo: string }

/** O ícone de linha da calha num Svg próprio de 16 × 24, para a banda, onde o número ao lado é um Button. */
function svgDoIconeDaCalha(desenho: Desenho, animado: boolean) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="${VAO_FAIXA + ALT_FAIXA}"><style>${TOKENS}.gi{fill:none;stroke:var(--muted);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}${ICONE_CSS}</style>${iconeEm(desenho, 0, VAO_FAIXA + 2, 16, { anima: animado ? 'css' : false, classe: 'gi' })}</svg>`
}

/**
 * Uma faixa por agente ou comando, cada uma no próprio SVG: mudar uma redesenha só ela. Com `comCalha` (o painel) o
 * ícone e o número vão dentro do desenho; sem ela (a banda) a faixa começa em 0 e `icone`/`rotulo` vêm à parte.
 */
export function svgDasFaixas(vista: Vista, W: number, agora: number, comCalha = true): FaixaSvg[] {
  const CALHA = comCalha ? CALHA_PX : 0
  const altura = VAO_FAIXA + ALT_FAIXA
  const abrir = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${altura}">${ESTILO_FAIXA}`
  const saida = vista.linhas.map((linha, i): FaixaSvg => {
    const id = `${vista.id}/${linha.id}`

    return {
      key: linha.id,
      source: fonteViva(`${id}${comCalha ? '' : '#'}`, `${abrir}${faixa(`${id}${comCalha ? '' : '#'}`, linha, i, VAO_FAIXA, W, agora, comCalha)}</svg>`, agora),
      icone: svgDoIconeDaCalha(linha.comando ? 'terminal' : desenhoDoTipo(linha.tipo), linha.tom === 'andamento'),
      rotulo: String(linha.numero),
      alt: `${linha.comando ? 'comando' : 'agente'} ${linha.titulo}${linha.pasta ? ` em ${linha.pasta}` : ''}: ${ESTADO_FAIXA[linha.tom]}${linha.tom === 'andamento' && linha.selo ? `, ${linha.selo}` : ''}`,
      altura,
    }
  })
  if (vista.ocultas > 0) {
    const y = VAO_FAIXA
    const desenhoDoResto: Desenho = vista.linhas.every(linha => linha.comando) && vista.linhas.length > 0 ? 'terminal' : 'robo'
    const texto = vista.resumo.replace(/^\+/, '')
    saida.push({
      key: '+',
      source:
        abrir +
        (comCalha ? calha(y, `+${vista.ocultas}`, desenhoDoResto) : '') +
        `<rect x="${CALHA}" y="${y}" width="${W - CALHA}" height="${ALT_FAIXA}" rx="${ALT_FAIXA / 2}" class="fx"/>` +
        `<text x="${CALHA + 11}" y="${y + BASE}" class="sn st">${esc(texto)}</text></svg>`,
      alt: vista.resumo,
      altura,
      icone: svgDoIconeDaCalha(desenhoDoResto, false),
      rotulo: `+${vista.ocultas}`,
    })
  }

  return saida
}

/**
 * Grupo automático (agentes ou comandos sem barra da conversa principal): no lugar da trilha vazia a 0%, um rótulo
 * em muted na coluna da calha, com o que está rodando.
 */
export function svgDoRotulo(vista: Vista, W: number) {
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${ALT_FAIXA}">${ESTILO_FAIXA}<g class="${vista.tom}">` +
    `<text x="1" y="${BASE}" class="sn st"><tspan font-weight="500">${esc(vista.titulo)}</tspan> · ${esc(vista.rotulo)}</text></g></svg>`

  return { source, alt: `${vista.titulo}: ${vista.rotulo}`, altura: ALT_FAIXA }
}

/** O fio entre duas barras, tracejado como toda divisória interna do sistema. */
export const svgDoDivisor = (total: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="1"><style>${TOKENS}</style><path d="M0 .5H${total}" fill="none" style="stroke:var(--line)" stroke-dasharray="4 4"/></svg>`

/**
 * Barra fina do painel: trilho `soft` e o preenchido na cor do estado, sem pílula. Uma fração por desenho; o quadro é
 * pequeno e a fonte muda só quando a fração ou o estado mudam.
 */
export function svgBarraFina(fracao: number, tom: Tom, W: number, H: number) {
  const f = Math.max(0, Math.min(1, fracao))
  const largura = Math.max(H, Math.round(W))

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${largura}" height="${H}" viewBox="0 0 ${largura} ${H}" class="${tom}"><style>${TOKENS}.tr{fill:var(--soft)}.ch{fill:var(--cor)}</style><rect width="${largura}" height="${H}" rx="${H / 2}" class="tr"/>${
    f > 0 ? `<rect width="${Math.max(H, f * largura).toFixed(1)}" height="${H}" rx="${H / 2}" class="ch"/>` : ''
  }</svg>`
}

/**
 * Barra fina na cor dada (a do nível do agente, o laranja da tarefa) sobre o trilho `soft`. Com `brilho`, um reflexo
 * claro atravessa a parte cheia a cada 2,8 s em SMIL (vai num Svg isInteractive; a fonte não muda por tique).
 */
export function svgBarraCor(fracao: number, cor: string, W: number, H: number, brilho = false) {
  const f = Math.max(0, Math.min(1, fracao))
  const largura = Math.max(H, Math.round(W))
  const cheio = Math.max(H, f * largura)
  const reflexo =
    brilho && f > 0
      ? `<defs><linearGradient id="r"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".25"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient><clipPath id="c"><rect width="${cheio.toFixed(1)}" height="${H}" rx="${H / 2}"/></clipPath></defs>` +
        `<g clip-path="url(#c)"><rect x="-64" width="64" height="${H}" fill="url(#r)"><animate attributeName="x" values="-64;${cheio.toFixed(0)};${cheio.toFixed(0)}" keyTimes="0;.7;1" dur="2.8s" begin="0s" repeatCount="indefinite"/></rect></g>`
      : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${largura}" height="${H}" viewBox="0 0 ${largura} ${H}"><style>${TOKENS}.tr{fill:var(--soft)}</style><rect width="${largura}" height="${H}" rx="${H / 2}" class="tr"/>${
    f > 0 ? `<rect width="${cheio.toFixed(1)}" height="${H}" rx="${H / 2}" fill="${cor}"/>${reflexo}` : ''
  }</svg>`
}

// --- Painel: ícones de estado e de passo, e a linha de métricas com números tabulares --------------------------------

/** Fonte do texto em Svg no painel: a do app primeiro, para casar com o Text ao lado. */
const SANS_PAINEL = "'Anthropic Sans',-apple-system,BlinkMacSystemFont,'Instrument Sans',sans-serif"
const VERDE = '#4CB782'
const VERMELHO = '#E5534B'
const AMBAR = '#F2B53A'
const CINZA = '#8A857B'
const TRACO = 'fill="none" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"'
const caixa16 = (corpo: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">${corpo}</svg>`
const ALERTA = (cor: string) =>
  `<g transform="scale(${(16 / 24).toFixed(4)})" fill="none" stroke="${cor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3"/><path d="M12 9v4M12 17h.01"/></g>`

export type NomeDoEstado = 'rodando' | 'comando' | 'aprovacao' | 'concluida' | 'falhou' | 'parada' | 'planejado'

/**
 * O ícone de estado no canto direito do título, 16 px. `anima` diz que ele vai num Svg isInteractive: a estrela do
 * rodando gira e o ponto do comando respira, em SMIL. Os outros são imagem parada.
 */
export function svgDoEstado(nome: NomeDoEstado): { source: string; anima: boolean } {
  const desenho: Record<NomeDoEstado, string> = {
    rodando: estrela(8, 8, 7, 'smil'),
    comando: `<circle cx="8" cy="8" r="3.5" fill="#B8B3A8"><animate attributeName="opacity" values="1;.35;1" dur="2.4s" begin="0s" repeatCount="indefinite"/></circle>`,
    aprovacao: ALERTA(AMBAR),
    concluida: `<path d="M3 8.4 6.4 11.6 13 4.6" stroke="${VERDE}" ${TRACO}/>`,
    falhou: `<path d="M4 4l8 8M12 4l-8 8" stroke="${VERMELHO}" ${TRACO}/>`,
    parada: `<rect x="4" y="4" width="8" height="8" rx="1.5" fill="${CINZA}"/>`,
    planejado: `<circle cx="8" cy="8" r="6.2" stroke="#9C978D" ${TRACO}/><path d="M8 4.8v3.6l2.4 1.5" stroke="#9C978D" ${TRACO}/>`,
  }

  return { source: caixa16(desenho[nome]), anima: nome === 'rodando' || nome === 'comando' }
}

export type EstadoDoPasso = 'feito' | 'ativo' | 'espera' | 'aberto' | 'falhou' | 'pulado'

/**
 * O ícone de um passo da lista, 16 px em coordenadas inteiras: check verde num disco tingido, a estrela parada no
 * ativo (o alerta âmbar quando a barra espera o usuário), anel cinza no aberto, ✕ vermelho num disco tingido no que
 * falhou e a seta de pular, tracejada, no pulado.
 */
export function svgDoPasso(estado: EstadoDoPasso) {
  // Lucide "circle-check", "circle", "circle-x", "triangle-alert" e "circle-dashed" com a seta de pular, em 16 px
  // (traço 2 na grade de 24); a cor diz o estado: verde feito, vermelho falhou, âmbar espera, cinza aberto e pulado.
  const linha = (cor: string, corpo: string) =>
    `<g transform="scale(${(16 / 24).toFixed(4)})" fill="none" stroke="${cor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${corpo}</g>`
  const desenho: Record<EstadoDoPasso, string> = {
    feito: linha(VERDE, '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>'),
    ativo: estrela(8, 8, 6.5, 'parada'),
    espera: ALERTA(AMBAR),
    aberto: linha('#8A857B', '<circle cx="12" cy="12" r="10"/>'),
    falhou: linha(VERMELHO, '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/>'),
    pulado: linha('#8A857B', '<circle cx="12" cy="12" r="10" stroke-dasharray="3.2 3.1"/><path d="M8 12h8M13 9l3 3-3 3"/>'),
  }

  return caixa16(desenho[estado])
}

const COR_DO_TEXTO: Record<string, string> = { warning: AMBAR, error: '#FF7A6B', claude: TERRACOTA }
const LINHA_PAINEL = 18

/** Relógio "m:ss" de rolos, como o da banda: corre sozinho no desenho, sem trocar a fonte a cada segundo. */
function relogioDoPainel(xFim: number, topo: number, inicio: number, dezenas: boolean, classeTexto = 'mv') {
  const base = topo + 13
  const digitos = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']
  const avanco = 7.4 // dígito tabular de 13 px
  const rolo = (cx: number, figuras: string[], classe: string) =>
    `<g class="${classe}"><text class="${classeTexto}" text-anchor="middle">${figuras.map((f, i) => `<tspan x="${cx.toFixed(1)}" y="${base + i * LINHA_PAINEL}">${f}</tspan>`).join('')}</text></g>`
  const s1 = xFim - avanco / 2
  const s10 = s1 - avanco
  const dois = s10 - avanco / 2 - 2
  const m1 = dois - 2 - avanco / 2
  const m10 = m1 - avanco
  const id = `rp${inicio}`

  return {
    largura: xFim - ((dezenas ? m10 : m1) - avanco / 2),
    svg:
      `<style>.${id}{--d:-{{T:${inicio}}}s}</style><g class="${id}"><clipPath id="${id}"><rect x="${(m10 - avanco).toFixed(1)}" y="${topo}" width="${(xFim - m10 + avanco).toFixed(1)}" height="${LINHA_PAINEL}"/></clipPath>` +
      `<g clip-path="url(#${id})">${dezenas ? `<g class="pmm">${rolo(m10, ['', ...digitos.slice(1)], 'pm10')}</g>` : ''}${rolo(m1, digitos, 'pm1')}` +
      `<text x="${dois.toFixed(1)}" y="${base}" class="${classeTexto}" text-anchor="middle">:</text>${rolo(s10, digitos.slice(0, 6), 'ps10')}${rolo(s1, digitos, 'ps1')}</g></g>`,
  }
}
/**
 * O cartão "Tempo" da tarefa aberta: o valor é o relógio de rolos, como nas métricas, ampliado ao corpo de 20 px do
 * cartão. A fonte só muda quando a tarefa fecha (ou passa das 10 min e de 1 h); entre os tiques fica a mesma.
 */
export function svgDoCartaoTempo(rotulo: string, inicio: number, fim: number | null, W: number, H: number, agora: number) {
  const corrido = (fim ?? agora) - inicio
  if (fim !== null || corrido >= HORA) return svgDoCartao(rotulo, relogioTexto(corrido), W, H)
  const dezenas = corrido >= 600_000
  const largura = relogioDoPainel(0, 0, inicio, dezenas, 'cvr').largura
  const k = 20 / 13
  const relogioSvg = relogioDoPainel(largura, 0, inicio, dezenas, 'cvr').svg
  const modelo = svgDoCartao(rotulo, '', W, H).replace(
    '</style>',
    `.cvr{font:600 13px ${SANS_PAINEL};fill:var(--ink);font-variant-numeric:tabular-nums}${RELOGIO_PAINEL_CSS}</style>`,
  ).replace('</svg>', `<g transform="translate(12 ${H - 13 - 20}) scale(${k.toFixed(4)})">${relogioSvg}</g></svg>`)

  return fonteViva(`cartao:${inicio}`, modelo, agora)
}
const RELOGIO_PAINEL_CSS = `.ps1{animation:p10 10s steps(10) var(--d) infinite}.ps10{animation:p6 60s steps(6) var(--d) infinite}
.pm1{animation:p10 600s steps(10) var(--d) infinite}.pm10{animation:p6 3600s steps(6) var(--d) infinite}.pmm{animation:pmm 600s steps(1,end) var(--d) both}
@keyframes p10{to{transform:translateY(-${LINHA_PAINEL * 10}px)}}@keyframes p6{to{transform:translateY(-${LINHA_PAINEL * 6}px)}}@keyframes pmm{from{opacity:0}to{opacity:1}}`

/**
 * A linha de métricas de um item do painel, num Svg da largura da barra embaixo dela: a situação à esquerda e os
 * números à direita, em algarismos tabulares e encostados na ponta da barra. Rodando, o tempo é o relógio de rolos
 * (a fonte fica igual entre os tiques); terminado, ou passado de uma hora, é texto.
 */
export function svgDaMetrica(
  id: string,
  esquerda: { texto: string; cor?: string; apagado?: boolean },
  numeros: string,
  tempo: { inicio: number; fim: number | null },
  W: number,
  agora: number,
) {
  const H = 20
  const largura = Math.max(80, Math.round(W))
  const corrido = (tempo.fim ?? agora) - tempo.inicio
  const vivo = tempo.fim === null && corrido < HORA
  // Antes de 10 min o relógio não reserva a casa das dezenas; passando delas a fonte muda uma vez e ela entra.
  const relogioVivoAqui = vivo ? relogioDoPainel(largura, 1, tempo.inicio, corrido >= 600_000) : null
  const tempoTexto = vivo ? '' : relogioTexto(corrido)
  const larguraTempo = relogioVivoAqui ? relogioVivoAqui.largura : larguraTexto(tempoTexto, 13, 400) * 0.96
  const larguraNumeros = numeros ? larguraTexto(numeros, 13, 400) : 0
  const xNumeros = largura - larguraTempo - (numeros ? 6 : 0)
  const sala = xNumeros - larguraNumeros - 12
  const texto = encurtar(esquerda.texto, sala, 13, 500)
  const cor = esquerda.cor ? (COR_DO_TEXTO[esquerda.cor] ?? esquerda.cor) : ''
  const modelo =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${largura}" height="${H}" viewBox="0 0 ${largura} ${H}"><style>${TOKENS}` +
    `.ml{font:500 13px ${SANS_PAINEL};fill:var(--ink)}.ml.ap{fill:var(--muted)}.mv{font:400 13px ${SANS_PAINEL};fill:var(--muted);font-variant-numeric:tabular-nums}${RELOGIO_PAINEL_CSS}</style>` +
    `<text x="0" y="14" class="ml${esquerda.apagado ? ' ap' : ''}"${cor ? ` style="fill:${cor}"` : ''}>${esc(texto)}</text>` +
    (numeros ? `<text x="${xNumeros.toFixed(1)}" y="14" text-anchor="end" class="mv">${esc(numeros)}</text>` : '') +
    (relogioVivoAqui ? relogioVivoAqui.svg : `<text x="${largura}" y="14" text-anchor="end" class="mv">${esc(tempoTexto)}</text>`) +
    '</svg>'

  return { source: fonteViva(`painel:${id}`, modelo, agora), alt: [esquerda.texto, [numeros, relogioTexto(corrido)].filter(Boolean).join(' ')].filter(Boolean).join(' · '), altura: H }
}

/**
 * A barra do agente rodando: sem fração (o agente não diz quanto falta), um segmento de 28% que atravessa o trilho
 * um passo por segundo, o tique do mod. Vai num Svg isInteractive, e o passo é SMIL (o que o doc dele promete rodar):
 * a fonte não muda, a imagem não recarrega.
 */
export function svgBarraIndeterminada(cor: string, W: number, H: number) {
  const largura = Math.max(H * 4, Math.round(W))
  const seg = Math.round(largura * 0.28)
  const passos = 5
  const salto = (largura + seg) / (passos + 1)
  const xs = Array.from({ length: passos }, (_, k) => (-seg + salto * (k + 1)).toFixed(1))

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${largura}" height="${H}" viewBox="0 0 ${largura} ${H}"><style>${TOKENS}.tr{fill:var(--soft)}</style><clipPath id="c"><rect width="${largura}" height="${H}" rx="${H / 2}"/></clipPath><rect width="${largura}" height="${H}" rx="${H / 2}" class="tr"/><g clip-path="url(#c)"><rect x="${xs[0]}" width="${seg}" height="${H}" rx="${H / 2}" fill="${cor}"><animate attributeName="x" values="${xs.join(';')}" dur="${passos}s" calcMode="discrete" begin="0s" repeatCount="indefinite"/></rect></g></svg>`
}

/**
 * Um cartão do painel (Custo, Tokens, Tempo) no desktop: retângulo de cantos arredondados no fundo `soft`, rótulo
 * cinza de 13 px em cima e o valor em tinta, 20 px, embaixo. A API não tem raio de canto em Box; em Svg tem.
 */
export function svgDoCartao(rotulo: string, valor: string, W: number, H: number) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><style>${TOKENS}.cf{fill:var(--soft)}.cr{font:400 13px ${SANS};fill:var(--muted)}.cv{font:600 20px ${SANS};fill:var(--ink);font-variant-numeric:tabular-nums}</style><rect width="${W}" height="${H}" rx="9" class="cf"/><text x="12" y="23" class="cr">${esc(rotulo)}</text><text x="12" y="${H - 13}" class="cv">${esc(valor)}</text></svg>`
}

/** A divisória fina entre as linhas do painel, com o respiro acima e abaixo dentro da altura. */
export const svgDoFio = (W: number, H: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><style>${TOKENS}</style><path d="M0 ${Math.floor(H / 2) + 0.5}H${W}" fill="none" style="stroke:var(--line)" stroke-opacity=".7"/></svg>`
