// Estrutura portada de plan-progress (zycck/claude-mods, commit 549ecee6d9), MIT, Kirill Serditov.
// Licença em ../licenses/plan-progress-LICENSE. Trilha, pílula, marcas, faixas e relógio de rolos vêm de lá;
// a pílula leva também o título da barra, que na origem fica numa coluna à esquerda da trilha.
// A pele usa uma paleta própria:
// trilha e faixas são superfícies `soft` sem contorno, a pílula é um `card` com fio `line` por cima da trilha,
// o preenchido é a textura de pixels que cintila na cor do estado (a da origem), laranja só no que está ativo e cor
// de estado na marca, na palavra e no fundo tingido de cada faixa.
import type { Estado, Pendencia } from '../types'
import { ICONE_CSS, desenhoDoTipo, iconeDaPendenciaEm, iconeEm } from './icones'
import type { Desenho, IconePendencia } from './icones'
import { fracaoDe } from './modelo'
import type { LinhaVista, Tom, Vista } from './modelo'

// Trilha de 24 px, a altura das pílulas do uso; a faixa tem 20 com 4 de vão, na grade de 4 px.
export const ALT_TRILHA = 24
const ALT_FAIXA = 20
const VAO_FAIXA = 4
const ESTREITA = 360
const CALHA_PX = 36 // ícone de linha (16 px) e número, à esquerda da faixa, como na v1
const RAMPA = 240 // rampa mínima do preenchido: trilha curta já começa forte
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
const TOKENS = `svg{--ink:#F1EDE4;--card:#1E1D1B;--soft:#2D2C29;--line:#4E4B46;--ctl:#8A857B;--muted:#B8B3A8;--pos:#D8F35A;--warn:#F2B53A;--neg:#FF7A6B;--espera:#F2B53A;--erro:#FF7A6B;--info:#8DB8EA;--f-andamento:#5C2F22;--f-esperando:#54431A;--f-erro:#5A282C;--f-concluido:#3B4619}
@media (prefers-color-scheme:light){svg{--ink:#1D1D1B;--card:#FFFDFA;--soft:#E8E4DB;--line:#CBC6BB;--ctl:#807B70;--muted:#5A5952;--pos:#2F7A36;--warn:#946200;--neg:#C42B3E;--espera:#1D1D1B;--erro:#1D1D1B;--info:#2F6DB5;--f-andamento:#F8C7B6;--f-esperando:#F1D38A;--f-erro:#F4C1C7;--f-concluido:#C3DC9E}}
.andamento{--cor:${LARANJA};--marca:${LARANJA}}.esperando{--cor:var(--warn);--marca:var(--warn)}.aguardando{--cor:var(--info);--marca:var(--info)}.erro{--cor:var(--neg);--marca:var(--neg)}
.concluido{--cor:var(--pos);--marca:var(--pos)}.parada{--cor:var(--ctl);--marca:var(--ctl)}.neutro{--cor:var(--ctl)}`
const CINTILA = `.t0,.t1,.t2,.t3{animation:tw 2.2s ease-in-out infinite}.t1{animation-duration:2.8s;animation-delay:-.7s}.t2{animation-duration:1.9s;animation-delay:-1.3s}.t3{animation-duration:3.3s;animation-delay:-.4s}
@keyframes tw{0%,100%{opacity:1}50%{opacity:.45}}.sd{animation:sp 1.1s ease-in-out infinite}@keyframes sp{50%{opacity:.3}}`

// Marca do estado na pílula, em caixa de 24 px: "alert" do sistema na espera, "hourglass" do Lucide quando aguarda agente; "x" e "check" do Lucide, a fonte
// externa que o sistema admite para o ícone que o conjunto dele não tem. Em andamento a marca é um ponto.
const MARCA: Partial<Record<Estado, string>> = {
  esperando: 'M12 4 2 20h20zM12 10.5v4M12 17.5h.01',
  aguardando: 'M5 22h14M5 2h14M17 22v-4.2a2 2 0 0 0-.6-1.4L12 12l-4.4 4.4a2 2 0 0 0-.6 1.4V22M7 2v4.2a2 2 0 0 0 .6 1.4L12 12l4.4-4.4a2 2 0 0 0 .6-1.4V2',
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

// O tempo de faixas e métricas fica fora do desenho, num Text ao lado: no desktop o Svg sem isInteractive é uma
// imagem, e trocar a fonte a cada segundo recarrega a imagem (pisca), enquanto um relógio animado dentro dela volta
// ao instante da fonte a cada recarga. Sem o tempo, a fonte só muda quando o estado muda.
/** A coluna do tempo ao lado de faixa e métrica: 7 colunas ("1:02:03"), 56 px na grade de 8. */
export const TEMPO_COLUNAS = 7
export const TEMPO_PX = 56

// Onde a cabeça de cada barra parou, em fração da trilha e com o total de passos de então, para o deslize sair de lá.
// Em fração, mudar a largura (painel docado, janela) não desliza; total que cresce (agente novo, plano maior) pula sem
// deslize, para a pílula não andar para trás à vista.
const cabecas = new Map<string, { fracao: number; total: number }>()
// O deslize fica na fonte só enquanto toca: recarregar depois uma fonte que ainda o descreve faria a pílula
// voltar à posição antiga e avançar de novo a cada redesenho.
const trilhas = new Map<string, { chave: string; em: number; viva: string; parada: string }>()

const ESTILO_TRILHA = `<style>${TOKENS}
.tr{fill:var(--soft)}.ch{fill:url(#lav)}.lv{stop-color:var(--cor)}
.pc{fill:var(--cor)}
.ma{fill:var(--ctl)}.mp{fill:var(--ink);stroke:var(--soft);stroke-width:1.5;paint-order:stroke}
.pl{fill:var(--card);stroke:var(--line)}.mk{fill:var(--marca)}.mi{fill:none;stroke:var(--marca);stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}
.kt{font:600 12px ${SANS};fill:var(--ink);font-variant-numeric:tabular-nums}.kc{font-weight:400;fill:var(--muted)}
.ks{font:500 12px ${SANS};fill:var(--muted)}.esperando .ks{fill:var(--warn)}.aguardando .ks{fill:var(--info)}.erro .ks{fill:var(--neg)}.concluido .ks{fill:var(--pos)}
.kq{fill:var(--card);fill-opacity:.92}.ki{fill:none;stroke:var(--marca);stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}.parada .ki,.parada .mi{fill:var(--marca);stroke-width:1.5}
.pu{fill:var(--warn);opacity:.1;animation:pu 2.8s ease-in-out infinite}@keyframes pu{50%{opacity:.28}}
.sh{animation:sh 2.8s cubic-bezier(.45,0,.55,1) infinite}@keyframes sh{0%{x:-96px}70%,100%{x:100%}}
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

/** Uma fração da largura como porcentagem de SVG, sem zeros sobrando: 0,5 vira "50%". */
const emPct = (fracao: number) => `${Number((Math.max(0, Math.min(1, fracao)) * 100).toFixed(2))}%`

// A textura do preenchido: pontos de 2 px na grade de 3, num ladrilho de 96 × 24 repetido por <pattern>. Cada um dos
// quatro padrões leva um quarto dos pontos e pinta um retângulo com o próprio cintilar (t0 a t3); a máscara `rm` vai de
// quase nada a cheio até a pílula, a rampa que antes saía da densidade ponto a ponto.
const LADRILHO = 96
const PADROES_DOS_PONTOS = (() => {
  const caminhos = ['', '', '', '']
  for (let col = 0; col * 3 < LADRILHO; col++) {
    for (let r = 0; r * 3 + 2 < ALT_TRILHA; r++) {
      if (hash(col, r, 1) > 0.72) continue
      const k = Math.floor(hash(col, r, 2) * 4)
      caminhos[k] += `M${col * 3} ${(ALT_TRILHA % 3) / 2 + r * 3}h2v2h-2z`
    }
  }

  return caminhos
    .map((d, k) => `<pattern id="pt${k}" patternUnits="userSpaceOnUse" width="${LADRILHO}" height="${ALT_TRILHA}"><path class="pc" d="${d}"/></pattern>`)
    .join('')
})()

/**
 * A trilha de uma barra: fundo, preenchido em pixels, marcas de passo e de etapa, e a pílula com título e etapa.
 * A geometria é em porcentagem, sem viewBox: no app a imagem sem `width` estica até a borda (Box em coluna com
 * flexGrow) e a trilha acompanha a largura real, que a superfície não informa em px. `W` é só a estimativa da largura
 * para decidir onde o texto cabe (pílula, estado); o clip da trilha corta o que passar.
 * `desliza` diz que a fonte devolvida ainda leva o deslize; quem desenha pede outro desenho depois de DESLIZE_MS.
 */
export function svgDaTrilha(vista: Vista, W: number, agora: number): { source: string; alt: string; desliza: boolean } {
  const fracao = fracaoDe(vista)
  const pct = Math.round(fracao * 100)
  const alt = `${vista.titulo}: ${vista.rotulo}, ${vista.feito} de ${vista.total}, ${pct}%`
  const chave = JSON.stringify([W, vista.tom, vista.feito, vista.total, vista.cortes, vista.titulo, vista.pilula, vista.situacao])
  const pronta = trilhas.get(vista.id)
  if (pronta?.chave === chave) {
    const desliza = pronta.viva !== pronta.parada && agora - pronta.em < DESLIZE_MS

    return { source: desliza ? pronta.viva : pronta.parada, alt, desliza }
  }

  const H = ALT_TRILHA
  const antes = cabecas.get(vista.id)
  const de = antes && vista.total <= antes.total ? antes.fracao : fracao
  guardar(cabecas, vista.id, { fracao, total: vista.total })
  const fx = fracao * W

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
  // A pílula anda de 0 até a borda sem sair da trilha: a borda esquerda dela fica em f × (largura − kw), ou seja, em
  // f% menos f × kw px. Um <svg> aninhado em x = f% leva a pílula, deslocada em px dentro dele; o preenchido acaba em
  // f%, sempre embaixo da pílula.
  const desloca = (f: number) => (kw / 2 - f * kw).toFixed(1)
  const borda = fx - fracao * kw
  const direita = (1 - fracao) * kw

  // O estado escrito na própria trilha, sem linha embaixo: à direita da pílula, sobre o trilho liso, quando cabem
  // 120 px ali; senão à esquerda, sobre o preenchido, num chip `card` que deixa o texto legível em cima dos pixels.
  // Esperando, erro, parada e concluído levam o ícone do estado antes do texto; em andamento, só o passo ativo.
  let estado = ''
  let livreDe = [0, 0]
  let textoNaDireita = false
  if (W >= ESTREITA && vista.situacao) {
    const icone = MARCA[vista.tom]
    const larguraIcone = icone ? 18 : 0
    const direitaLivre = W - 12 - (fx + direita + 12)
    const esquerdaLivre = borda - 12 - 12 - 20
    const precisa = larguraIcone + larguraTexto(vista.situacao, 12)
    const naDireita = direitaLivre >= Math.min(precisa, 120)
    // Concluída enche até o fim e a pílula vai para a borda: o texto passa para a esquerda, no chip.
    const sala = (naDireita ? direitaLivre : esquerdaLivre) - larguraIcone
    const texto = sala >= 40 ? encurtar(vista.situacao, sala, 12) : ''
    if (texto) {
      const w = larguraIcone + larguraTexto(texto, 12)
      // À direita o texto anda com a pílula (no <svg> aninhado em f%); à esquerda fica preso ao começo da trilha.
      const x0 = naDireita ? direita + 12 : 22
      const fundo = naDireita ? '' : `<rect x="${x0 - 10}" y="2" width="${(w + 20).toFixed(1)}" height="${H - 4}" rx="${(H - 4) / 2}" class="kq"/>`
      const marcaDoEstado = icone ? `<path d="${icone}" transform="translate(${x0.toFixed(1)} ${H / 2 - 6}) scale(.5)" class="ki"/>` : ''
      const corpo = `${fundo}${marcaDoEstado}<text x="${(x0 + larguraIcone).toFixed(1)}" y="${H / 2 + 4.2}" class="ks">${esc(texto)}</text>`
      livreDe = [x0 - 10, x0 + w + 10]
      textoNaDireita = naDireita
      estado = naDireita ? `<svg x="${emPct(fracao)}" overflow="visible">${corpo}</svg>` : corpo
    }
  }
  // Andamento: um brilho atravessa a parte cheia a cada 2,8 s (o <svg> aninhado tem a largura do preenchido, e o
  // `x` do brilho vai de −96 px a 100% dela). Esperando: a trilha toda pulsa em âmbar, devagar.
  const brilho =
    vista.tom === 'andamento' && fx > 24
      ? `<svg width="${emPct(fracao)}" height="${H}"><rect x="-96" width="96" height="${H}" fill="url(#shm)" class="sh"/></svg>`
      : ''
  // Marcas: fronteira de etapa é uma cápsula curta, passo é um ponto; depois de passados viram tinta com um fio da
  // trilha em volta. Com o texto à direita, só as de antes da cabeça (um ponto solto depois do texto lia como
  // pontuação); com o chip à esquerda, saem as de baixo dele, pela estimativa da largura.
  let marcas = ''
  for (let k = 1; k < vista.total; k++) {
    const f = k / vista.total
    const x = f * W
    if (textoNaDireita ? f >= fracao : x >= (livreDe[0] ?? 0) && x <= (livreDe[1] ?? 0)) continue
    const classe = f < fracao - 0.001 ? 'mp' : 'ma'
    marcas += vista.cortes.includes(k)
      ? `<rect x="${emPct(f)}" y="${(H - 10) / 2}" width="3" height="10" rx="1.5" transform="translate(-1.5 0)" class="${classe}"/>`
      : `<circle cx="${emPct(f)}" cy="${H / 2}" r="1.5" class="${classe}"/>`
  }
  const pulso = vista.tom === 'esperando' ? `<rect width="100%" height="${H}" class="pu"/>` : ''
  const cheio = emPct(fracao)
  const pontos = [0, 1, 2, 3].map(k => `<rect width="${cheio}" height="${H}" fill="url(#pt${k})" class="t${k}"/>`).join('')

  // ease-out do sistema: cubic-bezier(.16,1,.3,1).
  const curva = `dur="${DESLIZE_MS / 1000}s" calcMode="spline" keyTimes="0;1" keySplines=".16 1 .3 1" fill="freeze"`
  const montar = (desliza: boolean) => `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="${H}" class="${vista.tom}">${ESTILO_TRILHA}
<defs><linearGradient id="shm"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient><linearGradient id="lav"><stop offset="0" class="lv" stop-opacity=".06"/><stop offset="1" class="lv" stop-opacity=".3"/></linearGradient><linearGradient id="rp"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset=".6" stop-color="#fff" stop-opacity=".5"/><stop offset="1" stop-color="#fff"/></linearGradient>${PADROES_DOS_PONTOS}<mask id="rm" maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="${H}"><rect width="${cheio}" height="${H}" fill="url(#rp)"/></mask><clipPath id="pill"><rect width="100%" height="${H}" rx="${H / 2}"/></clipPath><clipPath id="fill"><rect width="${cheio}" height="${H}">${
    desliza ? `<animate attributeName="width" from="${emPct(de)}" to="${cheio}" ${curva}/>` : ''
  }</rect></clipPath></defs>
<g clip-path="url(#pill)"><rect width="100%" height="${H}" class="tr"/>${pulso}
<g clip-path="url(#fill)"><rect width="${cheio}" height="${H}" class="ch"/><g mask="url(#rm)">${pontos}</g>${brilho}</g>${marcas}${estado}</g>
<svg x="${cheio}" overflow="visible">${desliza ? `<animate attributeName="x" from="${emPct(de)}" to="${cheio}" ${curva}/>` : ''}<g transform="translate(${desloca(fracao)} 0)">${
    desliza ? `<animateTransform attributeName="transform" type="translate" from="${desloca(de)} 0" to="${desloca(fracao)} 0" ${curva}/>` : ''
  }${pilula.replace(' {{CK}}', desliza ? ' ck' : '')}</g></svg></svg>`

  const desliza = Math.abs(de - fracao) * W > 0.5
  const parada = montar(false)
  const viva = desliza ? montar(true) : parada
  guardar(trilhas, vista.id, { chave, em: agora, viva, parada })

  return { source: viva, alt, desliza }
}

// Nome em sans 12, modelo em muted, ferramenta e estado no rótulo mono em caixa alta do uso.
const ESTILO_FAIXA = `<style>${TOKENS}
.sn{font:500 12px ${SANS};fill:var(--ink)}.st{font-weight:400;fill:var(--muted)}
.sw{font:500 10.5px ${MONO};letter-spacing:.08em;text-transform:uppercase;fill:var(--muted)}.sw.esperando{fill:var(--espera)}.sw.erro{fill:var(--erro)}
.sg{font:500 11px ${SANS};fill:var(--muted);font-variant-numeric:tabular-nums}
.fx{fill:var(--soft)}.fx.andamento{fill:var(--f-andamento)}.fx.esperando{fill:var(--f-esperando)}.fx.erro{fill:var(--f-erro)}.fx.concluido{fill:var(--f-concluido)}
.gi{fill:none;stroke:var(--muted);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.px{fill:var(--cor)}.dt{fill:var(--cor)}.dk{fill:none;stroke:var(--pos);stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
${CINTILA}
.w0,.w1,.w2,.w3,.w4,.w5,.w6,.w7{animation:wv 1.6s linear infinite;opacity:.35}${[1, 2, 3, 4, 5, 6, 7].map(k => `.w${k}{animation-delay:-${((8 - k) * 0.2).toFixed(1)}s}`).join('')}
@keyframes wv{0%,30%,100%{opacity:.35}12%{opacity:1}}
${ESTRELA_CSS}
${ICONE_CSS}
@media (prefers-reduced-motion:reduce){.sd,.w0,.w1,.w2,.w3,.w4,.w5,.w6,.w7{animation:none}}</style>`

const ESTADO_FAIXA: Record<Tom, string> = {
  andamento: 'em andamento',
  esperando: 'aguardando aprovação',
  aguardando: 'aguardando',
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

/**
 * Largura "100% menos `px`" para um elemento que começa em `px`: o atributo fica em 100% e o CSS do Chromium (o do app)
 * desconta o começo; sem a calha, é só o atributo.
 */
const ateAFim = (px: number, folga = 0) =>
  px + folga === 0 ? 'width="100%"' : `width="100%" style="width:calc(100% - ${px + folga}px)"`

// A onda de pixels da faixa rodando: oito padrões de um ponto de 2 px a cada 48, cada um 6 px depois do anterior, e
// um retângulo por padrão com o próprio atraso (w0 a w7): a onda corre pela largura real, sem conta em px.
const ONDA = Array.from({ length: 8 }, (_, k) => `<pattern id="w${k}" patternUnits="userSpaceOnUse" width="48" height="2"><rect x="${k * 6}" width="2" height="2" class="px"/></pattern>`).join('')

function faixa(id: string, linha: LinhaVista, i: number, y: number, W: number, comCalha = true) {
  // Sem a calha (a banda, onde o ícone e o número clicável vêm fora do desenho) a faixa começa em x = 0. A geometria
  // vai até 100% da imagem; `W` estima a largura só para encurtar o nome, e o clip da faixa corta o que passar.
  const CALHA = comCalha ? CALHA_PX : 0
  const chave = JSON.stringify([W, y, i, { ...linha, relogio: '' }, comCalha])
  const pronta = linhas.get(id)
  if (pronta?.chave === chave) return pronta.html

  const meio = y + ALT_FAIXA / 2
  // O concluído troca o ponto por um check `pos`; falha e parada levam a palavra, para o estado não depender só da cor.
  const palavra = linha.tom === 'concluido' ? '' : linha.selo
  // Em faixa apertada o estado fica inteiro: sai primeiro o modelo com o esforço, depois o título encurta.
  // A palavra segue o nome no mesmo texto, 8 px depois dele, qualquer que seja a fonte que o quadro tiver.
  const nomeX = CALHA + 20
  const sala = W - 10 - nomeX - (palavra ? larguraMono(palavra) + 8 : 0)
  const inteiro = linha.titulo + (linha.meta ? ` (${linha.meta})` : '')
  let nome = larguraTexto(inteiro, 12) > sala ? linha.titulo : inteiro
  const cabe = nome
  while (nome.length > 4 && larguraTexto(nome, 12) > sala) nome = nome.slice(0, -1)
  if (nome !== cabe) nome = nome.trimEnd() + '…'
  const parentese = nome === inteiro ? nome.lastIndexOf(' (') : -1
  const marcado = parentese > 0 ? `${esc(nome.slice(0, parentese))}<tspan class="st">${esc(nome.slice(parentese))}</tspan>` : esc(nome)

  // Com o agente rodando, entre o nome e a ponta da faixa passa uma onda de pixels de 2 px a cada 6, na cor do estado;
  // nos outros estados o vão fica liso e o fundo tingido diz o estado.
  let pixels = ''
  if (linha.tom === 'andamento') {
    const livre = Math.ceil((nomeX + larguraTexto(nome, 12) + (palavra ? 8 + larguraMono(palavra) : 0) + 12) / 6) * 6
    pixels = Array.from({ length: 8 }, (_, k) => `<rect x="${livre}" y="${meio - 1}" ${ateAFim(livre, 10)} height="2" fill="url(#w${k})" class="w${k}"/>`).join('')
  }

  const forma = `x="${CALHA}" y="${y}" ${ateAFim(CALHA)} height="${ALT_FAIXA}" rx="${ALT_FAIXA / 2}"`
  const html =
    // Os padrões ficam dentro do grupo do estado: o conteúdo de um <pattern> herda as variáveis (a --cor) de onde ele está.
    `<g class="${linha.tom}">` +
    `<defs>${pixels ? ONDA : ''}<clipPath id="fc"><rect ${forma}/></clipPath></defs>` +
    (comCalha ? calha(y, String(linha.numero), linha.comando ? 'terminal' : desenhoDoTipo(linha.tipo), linha.tom === 'andamento') : '') +
    `<rect ${forma} class="fx ${linha.tom}"/>` +
    `<g clip-path="url(#fc)">` +
    pixels +
    (linha.tom === 'concluido'
      ? `<path d="M${CALHA + 7.5} ${meio}l2.5 2.6 4.6-5.2" class="dk"/>`
      : linha.tom === 'andamento' && !linha.comando
        ? estrela(CALHA + 11, meio, 5.5, 'css')
        : `<circle cx="${CALHA + 11}" cy="${meio}" r="3" class="dt${linha.tom === 'andamento' ? ' sd' : ''}"/>`) +
    `<text x="${nomeX}" y="${y + BASE}" class="sn">${marcado}${palavra ? `<tspan dx="8" class="sw ${linha.tom}">${esc(palavra)}</tspan>` : ''}</text>` +
    '</g></g>'
  guardar(linhas, id, { chave, html })

  return html
}

export type FaixaSvg = { key: string; source: string; alt: string; altura: number; icone: string; rotulo: string }

/** A calha da banda: 24 px com o ícone de 16 a 7 px da borda, a mesma do pino das pendências e do "5H" do uso. */
export const LARGURA_DA_CALHA = 24
const RECUO_DO_ICONE = 7

/** O ícone de linha da calha num Svg próprio de 24 × 24, para a banda, onde o número ao lado é um Button. */
function svgDoIconeDaCalha(desenho: Desenho, animado: boolean) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${LARGURA_DA_CALHA}" height="${VAO_FAIXA + ALT_FAIXA}"><style>${TOKENS}.gi{fill:none;stroke:var(--muted);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}${ICONE_CSS}</style>${iconeEm(desenho, RECUO_DO_ICONE, VAO_FAIXA + 2, 16, { anima: animado ? 'css' : false, classe: 'gi' })}</svg>`
}

/**
 * Uma faixa por agente ou comando, cada uma no próprio SVG: mudar uma redesenha só ela. Com `comCalha` (o painel) o
 * ícone e o número vão dentro do desenho; sem ela (a banda) a faixa começa em 0 e `icone`/`rotulo` vêm à parte.
 * O SVG tem largura 100% e nenhum viewBox: a faixa vai até a borda da imagem, qualquer que seja a largura dela.
 */
export function svgDasFaixas(vista: Vista, W: number, comCalha = true): FaixaSvg[] {
  const CALHA = comCalha ? CALHA_PX : 0
  const altura = VAO_FAIXA + ALT_FAIXA
  const abrir = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="${altura}">${ESTILO_FAIXA}`
  const saida = vista.linhas.map((linha, i): FaixaSvg => {
    const id = `${vista.id}/${linha.id}`

    return {
      key: linha.id,
      source: `${abrir}${faixa(`${id}${comCalha ? '' : '#'}`, linha, i, VAO_FAIXA, W, comCalha)}</svg>`,
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
        `<rect x="${CALHA}" y="${y}" ${ateAFim(CALHA)} height="${ALT_FAIXA}" rx="${ALT_FAIXA / 2}" class="fx"/>` +
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
 * em muted, com o que está rodando. Largura 100%: o texto que passar da imagem é cortado na borda dela.
 */
export function svgDoRotulo(vista: Vista) {
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="${ALT_FAIXA}">${ESTILO_FAIXA}<g class="${vista.tom}">` +
    `<text x="1" y="${BASE}" class="sn st"><tspan font-weight="500">${esc(vista.titulo)}</tspan> · ${esc(vista.rotulo)}</text></g></svg>`

  return { source, alt: `${vista.titulo}: ${vista.rotulo}`, altura: ALT_FAIXA }
}

/** O fio entre duas barras, tracejado como toda divisória interna do sistema, de borda a borda da imagem. */
export const svgDoDivisor = () =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="1"><style>${TOKENS}</style><line x1="0" y1=".5" x2="100%" y2=".5" fill="none" style="stroke:var(--line)" stroke-dasharray="4 4"/></svg>`

/** Um espaço transparente de `H` px de altura, que estica na largura como os outros desenhos. */
export const svgDoRespiro = (H: number) => `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="${H}"></svg>`

// Faixa de pendências: linhas de 24 px, a altura das faixas. Os ícones e a pílula de quem depende são Svg; os textos
// são nativos, na fonte do app, como o rótulo da linha de cima. A pílula `soft` tem largura comum e vem logo depois do
// título.
export const ALT_PENDENCIA = VAO_FAIXA + ALT_FAIXA
const ESTILO_PENDENCIA = `<style>${TOKENS}
.pi{fill:none;stroke:var(--muted);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}.pi.pe{stroke:var(--warn)}
.pq{font:500 11px ${SANS};fill:var(--muted)}.pf{fill:var(--soft);stroke:var(--line);stroke-width:1}</style>`

/** Um ícone da faixa de pendências (o pino, a seta ou o de um item) num Svg de 24 de largura, a `x` px da borda e
 * centrado na altura. */
export const svgDoIconeDaPendencia = (nome: IconePendencia | 'pino' | 'abrir' | 'fechar' | 'nota', altura = ALT_PENDENCIA, x = 7) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="${altura}">${ESTILO_PENDENCIA}` +
  iconeDaPendenciaEm(nome, x, (altura - 16) / 2, 16, nome === 'pino' ? 'pi pe' : 'pi') +
  '</svg>'

/** A largura comum da pílula de quem depende, na grade de 8; 0 quando nenhum item diz de quem depende. */
export function larguraDoQuem(lista: Pendencia[]) {
  const maior = Math.max(0, ...lista.map(item => (item.quem ? larguraTexto(item.quem, 11) : 0)))

  return maior === 0 ? 0 : Math.min(128, Math.max(48, Math.ceil((maior + 18) / 8) * 8))
}

/** A pílula de quem depende, de largura comum `quemPx` e alta como a linha (24), centrada; vazia sem `quem`. */
export function svgDoQuem(quem: string, quemPx: number, recuo = 0) {
  const nome = quem ? encurtar(quem, quemPx - 14, 11) : ''

  // `recuo` px transparentes à direita: a pílula acaba onde acaba o glifo da seta, que o respiro do Button afasta da borda.
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${quemPx + recuo}" height="${ALT_PENDENCIA}">${ESTILO_PENDENCIA}` +
    (nome
      ? `<rect x="0.5" y="3.5" width="${quemPx - 1}" height="17" rx="8.5" class="pf"/><text x="${quemPx / 2}" y="15.5" text-anchor="middle" class="pq">${esc(nome)}</text>`
      : '') +
    '</svg>'
  )
}

// Linha recolhida em pílulas, na pele das pílulas do barra-uso logo acima (hooks/svg.ts daquele mod): superfície de
// 24 px com raio pill numa imagem de 28, ícone de 14 em traço de 1,5 a 8 px da borda, 6 até o texto, 10 à direita e 8
// entre as pílulas. O fundo é o `soft` de lá (os mods não importam um do outro: mudou lá, muda aqui). A contagem vai
// numa pílula pequena `warn`; item que espera o ok do usuário leva borda e ícone `warn` e vem primeiro.
export const ALT_PILULAS = 28
const PILULA_ALT = 24
const PILULA_TOPO = (ALT_PILULAS - PILULA_ALT) / 2
const PILULA_MEIO = ALT_PILULAS / 2
const PILULA_ESQ = 8
const PILULA_DIR = 10
const PILULA_ICONE = 14
const PILULA_GAP = 6
const PILULA_VAO = 8
const CONTA_ALT = 18
// Antes da contagem, 2 px: o pino (Svg de 24 com o desenho a 7) acaba em ~20, e o vão até a pílula fica nos 6 do DS.
const CONTA_X = 2
export const TITULO_CURTO = 22
// Traço de 1,5 na grade de 14, como no barra-uso: na grade de 24 dos ícones Lucide, 1,5 × 24 / 14.
const ESTILO_PILULAS = `<style>svg{--pl:#33322E;--pl-ink:#F1EDE4;--pl-muted:#ABA69B;--pl-warn:#F2B53A;--pl-sobre:#1E1D1B}
@media (prefers-color-scheme:light){svg{--pl:#E2DDD3;--pl-ink:#1D1D1B;--pl-muted:#5A5952;--pl-warn:#946200;--pl-sobre:#FFFDFA}}
text{dominant-baseline:central}.pp{fill:var(--pl)}.pp.ok{stroke:var(--pl-warn);stroke-width:1}
.pt{font:500 12px ${SANS};fill:var(--pl-ink)}.pn{font:600 12px ${SANS};fill:var(--pl-muted);font-variant-numeric:tabular-nums}
.pc{fill:var(--pl-warn)}.pct{font:600 12px ${SANS};fill:var(--pl-sobre);font-variant-numeric:tabular-nums}
.pi2{fill:none;stroke:var(--pl-muted);stroke-width:2.57;stroke-linecap:round;stroke-linejoin:round}.pi2.ok{stroke:var(--pl-warn)}</style>`

/** O item espera o ok do usuário: o `quem` diz "seu ok", "ok" ou fala em aprovação. */
export const ehAprovacao = (quem: string) =>
  /(^|[^a-z])ok([^a-z]|$)|aprova/.test(quem.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase())

/** A ordem da linha recolhida: os que esperam aprovação primeiro, depois a ordem de chegada. */
export const ordemDaLinha = (lista: Pendencia[]) => [...lista.filter(item => ehAprovacao(item.quem)), ...lista.filter(item => !ehAprovacao(item.quem))]

/** O título curto da pílula: até TITULO_CURTO letras, com reticências. */
export function tituloCurto(titulo: string) {
  const letras = [...titulo]

  return letras.length <= TITULO_CURTO ? titulo : letras.slice(0, TITULO_CURTO - 1).join('').trimEnd() + '…'
}

const larguraDaPilula = (titulo: string) => Math.ceil(PILULA_ESQ + PILULA_ICONE + PILULA_GAP + larguraTexto(titulo, 12) * 1.03 + PILULA_DIR)
const larguraDoMais = (n: number) => Math.ceil(PILULA_DIR + larguraTexto(`+${n}`, 12, 600) * 1.03 + PILULA_DIR)
const larguraDaConta = (n: number) => Math.max(CONTA_ALT, Math.ceil(larguraTexto(String(n), 12, 600) * 1.03 + 12))

/**
 * A linha recolhida numa imagem de 100% × 28: a contagem e uma pílula por item, até caber nos `W` px estimados; as
 * que não cabem viram uma pílula final "+N". `mostradas` diz quantas entraram. A imagem estica até a seta, alinhada à
 * esquerda: a largura real maior que a estimativa sobra à direita, nunca empurra a seta.
 */
export function svgDasPilulas(lista: Pendencia[], W: number): { source: string; alt: string; mostradas: number } {
  const itens = ordemDaLinha(lista).map(item => ({ ...item, curto: tituloCurto(item.titulo), ok: ehAprovacao(item.quem) }))
  const conta = larguraDaConta(lista.length)
  const inicio = CONTA_X + conta + PILULA_VAO
  const ate = (k: number) => itens.slice(0, k).reduce((x, item) => x + larguraDaPilula(item.curto) + PILULA_VAO, inicio)
  let mostradas = itens.length
  while (mostradas > 0 && ate(mostradas) - PILULA_VAO + (mostradas < itens.length ? PILULA_VAO + larguraDoMais(itens.length - mostradas) : 0) > W) mostradas -= 1

  const partes = [
    `<rect class="pc" x="${CONTA_X}" y="${(ALT_PILULAS - CONTA_ALT) / 2}" width="${conta}" height="${CONTA_ALT}" rx="${CONTA_ALT / 2}"/>`,
    `<text class="pct" x="${CONTA_X + conta / 2}" y="${PILULA_MEIO}" text-anchor="middle">${lista.length}</text>`,
  ]
  let x = inicio
  for (const item of itens.slice(0, mostradas)) {
    const w = larguraDaPilula(item.curto)
    // A borda de 1 px fica dentro da pílula: o retângulo encolhe meio pixel de cada lado.
    const caixa = item.ok ? { x: x + 0.5, y: PILULA_TOPO + 0.5, w: w - 1, h: PILULA_ALT - 1 } : { x, y: PILULA_TOPO, w, h: PILULA_ALT }
    partes.push(
      `<rect class="pp${item.ok ? ' ok' : ''}" x="${caixa.x}" y="${caixa.y}" width="${caixa.w}" height="${caixa.h}" rx="${caixa.h / 2}"/>`,
      iconeDaPendenciaEm(item.icone, x + PILULA_ESQ, PILULA_MEIO - PILULA_ICONE / 2, PILULA_ICONE, item.ok ? 'pi2 ok' : 'pi2'),
      `<text class="pt" x="${x + PILULA_ESQ + PILULA_ICONE + PILULA_GAP}" y="${PILULA_MEIO}">${esc(item.curto)}</text>`,
    )
    x += w + PILULA_VAO
  }
  const resto = itens.length - mostradas
  if (resto > 0) {
    const w = larguraDoMais(resto)
    partes.push(
      `<rect class="pp" x="${x}" y="${PILULA_TOPO}" width="${w}" height="${PILULA_ALT}" rx="${PILULA_ALT / 2}"/>`,
      `<text class="pn" x="${x + w / 2}" y="${PILULA_MEIO}" text-anchor="middle">+${resto}</text>`,
    )
  }
  const titulos = itens.slice(0, mostradas).map(item => item.titulo + (item.ok ? ` (${item.quem})` : ''))
  const alt = `${lista.length} ${lista.length === 1 ? 'pendência' : 'pendências'}: ${titulos.join(', ')}${resto > 0 ? ` e mais ${resto}` : ''}`

  return {
    source: `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="${ALT_PILULAS}" role="img" aria-label="${esc(alt)}">${ESTILO_PILULAS}${partes.join('')}</svg>`,
    alt,
    mostradas,
  }
}

/** A largura estimada de um texto nativo do app desktop (sans de 13 px, peso 400), com 4% de folga. */
export const larguraNativa = (s: string) => larguraTexto(s, 13, 400) * 1.04

/**
 * A prévia dos títulos na linha recolhida: "Prompt da aula 4 · Vídeos · +1", até caber em `limite` pela medida dada
 * (px do texto nativo, ou colunas no terminal). O primeiro título encurta com reticências; os seguintes entram
 * inteiros ou viram o "+N".
 */
export function previaDasPendencias(titulos: string[], limite: number, medir: (s: string) => number = larguraNativa) {
  const resto = (n: number) => (n > 0 ? ` · +${n}` : '')
  const partes: string[] = []
  for (const [i, titulo] of titulos.entries()) {
    if (medir([...partes, titulo].join(' · ') + resto(titulos.length - i - 1)) <= limite) {
      partes.push(titulo)
      continue
    }
    if (partes.length > 0) return partes.join(' · ') + resto(titulos.length - i)
    const sufixo = resto(titulos.length - 1)
    let curto = titulo
    while (curto.length > 1 && medir(curto.trimEnd() + '…' + sufixo) > limite) curto = curto.slice(0, -1)

    return curto.length > 1 ? curto.trimEnd() + '…' + sufixo : `+${titulos.length}`
  }

  return partes.join(' · ')
}

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

/**
 * A linha de métricas de um item do painel, num Svg embaixo da barra: a situação à esquerda e os números à direita, em
 * algarismos tabulares e encostados na ponta. O tempo vem fora, num Text: com ele aqui a fonte trocaria a cada segundo.
 */
export function svgDaMetrica(esquerda: { texto: string; cor?: string; apagado?: boolean }, numeros: string, W: number) {
  const H = 20
  const largura = Math.max(80, Math.round(W))
  const larguraNumeros = numeros ? larguraTexto(numeros, 13, 400) : 0
  const sala = largura - larguraNumeros - 12
  const texto = encurtar(esquerda.texto, sala, 13, 500)
  const cor = esquerda.cor ? (COR_DO_TEXTO[esquerda.cor] ?? esquerda.cor) : ''
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${largura}" height="${H}" viewBox="0 0 ${largura} ${H}"><style>${TOKENS}` +
    `.ml{font:500 13px ${SANS_PAINEL};fill:var(--ink)}.ml.ap{fill:var(--muted)}.mv{font:400 13px ${SANS_PAINEL};fill:var(--muted);font-variant-numeric:tabular-nums}</style>` +
    `<text x="0" y="14" class="ml${esquerda.apagado ? ' ap' : ''}"${cor ? ` style="fill:${cor}"` : ''}>${esc(texto)}</text>` +
    (numeros ? `<text x="${largura}" y="14" text-anchor="end" class="mv">${esc(numeros)}</text>` : '') +
    '</svg>'

  return { source, alt: [esquerda.texto, numeros].filter(Boolean).join(' · '), altura: H }
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

/** A divisória de uma seção do painel de anotações (`line` nas anotações, `warn` tracejado nas pendências), sem
 * `width`: a imagem estica até a borda do pane. */
export const svgDoFioDaSecao = (H: number, tom: 'line' | 'warn') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="${H}"><style>${TOKENS}</style><line x1="0" y1="${Math.floor(H / 2) + 0.5}" x2="100%" y2="${Math.floor(H / 2) + 0.5}" fill="none" style="stroke:var(--${tom})"${tom === 'warn' ? ' stroke-opacity=".6" stroke-dasharray="4 4"' : ' stroke-opacity=".7"'}/></svg>`
