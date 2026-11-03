import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register, RenderElement, Timer, TurnUsage } from 'claude-code'

import type { Anotacao, Barra, Estado, Fala, Faixa, JanelaAnotacoes, Pendencia } from '../types'
import {
  NOTAS_INICIAL,
  alturaDasNotas,
  aplicarAnotacoes,
  comoAnotacao,
  contagemDeAnotacoes,
  editarAnotacao,
  gravarAnotacao,
  linhasDe,
  listaDasNotas,
  pedeAnotacoes,
} from './anotacoes'
import {
  MAX_FALAS,
  PERFIS,
  adotar,
  aplicar,
  aplicarPendencias,
  automatica,
  barraEmFoco,
  barraParaFaixa,
  comandoLegivel,
  comoBarra,
  comoFaixa,
  comoPendencia,
  cortar,
  duracao,
  esforcoPt,
  falasDaConversa,
  falasDaLinha,
  ferramentaCurta,
  fimDoTurno,
  finalizada,
  modeloCurto,
  pedePendencias,
  pendentes,
  paraDepois,
  textoDoLembrete,
  percentual,
  perfilDoArquivo,
  relogioPreciso,
  restaurada,
  resumoDaBarra,
  retomarAguardando,
  textoDaLinha,
  textoDoBloqueio,
  tipoDoPasso,
  vistas,
} from './modelo'
import type { Perfil, Resposta, Tom } from './modelo'
import { ICONES_PENDENCIA, desenhoDoTipo, glifoDe } from './icones'
import { desenharPainel } from './painel'
import { desenharAnotacoes } from './painel-anotacoes'
import type { Campo } from './painel-anotacoes'
import { contextoDe, custoDe, janelaDe, somarUsd } from './precos'
import {
  ALT_PENDENCIA,
  ALT_PILULAS,
  ALT_TRILHA,
  DESLIZE_MS,
  LARGURA_DA_CALHA,
  TEMPO_COLUNAS,
  TEMPO_PX,
  larguraDoQuem,
  previaDasPendencias,
  svgDasPilulas,
  svgDaTrilha,
  svgDasFaixas,
  svgDoDivisor,
  svgDoIconeDaPendencia,
  svgDoQuem,
  svgDoRespiro,
  svgDoRotulo,
} from './svg'

const FERRAMENTA = 'mcp__progresso__progresso'
const MAX_FAIXAS = 40
const MAX_SESSOES = 20
const MAX_VISTAS = 4
// Espaço da largura de um dígito: o percentual ocupa sempre três casas.
const ESPACO_DE_DIGITO = String.fromCharCode(0x2007)
// No desktop a banda não sabe a própria largura em px: `bodyColumns` sai da largura do pane dividida pelo avanço da
// fonte de código, e o Box do app mede em `ch` da fonte da banda (7,69 a 8,5 px por coluna nos prints). Por isso
// trilha, faixas, divisor e pílulas são Svg sem `width`, com geometria em %, num Box em coluna que estica (`esticado`):
// a imagem vai até a coluna da direita, qualquer que seja a largura real. A conta em px abaixo só estima onde cabe
// texto (pílula, estado, nome do agente), no menor px por coluna medido (908 px com 118 colunas), e erra para menos:
// o que sobra fica em branco, nunca cortado.
const PX_POR_COLUNA_MIN = 7.69
/** A coluna da direita em colunas: o "%" das barras e o relógio das faixas ("1:02:03"). "100%" ocupa ~4,6 ch e o
 * Button plain soma o respiro (pad.xs) dos dois lados; com 7 os dois cabem e as duas colunas fecham no mesmo x. */
export const COLUNA_DIREITA = TEMPO_COLUNAS
/** A coluna do número da faixa: "12" ou "+3" com o respiro do Button; minWidth, então nunca corta. */
const COLUNA_DO_NUMERO = 4

/** Estimativas em px (conservadoras) da banda, da trilha e da faixa, para decidir texto; a geometria não usa. */
export function larguras(colunas: number) {
  const px = (n: number) => Math.floor(n * PX_POR_COLUNA_MIN)
  const total = Math.max(320, px(colunas))
  const trilha = Math.max(120, total - px(COLUNA_DIREITA + 1))
  const faixa = Math.max(120, total - LARGURA_DA_CALHA - px(1 + COLUNA_DO_NUMERO + 1 + 1 + COLUNA_DIREITA))

  return { trilha, faixa, total }
}
const SILENCIO_MS = 3000
// Quanto um nome de ferramenta fica na faixa antes de dar lugar ao seguinte: chamadas paralelas trocavam em milissegundos.
const TROCA_MS = 1000
// Quanto a banda espera o desenho dos mods de baixo. A espera em `next` não conta no orçamento de 10 s do hook nesta
// versão do engine, mas contava numa anterior (um "ran past its 10s budget" em 2.1.288); passado o limite, a banda
// sai sem o que eles desenham, em vez de não sair. Fica abaixo do tique de 1 s: um desenho que esperasse mais seria
// substituído pelo do tique seguinte antes de sair.
const ESPERA_ABAIXO_MS = 800
const SO_DA_PRINCIPAL =
  'ok: a lista de execução é só da conversa principal e não foi alterada. O seu progresso já aparece na sua faixa; não chame esta ferramenta de novo.'

const barras = atom({ plugin: 'progresso', key: 'barras' } as const, [])
const faixas = atom({ plugin: 'progresso', key: 'faixas' } as const, [])
const pendencias = atom({ plugin: 'progresso', key: 'pendencias' } as const, [])
const anotacoes = atom({ plugin: 'progresso', key: 'anotacoes' } as const, [])
const CAMPOS_VAZIOS = { titulo: '', valor: '', grupo: '' }
const JANELA_DAS_ANOTACOES: JanelaAnotacoes = {
  aberto: false,
  editando: null,
  apagando: null,
  novo: CAMPOS_VAZIOS,
  edicao: CAMPOS_VAZIOS,
  formulario: false,
  menu: null,
  recolhidos: [],
  pendenciasRecolhidas: false,
  notasRecolhidas: false,
  notasAltura: NOTAS_INICIAL,
  notasLinhas: 0,
}
const janelaAnotacoes = atom({ plugin: 'progresso', key: 'janelaAnotacoes' } as const, JANELA_DAS_ANOTACOES)
const pendenciasAbertas = atom({ plugin: 'progresso', key: 'pendenciasAbertas' } as const, false)
const oculto = atom({ plugin: 'progresso', key: 'oculto' } as const, false)
/** O agente aberto no painel e a cauda da conversa dele; agente null mostra a visão geral. */
const painel = atom({ plugin: 'progresso', key: 'painel' } as const, { agente: null, titulo: '', falas: [], aviso: '' })
const JANELA_INICIAL = { aberto: false, concluidos: true, recolhido: false, passosAbertos: false }
const janela = atom({ plugin: 'progresso', key: 'janela' } as const, JANELA_INICIAL)
const turno = atom({ plugin: 'progresso', key: 'turno' } as const, '')
const sessao = atom({ plugin: 'progresso', key: 'sessao' } as const, '')

const SONS = {
  decisao: 'sounds/decisao.wav',
  erro: 'sounds/erro.wav',
  concluido: 'sounds/concluido.wav',
} as const

const REGRA = `# Lista de execução
Tarefa com 2+ ações usa \`${FERRAMENTA}\` como lista de execução: crie uma vez com o plano inteiro e atualize a cada mudança (proximo, feitos, ativo, falhou). Antes de encerrar o turno, feche a barra ("concluido", "esperando" só se depende do usuário, "aguardando" se espera subagente ou background, ou falhou) e registre em \`pendencias\` o que ficou para depois (usuário, terceiro, outro turno); feito, \`resolver\`. Em \`anotacoes\`, o que o usuário buscaria depois (URL, ID, recurso, decisão) ou mandar salvar; nunca segredo. Não liste no chat; subagente não chama.`

const DESCRICAO = `Lista de execução que o usuário vê acima do prompt.
Criar: {id, titulo, etapas:[{nome, passos:["..."]}]} ou {id, titulo, passos:["..."]}.
Atualizar com o mesmo id: {proximo:true} conclui o passo ativo e inicia o seguinte; {feitos:["..."], ativo:"..."} marca passos pelo título (aproximado) ou pelo número, a partir de 1; {falhou:"passo", nota:"motivo"}; {estado:"esperando"|"aguardando"|"concluido"|"erro"|"andamento", nota}.
"esperando" é só quando depende do usuário (resposta, aprovação, material). "aguardando" é quando espera um subagente ou um comando em background: não toca som, o Stop não cobra e volta sozinha a andamento quando nada mais roda.
Feche antes de encerrar o turno: {proximo:true, estado:"concluido"}; "esperando" quando depende do usuário; "aguardando" quando o turno acaba com agente ou background rodando. Passos abertos numa barra concluída viram pulados.
Reenviar etapas reescreve o plano e preserva os passos já feitos. Só a conversa principal usa; subagente não chama.
Pendências (sem id, ou junto de uma atualização): o que ficou para depois e não é passo ativo do turno. Registre antes de encerrar, no turno em que surgiu, tudo que depende do usuário (material, aprovação, teste), de terceiro (Meta, CI, outro time) ou de um turno seguinte. Ficam numa faixa fixa acima do prompt, entre turnos, até serem resolvidas, e não seguram o fim do turno: não repita a lista no chat. Adicionar: {pendencias:[{titulo, icone?, quem?}]}, quem livre ("você", "seu ok", "Claude", "Meta"), icone um de: ${ICONES_PENDENCIA.join(', ')} (sem ele, sai do título). Resolver ao concluir: {resolver:["título aproximado" ou "2"]}; resolvida some da faixa. Listar: {listar:true}.
Anotações (sem id, ou junto de uma atualização): o que o usuário precisaria procurar depois, como URL publicada, ID, nome de recurso criado ou decisão fechada, e tudo que ele mandar salvar. Nunca senha, token ou segredo. Ficam no painel Anotações da conversa, sobrevivem ao /resume; não repita no chat. Adicionar: {anotacoes:[{titulo, valor, grupo?}]}, grupo livre ("Curso · páginas"); título repetido atualiza o item. Apagar: {esquecer:["título aproximado" ou "2"]}. Listar: {listarAnotacoes:true}.`

const ESQUEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Identificador curto da barra, o mesmo em toda atualização.' },
    titulo: { type: 'string' },
    etapas: {
      type: 'array',
      items: {
        type: 'object',
        properties: { nome: { type: 'string' }, passos: { type: 'array', items: { type: 'string' } } },
        required: ['nome', 'passos'],
      },
    },
    passos: { type: 'array', items: { type: 'string' } },
    proximo: { type: 'boolean' },
    feitos: { type: 'array', items: { type: 'string' } },
    ativo: { type: 'string' },
    falhou: { type: 'string' },
    estado: {
      type: 'string',
      enum: ['andamento', 'esperando', 'aguardando', 'erro', 'concluido'],
      description: 'esperando: depende do usuário. aguardando: espera subagente ou comando em background.',
    },
    nota: { type: 'string' },
    pendencias: {
      type: 'array',
      description: 'Pendências a adicionar: o que ficou para depois, fora dos passos do turno.',
      items: {
        type: 'object',
        properties: {
          titulo: { type: 'string' },
          icone: { type: 'string', description: `Nome do ícone: ${ICONES_PENDENCIA.join(', ')}. Sem ele, sai do título.` },
          quem: { type: 'string', description: 'De quem depende: "você", "seu ok", "Claude"...' },
        },
        required: ['titulo'],
      },
    },
    resolver: { type: 'array', items: { type: 'string' }, description: 'Pendências resolvidas, pelo título (aproximado) ou número.' },
    listar: { type: 'boolean', description: 'Devolve a lista de pendências.' },
    anotacoes: {
      type: 'array',
      description: 'Anotações a guardar: URL publicada, ID, recurso criado, decisão fechada. Título repetido atualiza.',
      items: {
        type: 'object',
        properties: {
          titulo: { type: 'string' },
          valor: { type: 'string', description: 'Texto livre; URL vira link no painel. Nunca senha ou segredo.' },
          grupo: { type: 'string', description: 'Agrupa no painel, ex.: "Curso · páginas".' },
        },
        required: ['titulo', 'valor'],
      },
    },
    esquecer: { type: 'array', items: { type: 'string' }, description: 'Anotações a apagar, pelo título (aproximado) ou número.' },
    listarAnotacoes: { type: 'boolean', description: 'Devolve a lista de anotações.' },
  },
}

// No terminal a cor vem da chave do tema, que acompanha claro e escuro; no desktop, das cores do desenho (svg.ts).
const COR_TERMINAL: Record<Tom, string | undefined> = {
  andamento: 'permission',
  esperando: 'warning',
  aguardando: 'suggestion',
  erro: 'error',
  concluido: 'success',
  parada: 'inactive',
  neutro: undefined,
}
const ICONE: Record<Tom, string> = { andamento: '✻', esperando: '◆', aguardando: '◷', erro: '✕', concluido: '✓', parada: '■', neutro: '○' }
const QUEM = { agente: 'agente', entrada: 'recebido', voce: 'você' } as const
const FIM_DO_TURNO = { answer: 'concluida', aborted: 'parada', refusal: 'falhou', error: 'falhou' } as const
const FIM_DA_TAREFA: Record<string, Faixa['estado']> = { completed: 'concluida', failed: 'falhou', killed: 'parada', stopped: 'parada' }

type Som = keyof typeof SONS
/** O que o painel de anotações recolheu na conversa: os grupos, pelo nome, e a seção de pendências. */
type Recolhidos = { grupos: string[]; pendencias: boolean }
/** As notas livres da conversa: o texto do usuário, a altura escolhida do campo e se a seção está recolhida. */
type NotasLivres = { texto: string; altura: number; recolhida: boolean }
type Sessoes = Record<
  string,
  {
    em: number
    barras: Partial<Barra>[]
    faixas?: Partial<Faixa>[]
    pendencias?: Partial<Pendencia>[]
    anotacoes?: Partial<Anotacao>[]
    recolhidos?: Partial<Recolhidos>
    notasLivres?: Partial<NotasLivres>
  }
>

let ultimoSom = 0
let gravacao: Promise<void> = Promise.resolve()
/**
 * O texto das notas livres da sessão, fora de átomo: o onInput de cada tecla grava aqui e no store sem redesenhar o
 * painel. Um redesenho manda `value` ao campo, e um `value` atrasado em relação ao que o usuário já digitou trocaria o
 * texto e o cursor. O painel só redesenha quando o número de linhas muda (o campo cresce), e aí lê o texto daqui.
 * null: ainda não lido do store nesta sessão (processo novo, reload a quente ou outra conversa).
 */
let textoLivre: string | null = null
/** Uma gravação das notas em voo; `notasSujas` pede mais uma ao fim dela, com o texto mais novo. */
let notasEmVoo = false
let notasSujas = false
let demo: Timer[] = []
let assentaEm = 0
// O relógio de 1 s da banda e do painel: nasce no primeiro evento que precisa dele, também depois de um reload.
let tique: Timer | null = null
// O nome que espera o atual completar TROCA_MS na faixa, por agente.
const proximaFerramenta = new Map<string, string>()
// Agentes cujo turno fechou: um evento atrasado não reabre a faixa.
const encerrados = new Set<string>()
// O turno em que cada barra já recebeu o pedido do Stop: um por barra por turno.
const bloqueadas = new Map<string, string>()
// O turno em que a conversa principal mandou \`pendencias\`, e o último em que o Stop lembrou de registrá-las: um por turno.
let pendenciasNoTurno = ''
let lembrado = ''
// O que o último Stop da conversa principal contou em background, no turno dele.
let fundoNoStop = { turno: '', n: -1 }

const demonstracao = (id: string) => id.startsWith('demo-')

// Modelo e esforço de cada tipo de agente: a tabela de PERFIS, trocada pelo frontmatter de ~/.claude/agents quando ele
// é lido no session.start. Os tipos sem arquivo (general-purpose, Explore, Plan) também nomeiam passos planejados.
let perfis: Record<string, Perfil> = { ...PERFIS }
const TIPOS_SEM_ARQUIVO = ['general-purpose', 'Explore', 'Plan']

async function lerPerfis($: EngineInterface) {
  const casa = await $.env.get('HOME').catch(() => undefined)
  if (!casa) return
  const pasta = `${casa}/.claude/agents`
  const lidos: Record<string, Perfil> = {}
  for (const item of await $.fs.list(pasta).catch(() => [])) {
    if (item.kind !== 'file' || !item.name.endsWith('.md')) continue
    const achado = perfilDoArquivo(await $.fs.read(`${pasta}/${item.name}`).catch(() => ''))
    if (achado) lidos[achado.nome] = achado.perfil
  }
  perfis = { ...PERFIS, ...lidos }
}

const perfilDe = (tipo: string): Perfil | undefined => perfis[tipo.replace(/^.*:/, '')]

/** Os passos abertos da barra cujo título termina com o tipo do agente que vai fazê-lo. */
function planejadosDe(barra: Barra | undefined) {
  if (!barra) return []
  const tipos = [...Object.keys(perfis), ...TIPOS_SEM_ARQUIVO]

  return barra.passos.flatMap((passo, i) => {
    if (passo.estado !== 'aberto') return []
    const achado = tipoDoPasso(passo.titulo, tipos)
    return achado ? [{ numero: i + 1, titulo: achado.titulo, tipo: achado.tipo }] : []
  })
}

/** Um toast sempre; o som, no máximo um a cada SILENCIO_MS, nunca ao concluir e nunca dentro do OpenBot. */
async function avisar($: EngineInterface, som: Som, texto: string | null) {
  if (texto) $.ui.toast(texto)
  if (som === 'concluido') return
  const cliente = await $.env.get('CLAUDE_AGENT_SDK_CLIENT_APP').catch(() => undefined)
  if (cliente?.startsWith('openbot')) return
  const agora = await $.clock.now()
  if (agora - ultimoSom < SILENCIO_MS) return
  ultimoSom = agora
  void $.audio.play({ asset: SONS[som] }, { gain: 0.7 }).catch(() => {})
}

/** Pede um desenho novo quando o deslize da trilha termina: a fonte que fica na tela não leva mais a animação. */
function assentar($: EngineInterface, agora: number) {
  if (agora < assentaEm) return
  assentaEm = agora + DESLIZE_MS
  $.clock.after(DESLIZE_MS, () => void $.ui.invalidate('ui.render'))
}

/** Redesenha a cada segundo enquanto houver faixa viva, ou o painel aberto com tarefa em curso. Idempotente. */
function garantirRelogio($: EngineInterface) {
  if (tique) return
  tique = $.clock.every(1000, async () => {
    const lista = await read($, faixas)
    const agora = await $.clock.now()
    if (relogioPreciso(lista, agora)) return $.ui.invalidate('ui.render')
    if ((await read($, janela)).aberto && (await read($, barras)).some(barra => !finalizada(barra))) {
      return $.ui.invalidate('ui.render')
    }
  })
}

/** Grava as barras e faixas desta sessão no store, uma gravação por vez; as do demo ficam fora. */
function guardar($: EngineInterface) {
  gravacao = gravacao
    .then(async () => {
      const id = await $.session.id()
      const lista = (await read($, barras)).filter(barra => !demonstracao(barra.id))
      const vivas = (await read($, faixas)).filter(faixa => !demonstracao(faixa.id))
      const abertas = await read($, pendencias)
      const notas = await read($, anotacoes)
      const { recolhidos, pendenciasRecolhidas, notasAltura, notasRecolhidas } = await read($, janelaAnotacoes)
      const sessoes = { ...(((await $.store.get('sessoes')) ?? {}) as Sessoes) }
      // Texto ainda não lido nesta sessão: fica o que o store tem.
      const livre = textoLivre ?? sessoes[id]?.notasLivres?.texto ?? ''
      const comNotasLivres = livre !== '' || notasAltura !== NOTAS_INICIAL || notasRecolhidas
      if (lista.length > 0 || vivas.length > 0 || abertas.length > 0 || notas.length > 0 || comNotasLivres) {
        sessoes[id] = {
          em: await $.clock.now(),
          barras: lista,
          faixas: vivas,
          pendencias: abertas,
          anotacoes: notas,
          ...(recolhidos.length > 0 || pendenciasRecolhidas ? { recolhidos: { grupos: recolhidos, pendencias: pendenciasRecolhidas } } : {}),
          ...(comNotasLivres ? { notasLivres: { texto: livre, altura: notasAltura, recolhida: notasRecolhidas } } : {}),
        }
      }
      else delete sessoes[id]
      const recentes = Object.entries(sessoes)
        .sort((a, b) => b[1].em - a[1].em)
        .slice(0, MAX_SESSOES)
      await $.store.set('sessoes', Object.fromEntries(recentes))
    })
    .catch(() => {})

  return gravacao
}

/**
 * O estado é de outra sessão (ou de nenhuma): processo novo, /resume ou /clear. Com barras e faixas em memória
 * (reload a quente de uma versão que não marcava a sessão) elas ficam, completadas; com a memória vazia, o store
 * devolve as da sessão, e o que estava aberto parou com o processo anterior.
 */
async function restaurarSessao($: EngineInterface) {
  const id = await $.session.id()
  if ((await read($, sessao)) === id) return
  await update($, sessao, () => id)
  const agora = await $.clock.now()
  const emMemoria =
    (await read($, barras)).length > 0 || (await read($, faixas)).length > 0 || (await read($, pendencias)).length > 0 || (await read($, anotacoes)).length > 0
  if (emMemoria) {
    await update($, barras, lista => lista.map(barra => comoBarra(barra, agora)))
    await update($, faixas, lista => lista.map(faixa => comoFaixa(faixa, agora)))
    return
  }
  const salvas = ((await $.store.get('sessoes')) as Sessoes | undefined)?.[id]
  if (!salvas) return
  const volta = restaurada(salvas.barras ?? [], salvas.faixas ?? [], agora)
  await update($, barras, () => volta.barras)
  await update($, faixas, () => volta.faixas)
  // Pendência não para com o processo: volta como estava.
  const guardadas = (salvas.pendencias ?? []).flatMap(item => comoPendencia(item, agora) ?? [])
  if (guardadas.length > 0) await update($, pendencias, () => guardadas)
  const notas = (salvas.anotacoes ?? []).flatMap(item => comoAnotacao(item, agora) ?? [])
  if (notas.length > 0) await update($, anotacoes, () => notas)
  const grupos = (salvas.recolhidos?.grupos ?? []).filter((grupo): grupo is string => typeof grupo === 'string')
  const pendenciasRecolhidas = salvas.recolhidos?.pendencias === true
  if (grupos.length > 0 || pendenciasRecolhidas) await update($, janelaAnotacoes, atual => ({ ...atual, recolhidos: grupos, pendenciasRecolhidas }))
  const livres = salvas.notasLivres
  if (livres) {
    textoLivre = typeof livres.texto === 'string' ? livres.texto : ''
    const altura = typeof livres.altura === 'number' ? alturaDasNotas(Math.round(livres.altura), 0) : NOTAS_INICIAL
    await update($, janelaAnotacoes, atual => ({ ...atual, notasAltura: altura, notasRecolhidas: livres.recolhida === true, notasLinhas: linhasDe(textoLivre ?? '') }))
  }
}

/** O texto das notas livres da sessão: o da memória ou, na primeira leitura, o do store. */
async function lerNotasLivres($: EngineInterface) {
  if (textoLivre !== null) return textoLivre
  const id = await $.session.id()
  const salvo = ((await $.store.get('sessoes')) as Sessoes | undefined)?.[id]?.notasLivres?.texto
  textoLivre = typeof salvo === 'string' ? salvo : ''

  return textoLivre
}

/** Grava as notas livres: uma gravação por vez, e a última tecla sempre entra numa gravação depois dela. */
async function guardarNotas($: EngineInterface) {
  if (notasEmVoo) return void (notasSujas = true)
  notasEmVoo = true
  try {
    do {
      notasSujas = false
      await guardar($)
    } while (notasSujas)
  } finally {
    notasEmVoo = false
  }
}

/** Cada mudança do texto: memória e store, sem redesenho; redesenha só quando o número de linhas muda (o campo cresce). */
async function mudarNotasLivres($: EngineInterface, texto: string) {
  textoLivre = texto
  const linhas = linhasDe(texto)
  if ((await read($, janelaAnotacoes)).notasLinhas !== linhas) await update($, janelaAnotacoes, atual => ({ ...atual, notasLinhas: linhas }))
  await guardarNotas($)
}

/** O texto do aviso quando a chamada abre um cartão do app que espera o usuário; null quando não espera. */
function cartaoDeDecisao(ferramenta: string, entrada: Record<string, unknown>): string | null {
  const texto = (valor: unknown) => (typeof valor === 'string' && valor.trim() ? valor.trim() : null)
  switch (ferramenta) {
    case 'mcp__ccd_turn__wrap_up':
      return texto(entrada.ask)
    case 'ExitPlanMode':
      return 'aprovar o plano'
    case 'mcp__ccd_session__start_session':
      return entrada.initiation === 'offer' ? `nova sessão ou aqui? ${texto(entrada.title) ?? ''}`.trim() : null
    case 'mcp__ccd_directory__propose_branch':
      return 'confirmar o branch'
    case 'mcp__ccd_directory__request_directory':
      return 'escolher a pasta'
    default:
      return null
  }
}

function avisarEstado($: EngineInterface, barra: Barra, virou: Estado | null) {
  if (virou === 'esperando') {
    void avisar($, 'decisao', `Esperando você: ${[barra.titulo, barra.nota].filter(Boolean).join(' · ')}`)
  }
  if (virou === 'erro') void avisar($, 'erro', `Erro: ${[barra.titulo, barra.nota].filter(Boolean).join(' · ')}`)
  if (virou === 'concluido') {
    const tempo = duracao((barra.fechadaEm ?? barra.criadaEm) - barra.criadaEm)
    void avisar($, 'concluido', `Concluído: ${barra.titulo} em ${tempo}`)
  }
}

/** Uma chamada da ferramenta, do modelo ou do demo: aplica, pendura as faixas órfãs do turno, avisa e grava. */
async function atualizar($: EngineInterface, entrada: Record<string, unknown>, dono: string | null): Promise<Resposta> {
  const agora = await $.clock.now()
  const atual = await read($, turno)
  // A resposta sai de dentro do update numa propriedade: uma variável atribuída na closure ficaria estreitada no
  // valor inicial, e o TypeScript daria o ramo de sucesso como impossível.
  const saida: { resposta: Resposta } = { resposta: { negar: 'Sem resposta.' } }
  await update($, barras, lista => {
    saida.resposta = aplicar(lista, entrada, agora, dono, atual)
    return 'negar' in saida.resposta ? lista : saida.resposta.barras
  })
  const { resposta } = saida
  if (!('negar' in resposta)) {
    const { barra } = resposta
    if ((await read($, faixas)).some(faixa => faixa.barra === null && faixa.fim === null)) {
      await update($, faixas, lista => adotar(lista, barra))
    }
    avisarEstado($, barra, resposta.virou)
    void guardar($)
  }

  return resposta
}

/** Até MAX_FAIXAS: saem primeiro as terminadas mais velhas. */
function limitar(lista: Faixa[]) {
  const saida = [...lista]
  while (saida.length > MAX_FAIXAS) {
    const velha = saida.findIndex(faixa => faixa.fim !== null)
    saida.splice(velha === -1 ? 0 : velha, 1)
  }
  return saida
}

type FaixaNova = Pick<Faixa, 'id' | 'tipo' | 'titulo'> & Partial<Faixa>

/**
 * Abre a faixa e escolhe a barra dela: a do pedido (demo); a do agente pai, se ele roda pendurado numa; senão a
 * barra aberta do mesmo dono mudada neste turno; sem ela, o grupo automático.
 */
async function abrirFaixa($: EngineInterface, nova: FaixaNova) {
  garantirRelogio($)
  const agora = await $.clock.now()
  const atual = await read($, turno)
  const dono = nova.dono ?? null
  let barra = nova.barra ?? null
  if (barra === null && dono !== null) {
    barra = (await read($, faixas)).find(faixa => faixa.id === dono && faixa.fim === null)?.barra ?? null
  }
  if (barra === null) barra = barraParaFaixa(await read($, barras), dono, atual)
  const faixa = comoFaixa({ turno: atual, ...nova, barra, dono, inicio: agora, trocaEm: agora }, agora)
  await update($, faixas, lista => limitar([...lista.filter(outra => outra.id !== faixa.id), faixa]))
  if (!demonstracao(faixa.id)) void guardar($)
}

/**
 * Agente retomado, ou criado antes de o mod carregar, não passa por agent.spawn: a faixa nasce no primeiro evento
 * dele. Só para quem $.agent.list() conhece; fork de compactação e agente de workflow ficam sem faixa.
 */
async function garantirFaixa($: EngineInterface, id: string, retomada: boolean) {
  if (encerrados.has(id) && !retomada) return
  const existente = (await read($, faixas)).find(faixa => faixa.id === id)
  if (existente?.fim === null) return
  const agente = (await $.agent.list().catch(() => [])).find(item => item.id === id)
  if (!agente) return
  encerrados.delete(id)
  // Na retomada a faixa volta com o que já gastou.
  const gasto = existente ? { tokens: existente.tokens, usd: existente.usd, ctx: existente.ctx, janela: existente.janela, modeloId: existente.modeloId } : {}
  await abrirFaixa($, {
    ...gasto,
    id,
    tipo: 'agente',
    titulo: cortar(agente.description || agente.type || 'Agente', 60),
    tipoAgente: agente.type,
    dono: agente.parentId ?? null,
  })
}

/** Muda uma faixa ativa (ou, com `qualquer`, também uma terminada); sem ela não escreve nada. */
async function mudarFaixa($: EngineInterface, id: string, mudar: (faixa: Faixa) => Faixa, qualquer = false) {
  const casa = (faixa: Faixa) => faixa.id === id && (qualquer || faixa.fim === null)
  if (!(await read($, faixas)).some(casa)) return
  await update($, faixas, lista => lista.map(faixa => (casa(faixa) ? mudar(faixa) : faixa)))
}

/**
 * Mostra a ferramenta que o agente chamou. O nome atual fica TROCA_MS na faixa; o que chega antes disso espera e,
 * vencido o prazo, entra só o último pedido.
 */
async function mostrarFerramenta($: EngineInterface, agente: string, nome: string, chamada: string) {
  const agora = await $.clock.now()
  const faixa = (await read($, faixas)).find(item => item.id === agente && item.fim === null)
  if (!faixa) return
  // Faixa de antes de um reload não tem trocaEm: a conta dá NaN e a troca passa.
  const cedo = faixa.ferramenta !== '' && faixa.ferramenta !== nome && agora - faixa.trocaEm < TROCA_MS
  if (cedo) {
    const espera = proximaFerramenta.has(agente)
    proximaFerramenta.set(agente, nome)
    if (!espera) {
      $.clock.after(faixa.trocaEm + TROCA_MS - agora, async () => {
        const proxima = proximaFerramenta.get(agente)
        proximaFerramenta.delete(agente)
        if (proxima === undefined) return
        const quando = await $.clock.now()
        await mudarFaixa($, agente, atual => (atual.ferramenta === proxima ? atual : { ...atual, ferramenta: proxima, trocaEm: quando }))
      })
    }
  } else proximaFerramenta.delete(agente)

  await mudarFaixa($, agente, atual => ({
    ...atual,
    ...(cedo || atual.ferramenta === nome ? {} : { ferramenta: nome, trocaEm: agora }),
    chamada,
    aprovacao: false,
  }))
}

/** Um passo do agente respondido: contexto, tokens e custo dele. */
async function registrarPasso($: EngineInterface, agente: string, uso: TurnUsage) {
  const ctx = contextoDe(uso)
  const usd = custoDe(uso.model, uso)
  await mudarFaixa($, agente, faixa => ({
    ...faixa,
    ctx,
    tokens: ctx + uso.output_tokens,
    usd: somarUsd(faixa.usd, usd),
    janela: janelaDe(uso.model) || faixa.janela,
    modeloId: uso.model,
    passosTurno: faixa.passosTurno + 1,
  }))
}

/** Fim do turno do agente: o total do turno conta só quando nenhum passo foi visto (o mod carregou no meio). */
async function registrarTurno($: EngineInterface, agente: string, uso: TurnUsage | undefined) {
  await mudarFaixa($, agente, faixa => {
    if (faixa.passosTurno > 0 || !uso) return { ...faixa, passosTurno: 0 }
    return {
      ...faixa,
      passosTurno: 0,
      usd: somarUsd(faixa.usd, custoDe(uso.model, uso)),
      tokens: faixa.tokens || contextoDe(uso) + uso.output_tokens,
      janela: janelaDe(uso.model) || faixa.janela,
      modeloId: uso.model,
    }
  })
}

/** Fecha as faixas ativas que casam e avisa: erro na falha, concluído quando o último comando termina. */
async function fecharFaixas($: EngineInterface, casa: (faixa: Faixa) => boolean, estado: Faixa['estado']) {
  const agora = await $.clock.now()
  const alvos = (await read($, faixas)).filter(faixa => faixa.fim === null && casa(faixa))
  if (alvos.length === 0) return
  const ids = new Set(alvos.map(faixa => faixa.id))
  const lista = await update($, faixas, atual =>
    atual.map(faixa =>
      ids.has(faixa.id) && faixa.fim === null
        ? { ...faixa, estado, fim: agora, ferramenta: '', aprovacao: false }
        : faixa,
    ),
  )
  for (const faixa of alvos) {
    if (estado === 'falhou') void avisar($, 'erro', `Falhou: ${faixa.titulo}`)
  }
  // Nada mais roda (fora o demo): a barra que aguardava agente ou background volta a andamento.
  if (!lista.some(faixa => faixa.fim === null && !demonstracao(faixa.id))) {
    const antes = await read($, barras)
    const depois = retomarAguardando(antes, agora)
    if (depois !== antes) {
      await update($, barras, atual => retomarAguardando(atual, agora))
      void guardar($)
    }
  }
  const comando = alvos.find(faixa => faixa.tipo === 'comando')
  const restam = lista.some(faixa => faixa.tipo === 'comando' && faixa.fim === null)
  if (comando && estado === 'concluida' && !restam) {
    void avisar($, 'concluido', `Background concluído: ${comando.titulo} em ${duracao(agora - comando.inicio)}`)
  }
  if (alvos.some(faixa => !demonstracao(faixa.id))) void guardar($)
}

async function limpar($: EngineInterface) {
  for (const timer of demo) timer.cancel()
  demo = []
  await update($, barras, () => [])
  await update($, faixas, () => [])
  await guardar($)
}

/** Tira só o que a demonstração criou; as barras de trabalho real ficam. */
async function limparDemo($: EngineInterface) {
  for (const timer of demo) timer.cancel()
  demo = []
  await update($, barras, lista => lista.filter(barra => !demonstracao(barra.id)))
  await update($, faixas, lista => lista.filter(faixa => !demonstracao(faixa.id)))
  await guardar($)
}

/**
 * Trinta segundos com todos os estados, pelas mesmas funções que os eventos reais usam, e o painel aberto: quatro
 * barras (andamento, esperando com nota, erro e concluída), agentes rodando de três tipos, um concluído, um que
 * falha, um planejado (o passo "(executor-pesado)" aberto) e um comando em background.
 */
async function rodarDemo($: EngineInterface) {
  await limparDemo($)
  await update($, oculto, () => false)
  const A = 'demo-pagina'
  const B = 'demo-leads'
  const C = 'demo-email'
  const D = 'demo-notas'
  const agente = (id: string, titulo: string, tipoAgente: string, modelo: string, esforco: string, ferramenta: string) =>
    abrirFaixa($, { id, tipo: 'agente', titulo, modelo, esforco, ferramenta, barra: A, tipoAgente })
  const build = comandoLegivel('cd ~/projetos/app && npm run build -- --filter vendas')
  const roteiro: [number, () => Promise<unknown>][] = [
    [0, () => abrirPainelProgresso($).catch(() => {})],
    [0, () =>
      atualizar($, {
        id: A,
        titulo: 'Publicar página de vendas',
        etapas: [
          { nome: 'Preparar', passos: ['Ler o briefing', 'Pesquisar concorrentes (investigador)'] },
          { nome: 'Construir', passos: ['Redigir o hero (executor-design)', 'Conferir a oferta (executor-leve)', 'Ler a planilha de preços (leitor)'] },
          { nome: 'Verificar', passos: ['Testar no celular', 'Revisar tudo (executor-pesado)'] },
        ],
      }, null)],
    [200, () => atualizar($, { id: B, titulo: 'Importar leads de setembro', passos: ['Baixar a planilha', 'Limpar duplicados', 'Subir no CRM'] }, null)],
    [400, () => atualizar($, { id: C, titulo: 'Revisar o e-mail de lançamento', passos: ['Ler o rascunho', 'Escolher o assunto', 'Agendar o envio'] }, null)],
    [600, () => atualizar($, { id: D, titulo: 'Atualizar notas de versão', passos: ['Ler o diff', 'Escrever', 'Revisar'] }, null)],
    [1000, () => atualizar($, { id: A, proximo: true }, null)],
    [1200, () => agente('demo-pesquisa', 'Pesquisar concorrentes', 'investigador', 'opus 5.5', 'alto', 'WebSearch')],
    [1800, () => agente('demo-hero', 'Redigir o hero', 'executor-design', 'sonnet 5.5', 'médio', 'Read')],
    [2200, () => abrirFaixa($, { id: 'demo-build', tipo: 'comando', titulo: build.titulo, pasta: build.pasta, barra: B })],
    [2400, () => agente('demo-oferta', 'Conferir a oferta', 'executor-leve', 'haiku 4.5', 'baixo', 'Grep')],
    [2800, () => agente('demo-precos', 'Ler a planilha de preços', 'leitor', 'sonnet 5.5', 'médio', 'Read')],
    [3000, () => atualizar($, { id: B, proximo: true }, null)],
    [3200, () => atualizar($, { id: C, proximo: true }, null)],
    [3400, () => atualizar($, { id: D, proximo: true }, null)],
    [3800, () => mudarFaixa($, 'demo-hero', faixa => ({ ...faixa, ferramenta: 'Edit' }))],
    [4200, () => atualizar($, { id: D, proximo: true }, null)],
    [4600, () => atualizar($, { id: C, estado: 'esperando', nota: 'Qual assunto vai no e-mail?' }, null)],
    [5400, () => mudarFaixa($, 'demo-oferta', faixa => ({ ...faixa, ferramenta: 'Bash', aprovacao: true }))],
    [5800, () => atualizar($, { id: D, estado: 'concluido', proximo: true }, null)],
    [7000, () => atualizar($, { id: B, falhou: 'Limpar duplicados', nota: 'CRM recusou 12 linhas' }, null)],
    [7400, () => mudarFaixa($, 'demo-oferta', faixa => ({ ...faixa, aprovacao: false }))],
    [8000, () => atualizar($, { id: A, proximo: true }, null)],
    [9000, () => fecharFaixas($, faixa => faixa.id === 'demo-pesquisa', 'concluida')],
    [11000, () => fecharFaixas($, faixa => faixa.id === 'demo-precos', 'falhou')],
    [13000, () => fecharFaixas($, faixa => faixa.id === 'demo-oferta', 'concluida')],
    [14000, () => atualizar($, { id: A, proximo: true }, null)],
    [17000, () => fecharFaixas($, faixa => faixa.id === 'demo-build', 'concluida')],
    [19000, () => fecharFaixas($, faixa => faixa.id === 'demo-hero', 'concluida')],
    [19500, () => atualizar($, { id: A, proximo: true }, null)],
    [23000, () => atualizar($, { id: A, proximo: true }, null)],
    [27000, () => atualizar($, { id: A, estado: 'concluido', proximo: true }, null)],
    [30000, () => limparDemo($)],
  ]
  demo = roteiro.map(([ms, passo]) => $.clock.after(ms, () => void passo()))
}

/**
 * O command de uma tarefa em background é o mesmo da faixa? Espaços normalizados; o host corta o campo em 1000
 * caracteres com o marcador "... [+N chars]", então vale o começo comum.
 */
function mesmoComando(daTarefa: string | undefined, daFaixa: string | undefined) {
  if (!daTarefa || !daFaixa) return false
  const MARCADOR = /\.\.\. \[\+\d+ chars\]$/
  const norma = (s: string) => s.replace(MARCADOR, '').replace(/\s+/g, ' ').trim()
  const a = norma(daTarefa)
  const b = norma(daFaixa)
  if (!a || !b) return false

  // O host corta o command em 1000 caracteres e marca o corte: só aí o começo basta.
  return MARCADOR.test(daTarefa.trim()) ? b.startsWith(a) : a === b
}

/** Um painel só, "Progresso": a visão geral ou, com um agente aberto, a conversa dele. */
const PAINEL = 'progresso'
const TITULO_DO_PAINEL = 'Progresso'
const SEM_AGENTE = { agente: null, titulo: '', falas: [], aviso: '' }

// O agente aberto, espelhado fora do estado para o hook de session.append não ler o estado a cada linha da sessão;
// undefined depois de um reload a quente, até a primeira leitura.
let aberto: string | null | undefined
// O que o usuário mandou, com o prefixo do envio, e ainda não voltou como linha da conversa do agente: a linha que
// traz esse texto não repete.
let enviadas: string[] = []
const PREFIXO_DO_ENVIO = 'Mensagem do usuário, pelo painel do agente: '

const acrescentar = ($: EngineInterface, agente: string, novas: Fala[]) =>
  update($, painel, atual => (atual.agente === agente ? { ...atual, falas: [...atual.falas, ...novas].slice(-MAX_FALAS) } : atual))

const irAoFim = ($: EngineInterface) => void $.ui.scroll({ in: PAINEL, to: 'end' }).catch(() => {})

/** O painel pedido pelo usuário (comando ou botão): abre na visão geral, sem tomar o teclado. */
async function abrirPainelProgresso($: EngineInterface) {
  garantirRelogio($)
  aberto = null
  enviadas = []
  await update($, painel, () => SEM_AGENTE)
  await update($, janela, atual => ({ ...atual, aberto: true }))
  const lugar = await $.ui.open({ id: PAINEL, title: TITULO_DO_PAINEL, columns: 60 })
  if (!lugar.isPlaced) $.ui.toast(`O painel de progresso abriu sem lugar na tela: ${lugar.reason}`)
}

/** O clique num cartão ou no "abrir" de uma faixa: abre a conversa do agente no painel. */
async function abrirAgente($: EngineInterface, agente: string, titulo: string) {
  aberto = agente
  enviadas = []
  await update($, painel, () => ({ agente, titulo, falas: [], aviso: 'Carregando a conversa.' }))
  await update($, janela, atual => ({ ...atual, aberto: true }))
  const lugar = await $.ui.open({ id: PAINEL, title: TITULO_DO_PAINEL, focus: true, closeOnEscape: true, columns: 60 })
  if (!lugar.isPlaced) $.ui.toast(`O painel do agente abriu sem lugar na tela: ${lugar.reason}`)

  const lida = await $.session.messages({ agentId: agente }).catch((erro: unknown) => ({ deny: String(erro) }))
  await update($, painel, atual =>
    atual.agente !== agente
      ? atual
      : Array.isArray(lida)
        ? { ...atual, falas: falasDaConversa(lida), aviso: '' }
        : { ...atual, aviso: `A sessão não consegue ler a conversa deste agente: ${lida.deny}` },
  )
  irAoFim($)
}

/** Volta da conversa de um agente para a visão geral. */
async function voltar($: EngineInterface) {
  aberto = null
  enviadas = []
  await update($, painel, () => SEM_AGENTE)
}

/** Linha nova de uma conversa da sessão: entra na cauda quando é do agente aberto. */
async function anexarAoPainel($: EngineInterface, agente: string | undefined, mensagem: Parameters<typeof falasDaLinha>[0]) {
  if (aberto === undefined) aberto = (await read($, painel)).agente
  if (agente === undefined || agente !== aberto) return
  const novas = falasDaLinha(mensagem).filter(fala => {
    const eco = fala.quem === 'entrada' ? enviadas.findIndex(texto => fala.texto.includes(texto)) : -1
    if (eco >= 0) enviadas.splice(eco, 1)
    return eco < 0
  })
  if (novas.length === 0) return
  // Sem rolar: quem subiu para ler não é puxado para o fim a cada linha do agente.
  await acrescentar($, agente, novas)
}

/** O Enter no campo do painel: manda o texto ao agente aberto; a recusa vira toast com o motivo. */
async function enviarAoAgente($: EngineInterface, digitado: string) {
  const texto = digitado.trim()
  const { agente } = await read($, painel)
  if (!texto || agente === null) return
  // A mensagem chega ao agente como a de um par, em nome do plugin: o texto diz de quem ela é. Ela entra em
  // `enviadas` antes do envio, porque o eco pode voltar antes de a entrega responder.
  const mensagem = `${PREFIXO_DO_ENVIO}${texto}`
  enviadas = [...enviadas, mensagem].slice(-20)
  const envio = await $.session
    .send({ to: { agentId: agente }, text: mensagem })
    .catch((erro: unknown) => ({ isDelivered: false as const, reason: String(erro) }))
  if (!envio.isDelivered) {
    const posicao = enviadas.lastIndexOf(mensagem)
    if (posicao >= 0) enviadas.splice(posicao, 1)
    return void $.ui.toast(`Mensagem não entregue ao agente: ${envio.reason}`)
  }
  await acrescentar($, agente, [{ quem: 'voce', texto }])
  irAoFim($)
}

/** Painel fechado: a cauda sai da memória e as linhas novas deixam de ser guardadas. */
async function fecharPainel($: EngineInterface) {
  aberto = null
  enviadas = []
  await update($, painel, () => SEM_AGENTE)
  await update($, janela, atual => ({ ...atual, aberto: false }))
}

/** O painel "Anotações": as anotações e as pendências da conversa, aberto pelo botão do barra-uso ou /anotacoes. */
const PAINEL_DAS_ANOTACOES = 'anotacoes'
/** O átomo que o barra-uso escreve a cada clique no botão "Anotações": um contador; cada escrita alterna o painel. */
const PEDIDO_DO_BARRA_USO = { plugin: 'barra-uso', key: 'anotacoes' } as const

async function abrirAnotacoes($: EngineInterface) {
  await update($, janelaAnotacoes, atual => ({ ...atual, aberto: true }))
  const lugar = await $.ui.open({ id: PAINEL_DAS_ANOTACOES, title: 'Anotações', columns: 56 })
  if (!lugar.isPlaced) $.ui.toast(`O painel de anotações abriu sem lugar na tela: ${lugar.reason}`)
}

/** Fechado: some a edição, o menu e o pedido de apagar; o rascunho do formulário novo e o que foi recolhido ficam. */
const anotacoesFechadas = ($: EngineInterface) =>
  update($, janelaAnotacoes, atual => ({ ...atual, aberto: false, editando: null, apagando: null, menu: null, edicao: CAMPOS_VAZIOS }))

async function fecharAnotacoes($: EngineInterface) {
  await $.ui.close({ id: PAINEL_DAS_ANOTACOES }).catch(() => {})
  await anotacoesFechadas($)
}

async function alternarAnotacoes($: EngineInterface) {
  if ((await read($, janelaAnotacoes)).aberto) await fecharAnotacoes($)
  else await abrirAnotacoes($)
}

/** Grava as anotações a partir do painel e guarda no store; o título vazio vira toast. */
async function mudarAnotacoes($: EngineInterface, mudar: (lista: Anotacao[], agora: number) => Anotacao[]) {
  const agora = await $.clock.now()
  await update($, anotacoes, lista => mudar(lista, agora))
  void guardar($)
}

async function adicionarPeloPainel($: EngineInterface, campo?: Campo, valor?: string) {
  const { novo } = await read($, janelaAnotacoes)
  const campos = campo ? { ...novo, [campo]: valor ?? '' } : novo
  const nova = comoAnotacao(campos, await $.clock.now())
  if (!nova) return void $.ui.toast('Dê um título à anotação.')
  await mudarAnotacoes($, lista => gravarAnotacao(lista, nova))
  await update($, janelaAnotacoes, atual => ({ ...atual, novo: CAMPOS_VAZIOS, formulario: false }))
}

/** O recolher do painel muda o que a conversa guarda: grava no store como as anotações. */
async function recolherNoPainel($: EngineInterface, mudar: (atual: JanelaAnotacoes) => Partial<JanelaAnotacoes>) {
  await update($, janelaAnotacoes, atual => ({ ...atual, ...mudar(atual) }))
  void guardar($)
}

const semGrupo = (lista: string[], grupo: string) => lista.filter(outro => outro.trim().toLowerCase() !== grupo.trim().toLowerCase())

async function salvarEdicao($: EngineInterface, campo?: Campo, valor?: string) {
  const { editando, edicao } = await read($, janelaAnotacoes)
  if (editando === null) return
  const campos = campo ? { ...edicao, [campo]: valor ?? '' } : edicao
  if (!campos.titulo.trim()) return void $.ui.toast('Dê um título à anotação.')
  await mudarAnotacoes($, (lista, agora) => editarAnotacao(lista, editando, campos, agora))
  await update($, janelaAnotacoes, atual => ({ ...atual, editando: null, edicao: CAMPOS_VAZIOS }))
}

async function resolverPeloPainel($: EngineInterface, item: Pendencia) {
  await update($, pendencias, lista => lista.filter(outra => outra.titulo !== item.titulo))
  void guardar($)
}

async function copiarAnotacao($: EngineInterface, item: Anotacao, surface: Parameters<EngineInterface['ui']['copy']>[0]['surface']) {
  const copia = await $.ui.copy({ text: item.valor || item.titulo, surface }).catch((erro: unknown) => ({ isCopied: false as const, reason: String(erro) }))
  $.ui.toast(copia.isCopied ? `Copiado: ${item.titulo}` : `Não deu para copiar: ${'reason' in copia ? copia.reason : 'sem motivo'}`)
}

/** Espera o desenho dos mods de baixo até ESPERA_ABAIXO_MS; passado isso, a banda sai sem ele. */
async function desenhoDeBaixo($: EngineInterface, pedido: Promise<RenderElement>) {
  let corte: Timer | undefined
  const limite = new Promise<null>(resolve => {
    corte = $.clock.after(ESPERA_ABAIXO_MS, () => resolve(null))
  })
  const abaixo = await Promise.race([pedido.catch(() => null), limite])
  corte?.cancel()

  return abaixo
}

type ElementosDaFaixa = { Caixa: Elements['terminal']['Box']; Button: Elements['terminal']['Button']; Texto: Elements['terminal']['Text'] }
type ElementosDoDesktop = ElementosDaFaixa & { Svg: Elements['desktop']['Svg'] }

const contagem = (n: number) => `${n} ${n === 1 ? 'pendência' : 'pendências'}`
// O respiro direito do Button plain no app: a pílula de quem depende acaba 1 px antes, onde acaba o glifo da seta.
const RECUO_DA_SETA = 1
// O pino e os ícones dos itens: Svg de 24 com o desenho 7 px para dentro, sob o ícone da pílula do barra-uso; as faixas
// de agente usam a mesma calha (LARGURA_DA_CALHA).
const LARGURA_DO_ICONE = LARGURA_DA_CALHA

/**
 * Um Svg sem `width` dentro de um Box em coluna que cresce: o app desenha a imagem com max-width:100% e, na coluna, a
 * estica até a largura do Box, que vai até o vizinho da direita. Width 0 no Box: a imagem não empurra a linha.
 */
function esticado(Box: Elements['desktop']['Box'], key: string, desenho: RenderElement) {
  return (
    <Box key={key} flexDirection="column" flexGrow={1} width={0}>
      {desenho}
    </Box>
  )
}

/**
 * Desktop: recolhida, uma linha com o pino, a imagem das pílulas (contagem, um item por pílula e o "+N") esticada até
 * a seta (um Button) na borda direita; Svg não recebe clique, então só a seta alterna. Aberta, o cabeçalho volta a ser
 * "N pendências" num Button e há uma linha por item: ícone, título em texto nativo e, logo depois dele, a pílula de quem
 * depende. Nada aqui tem largura em px da banda: as bordas vêm do flex.
 */
function pendenciasNoDesktop($: EngineInterface, els: ElementosDoDesktop, lista: Pendencia[], aberta: boolean, total: number) {
  const { Caixa, Button, Texto, Svg } = els
  const alternar = () => update($, pendenciasAbertas, valor => !valor)
  const recolher = () => update($, pendenciasAbertas, () => false)
  const rotulo = contagem(lista.length)
  // As pílulas decidem quantas cabem na largura estimada sem o pino e a seta (3 colunas e o vão).
  const pilulas = aberta ? null : svgDasPilulas(lista, total - LARGURA_DO_ICONE - Math.ceil(4 * 8.5))
  const quemPx = larguraDoQuem(lista)

  return (
    <Caixa key="pendencias" flexDirection="column">
      <Caixa key="pendencias:topo" flexDirection="row" alignItems="center">
        <Svg key="pendencias:pino" source={svgDoIconeDaPendencia('pino')} alt="pendências" width={LARGURA_DO_ICONE} height={ALT_PENDENCIA} />
        {pilulas ? (
          esticado(Caixa, 'pendencias:corpo', <Svg key="pendencias:pilulas" source={pilulas.source} alt={pilulas.alt} height={ALT_PILULAS} />)
        ) : (
          <Caixa key="pendencias:corpo" flexDirection="row" flexGrow={1} width={0} overflow="hidden">
            {/* Sem label: no desktop o label toma o lugar dos filhos. A key basta para achar o botão. */}
            <Button key="pendencias:abrir" plain onPress={alternar}>
              <Texto bold>{rotulo}</Texto>
            </Button>
          </Caixa>
        )}
        {/* A seta é texto num Button, como o "%" das barras: os dois glifos terminam no mesmo x, com o mesmo respiro
            do botão. ⏷ e ⏶ ficam no meio da linha a 13 px; ▾ some de tão pequeno, ⌄ cai abaixo da linha e ∨ lê
            como a letra v. minWidth: o botão nunca corta o glifo. */}
        <Caixa key="pendencias:fim" minWidth={3} flexShrink={0} justifyContent="flex-end">
          <Button key="pendencias:seta" label={aberta ? '⏶' : '⏷'} plain dimColor hover={{ dimColor: false }} onPress={alternar} />
        </Caixa>
      </Caixa>
      {aberta && <Svg key="pendencias:respiro" source={svgDoRespiro(6)} alt="espaço" height={6} />}
      {aberta &&
        lista.map((item, i) => (
          <Caixa key={`pendencia:${i}`} flexDirection="row" alignItems="center" columnGap={1}>
            <Caixa key={`pendencia:${i}:titulo`} flexDirection="row" alignItems="center" flexShrink={1}>
              <Svg key={`pendencia:${i}:icone`} source={svgDoIconeDaPendencia(item.icone)} alt={`ícone ${item.icone}`} width={LARGURA_DO_ICONE} height={ALT_PENDENCIA} />
              {/* Button plain como o rótulo de cima: o mesmo respiro põe o título no mesmo x de "N pendências". */}
              <Caixa key={`pendencia:${i}:texto`} flexShrink={1} overflow="hidden">
                <Button key={`pendencia:${i}:abrir`} plain onPress={recolher}>
                  <Texto wrap="truncate-end">{item.titulo}</Texto>
                </Button>
              </Caixa>
            </Caixa>
            {quemPx > 0 && (
              <Svg key={`pendencia:${i}:quem`} source={svgDoQuem(item.quem, quemPx, RECUO_DA_SETA)} alt={item.quem ? `depende de ${item.quem}` : 'sem responsável'} width={quemPx + RECUO_DA_SETA} height={ALT_PENDENCIA} />
            )}
          </Caixa>
        ))}
    </Caixa>
  )
}

/** Terminal: "◇ N pendências ▾  prévia" e, aberta, uma linha por item em árvore, com de quem depende numa coluna. */
function pendenciasNoTerminal($: EngineInterface, els: ElementosDaFaixa, lista: Pendencia[], aberta: boolean, colunas: number) {
  const { Caixa, Button, Texto } = els
  const alternar = () => update($, pendenciasAbertas, valor => !valor)
  const rotulo = contagem(lista.length)
  const previa = aberta ? '' : previaDasPendencias(lista.map(item => item.titulo), colunas - rotulo.length - 8, texto => [...texto].length)
  const larguraQuem = Math.max(0, ...lista.map(item => [...item.quem].length))
  const larguraTitulo = Math.max(10, Math.min(Math.max(...lista.map(item => [...item.titulo].length)), colunas - 6 - (larguraQuem ? larguraQuem + 1 : 0)))

  return (
    <Caixa key="pendencias" flexDirection="column">
      <Caixa key="pendencias:topo" flexDirection="row" gap={1}>
        <Texto color="warning">◇</Texto>
        <Button key="pendencias:abrir" label={rotulo} plain onPress={alternar} />
        <Button key="pendencias:seta" label={aberta ? '▴' : '▾'} plain dimColor hover={{ dimColor: false }} onPress={alternar} />
        {!!previa && <Texto dimColor wrap="truncate-end">{previa}</Texto>}
      </Caixa>
      {aberta &&
        lista.map((item, i) => (
          <Caixa key={`pendencia:${i}`} flexDirection="row" gap={1}>
            <Texto dimColor>{i === lista.length - 1 ? '  └' : '  ├'}</Texto>
            <Caixa width={larguraTitulo} flexShrink={1}>
              <Texto wrap="truncate-end">{item.titulo}</Texto>
            </Caixa>
            {!!item.quem && <Texto dimColor>{item.quem}</Texto>}
          </Caixa>
        ))}
    </Caixa>
  )
}

/** Uma árvore que não desenha nada: Box sem filhos, ou Text vazio. */
function semConteudo(no: RenderElement | null | undefined): boolean {
  if (!no) return true
  const filhos: unknown[] = (no as { children?: unknown[] }).children ?? []
  const lista = filhos.flat(Infinity).filter(filho => filho !== null && filho !== undefined && filho !== false && filho !== '')
  if (no.type === 'Box') return lista.every(filho => typeof filho === 'object' && semConteudo(filho as RenderElement))
  if (no.type === 'Text') return lista.length === 0

  return false
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({ name: 'progresso', description: DESCRICAO, inputSchema: ESQUEMA })
    await $.command.register({
      name: 'progresso',
      description: 'Mostra ou esconde as barras de progresso (on, off ou, sem nada, alterna); painel abre o painel lateral',
      argumentHint: '[on | off | painel]',
      immediate: true,
    })
    await $.command.register({ name: 'progresso-demo', description: 'Demonstração de 30 s com todos os estados das barras, faixas, painel e sons', immediate: true })
    await $.command.register({ name: 'progresso-limpar', description: 'Remove todas as barras e faixas', immediate: true })
    await $.command.register({ name: 'anotacoes', description: 'Abre ou fecha o painel de anotações e pendências da conversa', immediate: true })

    // O `/progresso off` vale para as sessões seguintes até um `/progresso on`.
    const guardado = (await $.store.get('oculto')) === true
    await update($, oculto, () => guardado)
    // Um reload a quente mantém o estado (a sessão confere); processo novo e sessão retomada buscam no store.
    await restaurarSessao($)
    // Escrita mesmo vazia: o barra-uso lê a contagem e, sem valor nenhum, entende que este mod não carregou.
    await update($, anotacoes, lista => [...lista])
    garantirRelogio($)
    void lerPerfis($)
    // O painel da versão anterior do mod tinha outro id: um que ficou aberto num reload fecha.
    void $.ui.close({ id: 'agente' }).catch(() => {})

    return next(e)
  })

  // /clear e /resume seguem no mesmo processo com outro id e sem session.start: as barras da sessão que acabou saem
  // da tela (o store fica com elas) e as da seguinte voltam no primeiro envio.
  on('session.end', async ($, e, next) => {
    // Um passo do demo que dispara depois do fim recriaria as barras dele na sessão seguinte.
    for (const timer of demo) timer.cancel()
    demo = []
    if ((await read($, janela)).aberto) await $.ui.close({ id: PAINEL }).catch(() => {})
    await fecharPainel($)
    await update($, janela, () => JANELA_INICIAL)
    await update($, barras, () => [])
    await update($, faixas, () => [])
    await update($, pendencias, () => [])
    if ((await read($, janelaAnotacoes)).aberto) await $.ui.close({ id: PAINEL_DAS_ANOTACOES }).catch(() => {})
    await update($, janelaAnotacoes, atual => ({ ...JANELA_DAS_ANOTACOES, novo: atual.novo }))
    await update($, anotacoes, () => [])
    // A gravação em voo leva o texto desta sessão; o da seguinte vem do store.
    await gravacao
    textoLivre = null
    await update($, pendenciasAbertas, () => false)
    await update($, turno, () => '')
    await update($, sessao, () => '')
    proximaFerramenta.clear()
    bloqueadas.clear()
    pendenciasNoTurno = ''
    lembrado = ''

    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const prompt = await next(e)
    if (e.traits.includes('bare')) return prompt

    return { sections: [...prompt.sections, { id: 'progresso:lista', text: REGRA, scope: 'session' }] }
  })

  // A ferramenta fica na lista da frente: atrás do ToolSearch cada tarefa pagaria uma busca antes.
  on('tool.describe', { tool: FERRAMENTA }, async ($, e, next) => ({ ...(await next(e)), isDeferred: false }))

  // A barra é da conversa principal. Subagente recebe um sucesso curto (uma recusa o faria insistir) e não cria nada:
  // o progresso dele já está na faixa.
  on('tool.call', { tool: FERRAMENTA }, async ($, e) => {
    if (e.agentId !== undefined) return { result: SO_DA_PRINCIPAL }
    const entrada = e as unknown as Record<string, unknown>
    const comPend = pedePendencias(entrada)
    const comNotas = pedeAnotacoes(entrada)
    if (!comPend && !comNotas) {
      const resposta = await atualizar($, e, null)
      if ('negar' in resposta) return { deny: resposta.negar }

      return { result: resposta.texto }
    }
    // Pendências e anotações, sozinhas ou junto de uma atualização da barra: cada parte responde numa linha.
    const agora = await $.clock.now()
    const partes: { linha: string; negar?: string }[] = []
    if (comPend) {
      const saida: { pend: ReturnType<typeof aplicarPendencias> } = { pend: { negar: 'Sem resposta.' } }
      await update($, pendencias, lista => {
        saida.pend = aplicarPendencias(lista, entrada, agora)
        return 'negar' in saida.pend ? lista : saida.pend.pendencias
      })
      if ('negar' in saida.pend) partes.push({ linha: `Pendências não alteradas: ${saida.pend.negar}`, negar: saida.pend.negar })
      else partes.push({ linha: saida.pend.texto })
      // O lembrete do Stop só se dá por atendido quando a chamada registrou ao menos uma pendência.
      if (!('negar' in saida.pend) && saida.pend.adicionadas > 0) pendenciasNoTurno = await read($, turno)
    }
    if (comNotas) {
      const saida: { notas: ReturnType<typeof aplicarAnotacoes> } = { notas: { negar: 'Sem resposta.' } }
      await update($, anotacoes, lista => {
        saida.notas = aplicarAnotacoes(lista, entrada, agora)
        return 'negar' in saida.notas ? lista : saida.notas.anotacoes
      })
      if ('negar' in saida.notas) partes.push({ linha: `Anotações não alteradas: ${saida.notas.negar}`, negar: saida.notas.negar })
      else partes.push({ linha: saida.notas.texto })
      // As notas livres entram só na listagem, mascaradas e cortadas; nunca no system prompt.
      const livres = entrada.listarAnotacoes === true && !('negar' in saida.notas) ? listaDasNotas(await lerNotasLivres($)) : null
      if (livres) partes.push({ linha: livres })
    }
    if (partes.some(parte => parte.negar === undefined)) void guardar($)
    const linhas = partes.map(parte => parte.linha).join('\n')
    if (entrada.id === undefined) {
      const unica = partes.length === 1 ? partes[0] : undefined
      return unica?.negar !== undefined ? { deny: unica.negar } : { result: linhas }
    }
    const resposta = await atualizar($, e, null)
    const linhaBarra = 'negar' in resposta ? `Barra não alterada: ${resposta.negar}` : resposta.texto

    return { result: `${linhaBarra}\n${linhas}` }
  })

  // O turno da conversa principal: a faixa só se pendura em barra mudada nele, e a banda mostra as finalizadas dele.
  on('turn.start', async ($, e, next) => {
    garantirRelogio($)
    await update($, turno, () => e.turnId)

    return next(e)
  })

  // A mensagem do usuário não tira a espera: a barra esperando só muda quando o modelo a atualiza. Virar andamento aqui
  // fazia o Stop do turno seguinte cobrar de novo a barra que o modelo tinha deixado esperando.
  on('prompt.submit', async ($, e, next) => {
    garantirRelogio($)
    await restaurarSessao($)

    return next(e)
  })

  on('tool.call', { tool: 'AskUserQuestion' }, ($, e, next) => {
    void avisar($, 'decisao', `Esperando você: ${cortar(e.questions[0]?.question ?? 'pergunta aberta', 80)}`)

    return next(e)
  })

  on('classic.PermissionRequest', async ($, e, next) => {
    const agente = e.agent_id
    if (agente !== undefined) await mudarFaixa($, agente, faixa => ({ ...faixa, aprovacao: true }))
    void avisar($, 'decisao', null)

    return next(e)
  })

  // O fim da resposta da conversa principal: barra em andamento com passo aberto, sem nada em background, recebe um
  // pedido para fechar, uma vez por barra por turno. Os hooks de baixo (os do settings) decidem primeiro.
  on('classic.Stop', async ($, e, next) => {
    const resultado = await next(e)
    if (e.agent_id !== undefined) return resultado
    // Comando que o host não lista mais em background acabou sem notificação: a faixa fecha como concluída, em vez
    // de ficar rodando por minutos. Casa por id ou pelo começo do command; sem a lista (host antigo), nada fecha.
    if (e.background_tasks !== undefined) {
      const tarefas = e.background_tasks
      const vivo = (faixa: Faixa) => tarefas.some(tarefa => tarefa.id === faixa.id || mesmoComando(tarefa.command, faixa.comando))
      // Comando de subagente só fecha com o dono já terminado (faixa dele fechada ou ausente): de qualquer dono, inclusive
      // os abertos antes da v3, que ficavam "rodando" por horas.
      const agentes = await read($, faixas)
      const donoRodando = (faixa: Faixa) => faixa.dono !== null && agentes.some(outra => outra.id === faixa.dono && outra.tipo === 'agente' && outra.fim === null)
      await fecharFaixas(
        $,
        faixa => faixa.tipo === 'comando' && faixa.fim === null && !demonstracao(faixa.id) && !vivo(faixa) && !donoRodando(faixa),
        'concluida',
      )
    }
    const atual = await read($, turno)
    const fundo = (e.background_tasks ?? []).length
    fundoNoStop = { turno: atual, n: fundo }
    if (resultado.block !== undefined) return resultado
    const vivas = (await read($, faixas)).filter(faixa => faixa.fim === null && !demonstracao(faixa.id)).length
    if (fundo > 0 || vivas > 0) return resultado
    const todas = (await read($, barras)).filter(barra => !demonstracao(barra.id))
    const lista = e.stop_hook_active ? [] : pendentes(todas).filter(barra => bloqueadas.get(barra.id) !== atual)
    if (lista.length > 0) {
      for (const barra of lista) bloqueadas.set(barra.id, atual)
      return { ...resultado, block: textoDoBloqueio(lista, FERRAMENTA) }
    }
    // Barra deixada esperando, com passo pulado ou falho neste turno, e nenhuma \`pendencias\` nele: um lembrete por
    // turno, também depois de outro bloqueio (é quando a barra costuma virar esperando). Pendência sozinha não bloqueia.
    const depois = paraDepois(todas, atual)
    if (depois.length === 0 || pendenciasNoTurno === atual || lembrado === atual) return resultado
    lembrado = atual

    return { ...resultado, block: textoDoLembrete(depois) }
  })

  // Faixa de subagente: nasce no despacho, mostra a ferramenta em uso e fecha no fim do turno do agente.
  on('agent.spawn', async ($, e, next) => {
    const agente = await next(e)
    if (agente.deny === undefined && agente.agentId !== undefined) {
      await abrirFaixa($, {
        id: agente.agentId,
        tipo: 'agente',
        titulo: cortar(e.description || e.subagentType, 60),
        modelo: modeloCurto(agente.model),
        tipoAgente: e.subagentType,
        dono: e.parentAgentId ?? null,
      })
    }

    return agente
  })

  on('turn.step', async function* ($, e, next) {
    const agente = e.agentId
    if (agente !== undefined) {
      garantirRelogio($)
      // Um passo novo depois do fim do turno é retomada: a faixa volta.
      await garantirFaixa($, agente, true)
      const modelo = modeloCurto(e.model)
      const esforco = esforcoPt(e.effort)
      await mudarFaixa($, agente, faixa => (faixa.modelo === modelo && faixa.esforco === esforco ? faixa : { ...faixa, modelo, esforco }))
    }
    const resposta = yield* next(e)
    if (agente !== undefined && resposta.usage) await registrarPasso($, agente, resposta.usage)

    return resposta
  })

  on('tool.call', async ($, e, next) => {
    const agente = e.agentId
    if (agente === undefined) {
      // No app desktop a decisão do usuário chega por cartão, e em bypass nenhum PermissionRequest sobe: a caixa de
      // próximo passo com pergunta, o plano para aprovar, a oferta de sessão, o branch e o pedido de pasta tocam o som.
      const texto = cartaoDeDecisao(e.tool, e as unknown as Record<string, unknown>)
      if (texto) void avisar($, 'decisao', `Esperando você: ${cortar(texto, 80)}`)

      return next(e)
    }
    garantirRelogio($)
    await garantirFaixa($, agente, false)
    await mostrarFerramenta($, agente, ferramentaCurta(e.tool), e.tool_use_id)
    try {
      return await next(e)
    } finally {
      // A última ferramenta fica na faixa até a próxima chamada ou o fim do turno: limpar aqui fazia o nome piscar
      // entre uma chamada e a seguinte. Só a espera por aprovação sai, qualquer que seja a chamada que a pediu: com
      // chamadas paralelas a faixa guarda só a última.
      await mudarFaixa($, agente, faixa => (faixa.aprovacao ? { ...faixa, aprovacao: false } : faixa)).catch(() => {})
    }
  })

  // Faixa de comando em background: o resultado do Bash traz o id da tarefa que a notificação vai citar.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const rodou = await next(e)
    if (rodou.deny !== undefined || rodou.isError === true) return rodou
    const tarefa = rodou.result.backgroundTaskId
    if (tarefa) {
      // O rótulo é o comando real, sem o "cd <pasta> &&" da frente; a pasta vai para o alt.
      const { titulo, pasta } = comandoLegivel(e.command)
      await abrirFaixa($, { id: tarefa, tipo: 'comando', titulo, pasta, comando: e.command.slice(0, 1000), chamada: e.tool_use_id, dono: e.agentId ?? null })
    }

    return rodou
  })

  // A notificação de tarefa fecha a faixa pelo status; a <usage> do agente cobre os tokens que os passos não deram.
  // O conteúdo chega como texto ou em blocos, conforme a superfície.
  on('session.append', { origin: { kind: 'task-notification' } }, async ($, e, next) => {
    const corpo = textoDaLinha(e.message.content as string | readonly { type: string; text?: string }[])
    const campo = (nome: string) => new RegExp(`<${nome}>\\s*([^<]*?)\\s*</${nome}>`).exec(corpo)?.[1] ?? ''
    const tarefa = campo('task-id')
    const chamada = campo('tool-use-id')
    const tokens = Number(campo('subagent_tokens') || campo('total_tokens'))
    if (tarefa && tokens > 0) await mudarFaixa($, tarefa, faixa => (faixa.tokens > 0 ? faixa : { ...faixa, tokens }), true)
    if (tarefa || chamada) {
      await fecharFaixas(
        $,
        faixa => faixa.id === tarefa || (faixa.tipo === 'comando' && chamada !== '' && faixa.chamada === chamada),
        FIM_DA_TAREFA[campo('status')] ?? 'concluida',
      )
    }

    return next(e)
  })

  // A conversa do agente aberto no painel cresce ao vivo: cada linha que a sessão guarda dele entra na cauda.
  on('session.append', async ($, e, next) => {
    await anexarAoPainel($, e.agentId, e.message as Parameters<typeof falasDaLinha>[0]).catch(() => {})

    return next(e)
  })

  // O fechar do usuário, pela marca do painel ou pelo Esc. O painel só abre a pedido: /progresso painel, o percentual
  // de uma barra ou o número de uma faixa.
  on('ui.close', { id: PAINEL }, async ($, e, next) => {
    const fechou = await next(e)
    await fecharPainel($)

    return fechou
  })

  on('ui.close', { id: PAINEL_DAS_ANOTACOES }, async ($, e, next) => {
    const fechou = await next(e)
    await anotacoesFechadas($)

    return fechou
  })

  // O botão "Anotações" do barra-uso: a cada clique ele escreve o contador dele, e só o dono escreve um valor; este
  // hook ouve a escrita e alterna o painel, que é deste mod. Sem clique e sem comando, ninguém escreve.
  // O tipo do matcher é o do contrato deste mod (o do barra-uso só viria por `dependencies`, que tornaria um mod
  // obrigatório para o outro): o matcher vai sem tipo e a escrita é lida pelos dois campos que importam.
  on('state.set', PEDIDO_DO_BARRA_USO as never, async ($, e, next) => {
    const gravado = await next(e)
    const escrita = e as unknown as { value?: unknown; previous?: unknown }
    if (escrita.value !== escrita.previous) await alternarAnotacoes($).catch(() => {})

    return gravado
  })

  on('command.run', { command: 'anotacoes' }, async $ => {
    await alternarAnotacoes($)
    const { aberto } = await read($, janelaAnotacoes)

    return { text: `Painel de anotações ${aberto ? 'aberto' : 'fechado'} · ${contagemDeAnotacoes((await read($, anotacoes)).length)}` }
  })

  on('turn.complete', async ($, e, next) => {
    const agente = e.agentId
    if (agente !== undefined) {
      await registrarTurno($, agente, e.usage)
      await fecharFaixas($, faixa => faixa.id === agente, FIM_DO_TURNO[e.reason])
      if (encerrados.size > 500) encerrados.clear()
      encerrados.add(agente)
    } else {
      // Fim do turno da conversa principal: nenhuma barra fica em andamento sem dono.
      const agora = await $.clock.now()
      const atual = await read($, turno)
      const vivas = (await read($, faixas)).filter(faixa => faixa.fim === null && !demonstracao(faixa.id)).length
      const fundo = fundoNoStop.turno === atual && fundoNoStop.n >= 0 ? Math.max(fundoNoStop.n, 0) : vivas
      fundoNoStop = { turno: '', n: -1 }
      const saida: { mudadas: { barra: Barra; virou: Estado | null }[] } = { mudadas: [] }
      if ((await read($, barras)).some(barra => barra.dono === null && !finalizada(barra) && !demonstracao(barra.id))) {
        await update($, barras, lista => {
          const fim = fimDoTurno(lista, e.reason, agora, atual, fundo)
          saida.mudadas = fim.mudadas
          return fim.lista
        })
      }
      for (const { barra, virou } of saida.mudadas) avisarEstado($, barra, virou)
      if (saida.mudadas.length > 0) void guardar($)
    }

    return next(e)
  })

  const resumoDasAtivas = (n: number) => (n === 0 ? 'nenhuma barra ativa agora' : n === 1 ? '1 ativa' : `${n} ativas`)

  on('command.run', { command: 'progresso' }, async ($, e) => {
    const pedido = (e.args ?? '').trim().toLowerCase()
    if (pedido === 'painel') {
      await abrirPainelProgresso($)
      return { text: 'Painel de progresso aberto.' }
    }
    if (pedido !== '' && pedido !== 'on' && pedido !== 'off') {
      return { text: 'use /progresso on para mostrar, /progresso off para esconder, /progresso sem nada para alternar ou /progresso painel para o painel lateral.' }
    }
    const escondido = await update($, oculto, valor => (pedido === 'on' ? false : pedido === 'off' ? true : !valor))
    await $.store.set('oculto', escondido)
    // A resposta diz o que há para ver: "visíveis" sem nenhuma barra aberta parecia não ter funcionado.
    const ativas = (await read($, barras)).filter(barra => !finalizada(barra)).length

    return { text: `Barras de progresso ${escondido ? 'escondidas' : 'visíveis'} · ${resumoDasAtivas(ativas)}` }
  })

  on('command.run', { command: 'progresso-demo' }, async $ => {
    await rodarDemo($)

    return { text: 'Demonstração rodando acima do prompt e no painel por 30 s. /progresso-limpar interrompe.' }
  })

  on('command.run', { command: 'progresso-limpar' }, async $ => {
    await limpar($)

    return { text: 'Barras e faixas removidas.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // O que os outros mods desenham na mesma faixa continua embaixo das barras. Vem antes da leitura do estado: um
    // desenho que espera os outros e só então lê não sai com um estado mais velho que o de um desenho seguinte.
    const abaixo = await desenhoDeBaixo($, next(e))
    const { Box: Caixa, Button, Text: Texto } = $.ui.resolve(e)
    // A banda tem de devolver uma árvore: sem nada a desenhar, vai o que veio de baixo e, só sem ele, um Box vazio.
    if (e.props.hasSurvey) return abaixo ?? <Caixa flexDirection="column" />
    const colunas = e.props.bodyColumns
    const { trilha, faixa: larguraFaixa, total } = larguras(colunas)
    // A faixa de pendências fica embaixo das barras, colada ao prompt, e não segue o /progresso off: é o lembrete.
    const listaPend = await read($, pendencias)
    const aberta = await read($, pendenciasAbertas)
    const pend =
      listaPend.length === 0
        ? null
        : e.surface === 'desktop'
          ? pendenciasNoDesktop($, { Caixa, Button, Texto, Svg: $.ui.resolve(e).Svg }, listaPend, aberta, total)
          : pendenciasNoTerminal($, { Caixa, Button, Texto }, listaPend, aberta, colunas)
    // O bloco do mod (barras e pendências) e, embaixo, o que os outros desenham; o que vem vazio de baixo não ganha vão.
    const comAbaixo = (bloco: RenderElement) =>
      semConteudo(abaixo) ? (
        bloco
      ) : (
        <Caixa flexDirection="column" gap={e.surface === 'desktop' ? 1 : 0}>
          {bloco}
          {abaixo}
        </Caixa>
      )
    // O bloco estica até a borda da banda, com ou sem barras: a conta de `total` em px fica 60 a 75 px aquém da área
    // real no app (prints de 23/10) e o que dependia dela parava longe da borda. A borda direita vem do flex.
    const vazio = () =>
      pend ? (
        comAbaixo(
          <Caixa key="progresso" flexDirection="column">
            {pend}
          </Caixa>,
        )
      ) : (
        (abaixo ?? <Caixa flexDirection="column" />)
      )
    if (await read($, oculto)) return vazio()
    const agora = await $.clock.now()
    const todas = vistas(await read($, barras), await read($, faixas), agora, await read($, turno))
    if (todas.length === 0) return vazio()

    // Passou do limite: saem primeiro as barras mais novas do demo, depois as mais velhas; sem demo, é o slice(-4) de
    // sempre. Assim o demo nunca empurra para fora uma barra de trabalho real.
    const candidatas = [...todas.filter(vista => demonstracao(vista.id)).reverse(), ...todas.filter(vista => !demonstracao(vista.id))]
    const fora = new Set(candidatas.slice(0, Math.max(0, todas.length - MAX_VISTAS)))
    const mostradas = todas.filter(vista => !fora.has(vista))
    const escondidas =
      todas.length > mostradas.length ? `+${todas.length - mostradas.length} barras · /progresso painel mostra todas` : ''
    // Só o percentual à direita de cada barra, clicável: abre o painel. A contagem X/Y fica no painel e no resultado
    // da ferramenta. No terminal a coluna tem as 4 células de "100%". No desktop o Button plain soma o respiro dos dois
    // lados e 4 colunas cortavam o texto em ".."; lá a coluna é a da direita (COLUNA_DIREITA, a do relógio das faixas),
    // em minWidth: "100%" cabe com folga, e se a fonte crescer a coluna cresce em vez de cortar.
    const percentualDe = (vista: (typeof mostradas)[number]) =>
      automatica(vista)
        ? []
        : [
            <Caixa
              key={`pct:${vista.id}`}
              {...(e.surface === 'desktop' ? { minWidth: COLUNA_DIREITA } : { width: 4 })}
              flexShrink={0}
              justifyContent="flex-end"
            >
              <Button
                key={`painel:${vista.id}`}
                label={`${String(percentual(vista)).padStart(3, ESPACO_DE_DIGITO)}%`}
                plain
                onPress={() => abrirPainelProgresso($)}
              />
            </Caixa>,
          ]
    // O número da faixa abre a conversa do agente: Button apagado que acende sob o ponteiro.
    const numeroDaFaixa = (id: string, rotulo: string, linha: (typeof mostradas)[number]['linhas'][number] | undefined) =>
      linha && !linha.comando ? (
        <Button key={`abrir:${id}`} label={rotulo} plain dimColor hover={{ dimColor: false }} onPress={() => abrirAgente($, linha.id, linha.titulo)} />
      ) : (
        <Texto key={`numero:${id}`} dimColor>
          {rotulo}
        </Texto>
      )

    if (e.surface === 'desktop') {
      const { Box, Svg, Text } = $.ui.resolve(e)
      // Cada linha: os desenhos sem `width` num Box que estica (`esticado`) e, à direita, a coluna de COLUNA_DIREITA
      // (o "%" na barra, o relógio na faixa) com o mesmo vão: trilha e faixas acabam no mesmo x, encostadas nela, e a
      // coluna encosta na borda real da banda. Faixa: a calha de 24 px com o ícone a 7 (a do pino e do "5H"), o número
      // clicável e a faixa; o tempo vai num Text, que anda a cada tique sem trocar a imagem da faixa.
      const linhaCheia = { flexDirection: 'row', alignItems: 'center', columnGap: 1 } as const
      // O fio fica direto na coluna da banda, que já estica a imagem; `esticado` (width 0) aqui o deixava com 0 px.
      const fio = (key: string) => <Svg key={key} source={svgDoDivisor()} alt="divisor" height={1} />
      const direita = (key: string, filho: RenderElement) => (
        <Box key={key} minWidth={COLUNA_DIREITA} flexShrink={0} justifyContent="flex-end">
          {filho}
        </Box>
      )

      return comAbaixo(
        <Box key="progresso" flexDirection="column" gap={1}>
          {!!escondidas && <Text dimColor>{escondidas}</Text>}
          {mostradas.flatMap((vista, i) => {
            const debaixo = svgDasFaixas(vista, larguraFaixa, false)
            // Grupo automático: sem trilha vazia a 0%, só o rótulo, a contagem e as faixas.
            let desenho
            if (automatica(vista)) {
              const rotulo = svgDoRotulo(vista)
              desenho = <Svg key={`rotulo:${vista.id}`} source={rotulo.source} alt={rotulo.alt} height={rotulo.altura} />
            } else {
              const trilhaSvg = svgDaTrilha(vista, trilha, agora)
              if (trilhaSvg.desliza) assentar($, agora)
              desenho = <Svg key={`trilha:${vista.id}`} source={trilhaSvg.source} alt={trilhaSvg.alt} height={ALT_TRILHA} />
            }

            return [
              ...(i > 0 ? [fio(`fio:${vista.id}`)] : []),
              <Box key={`barra:${vista.id}`} flexDirection="column">
                <Box key={`topo:${vista.id}`} {...linhaCheia}>
                  {esticado(Box, `trilha-caixa:${vista.id}`, desenho)}
                  {percentualDe(vista)}
                </Box>
                {debaixo.map(faixa => {
                  const linha = vista.linhas.find(item => item.id === faixa.key)
                  const alt = linha && !linha.comando ? `${faixa.alt}; o número ${faixa.rotulo} abre a conversa` : faixa.alt

                  return (
                    <Box key={`linha:${vista.id}:${faixa.key}`} {...linhaCheia}>
                      {/* alt não vazio: com alt "" o app não desenha o Svg (o ícone sumia da calha ao vivo). */}
                      <Svg key={`icone:${vista.id}:${faixa.key}`} source={faixa.icone} alt={linha?.comando ? 'comando' : 'agente'} width={LARGURA_DA_CALHA} height={faixa.altura} />
                      {/* minWidth, não width: o botão nativo do desktop tem respiro interno e cortava o "2" com 2 colunas. */}
                      <Box key={`numero:${vista.id}:${faixa.key}`} minWidth={COLUNA_DO_NUMERO} flexShrink={0}>
                        {numeroDaFaixa(faixa.key, faixa.rotulo, linha)}
                      </Box>
                      {esticado(Box, `faixa-caixa:${vista.id}:${faixa.key}`, <Svg key={`faixa:${vista.id}:${faixa.key}`} source={faixa.source} alt={alt} height={faixa.altura} />)}
                      {direita(`tempo:${vista.id}:${faixa.key}`, <Text dimColor>{linha?.relogio ?? ''}</Text>)}
                    </Box>
                  )
                })}
              </Box>,
            ]
          })}
          {!!pend && fio('fio:pendencias')}
          {pend}
        </Box>,
      )
    }

    const { Box, Text } = $.ui.resolve(e)
    const larguraTitulo = Math.max(8, Math.min(28, Math.floor(colunas * 0.24)))
    const larguraTrilho = Math.max(6, Math.min(20, Math.floor(colunas * 0.16)))
    // Ícone, contagem, percentual e os vãos entre eles ocupam umas 20 colunas.
    const larguraRotulo = Math.max(6, colunas - larguraTitulo - larguraTrilho - 20)

    return comAbaixo(
      <Box flexDirection="column">
        {!!escondidas && <Text dimColor>{escondidas}</Text>}
        {mostradas.map(vista => {
          const cheio = Math.round((larguraTrilho * percentual(vista)) / 100)

          return (
            <Box flexDirection="column">
              {automatica(vista) ? (
                <Box flexDirection="row" gap={1}>
                  <Text dimColor>{vista.titulo}</Text>
                  <Text dimColor>{cortar(vista.rotulo, larguraRotulo)}</Text>
                </Box>
              ) : (
                <Box flexDirection="row" gap={1}>
                  <Text>
                    <Text color={COR_TERMINAL[vista.tom]}>{'━'.repeat(cheio)}</Text>
                    <Text dimColor>{'─'.repeat(larguraTrilho - cheio)}</Text>
                  </Text>
                  <Text color={COR_TERMINAL[vista.tom]}>{ICONE[vista.tom]}</Text>
                  <Text bold>{cortar(vista.titulo, larguraTitulo)}</Text>
                  <Text color={COR_TERMINAL[vista.tom]}>{cortar(vista.rotulo, larguraRotulo)}</Text>
                  {percentualDe(vista)}
                </Box>
              )}
              {vista.linhas.map((linha, i) => {
                const desenho = linha.comando ? 'terminal' : desenhoDoTipo(linha.tipo)

                return (
                  <Box key={`linha:${vista.id}:${linha.id}`} flexDirection="row" gap={1}>
                    <Text dimColor>{i === vista.linhas.length - 1 && !vista.resumo ? '  └' : '  ├'}</Text>
                    <Text dimColor>{glifoDe(desenho)}</Text>
                    {numeroDaFaixa(linha.id, String(linha.numero), linha)}
                    <Text color={COR_TERMINAL[linha.tom]}>{ICONE[linha.tom]}</Text>
                    <Text dimColor={linha.tom !== 'andamento' && linha.tom !== 'esperando'}>
                      {cortar(linha.comando ? `$ ${linha.titulo}` : linha.titulo, Math.max(10, Math.floor(colunas * 0.4)))}
                    </Text>
                    {!!linha.meta && <Text dimColor>{linha.meta}</Text>}
                    {!!linha.selo && <Text color={COR_TERMINAL[linha.tom]}>{linha.selo}</Text>}
                    <Text dimColor>{linha.relogio}</Text>
                  </Box>
                )
              })}
              {!!vista.resumo && <Text dimColor>{`  └ ${vista.resumo}`}</Text>}
            </Box>
          )
        })}
        {pend}
      </Box>,
    )
  })

  // O painel "Progresso": a visão geral ou, com um agente aberto, a faixa dele, a cauda da conversa e o campo.
  on('ui.render', { component: 'Pane', requestId: PAINEL }, async ($, e, next) => {
    if (e.surface !== 'desktop' && e.surface !== 'terminal') return next(e)
    const { Box, Button, Input, Markdown, Text } = $.ui.resolve(e)
    const Svg = e.surface === 'desktop' ? $.ui.resolve(e).Svg : undefined
    const estado = await read($, painel)
    const agora = await $.clock.now()
    const lista = await read($, faixas)
    const fechar = async () => {
      // O fechar do próprio mod não passa pelo hook de ui.close dele: o estado do painel sai aqui.
      await $.ui.close({ id: PAINEL })
      await fecharPainel($)
    }

    if (estado.agente === null) {
      const todas = await read($, barras)
      const barra = barraEmFoco(todas, await read($, turno))
      const { concluidos, recolhido, passosAbertos } = await read($, janela)

      return desenharPainel(
        { Box, Text, Button, Svg },
        {
          agora,
          colunas: e.props.bodyColumns,
          barra,
          resumo: barra && resumoDaBarra(barra, lista, agora),
          agentes: lista.filter(faixa => faixa.tipo === 'agente'),
          comandos: lista.filter(faixa => faixa.tipo === 'comando'),
          planejados: planejadosDe(barra),
          perfil: perfilDe,
          concluidosAbertos: concluidos !== false,
          recolhido: recolhido === true,
          passosAbertos: passosAbertos === true,
        },
        {
          abrirAgente: (id, titulo) => abrirAgente($, id, titulo),
          alternarConcluidos: () => update($, janela, atual => ({ ...atual, concluidos: atual.concluidos === false })),
          alternarRecolhido: () => update($, janela, atual => ({ ...atual, recolhido: atual.recolhido !== true })),
          alternarPassos: () => update($, janela, atual => ({ ...atual, passosAbertos: atual.passosAbertos !== true })),
          fechar,
        },
      )
    }

    // Sem faixa ativa o agente terminou, e o envio o retoma do transcript.
    const rodando = lista.some(faixa => faixa.id === estado.agente && faixa.fim === null)
    const vista = vistas(await read($, barras), lista, agora, await read($, turno)).find(item => item.linhas.some(linha => linha.id === estado.agente))
    const linha = vista?.linhas.find(item => item.id === estado.agente)
    // No terminal o glifo do tipo do agente vem antes do título; no desktop o ícone de linha está na faixa desenhada.
    const tipoDoAberto = lista.find(faixa => faixa.id === estado.agente)?.tipoAgente ?? ''
    let topo = (
      <Box key="topo" flexDirection="row" columnGap={1}>
        <Text dimColor>{glifoDe(desenhoDoTipo(tipoDoAberto))}</Text>
        <Text bold>{estado.titulo}</Text>
      </Box>
    )
    if (Svg && vista && linha) {
      const largura = Math.max(240, e.props.bodyColumns * 8) - TEMPO_PX - 8
      // Id próprio: a faixa do painel tem outra largura e não disputa o desenho guardado com a da banda.
      const faixa = svgDasFaixas({ ...vista, id: `painel:${vista.id}`, linhas: [linha], ocultas: 0 }, largura)[0]
      if (faixa) {
        topo = (
          <Box key="topo" flexDirection="row" alignItems="center" columnGap={1}>
            <Svg key="topo-faixa" source={faixa.source} alt={faixa.alt} width={largura} height={faixa.altura} />
            <Box key="topo-tempo" width={TEMPO_COLUNAS} flexShrink={0} justifyContent="flex-end">
              <Text dimColor>{linha.relogio}</Text>
            </Box>
          </Box>
        )
      }
    }

    return (
      <Box flexDirection="column" gap={1}>
        <Button key="voltar" label="← voltar" plain onPress={() => voltar($)} />
        {topo}
        {!!estado.aviso && <Text key="aviso" dimColor>{estado.aviso}</Text>}
        {!estado.aviso && estado.falas.length === 0 && <Text dimColor>O agente ainda não escreveu nada.</Text>}
        {estado.falas.map(fala =>
          fala.quem === 'ferramenta' ? (
            <Text dimColor>{`› ${fala.texto}`}</Text>
          ) : (
            <Box flexDirection="column">
              <Text dimColor={fala.quem !== 'voce'} bold={fala.quem === 'voce'}>
                {QUEM[fala.quem]}
              </Text>
              {fala.quem === 'agente' ? <Markdown text={fala.texto} /> : <Text>{fala.texto}</Text>}
            </Box>
          ),
        )}
        <Input
          key="msg"
          placeholder={rodando ? 'Mensagem para o agente' : 'Agente terminado: enviar retoma o agente'}
          submitLabel="enviar"
          autoFocus
          onSubmit={texto => enviarAoAgente($, texto)}
        />
        <Button key="fechar-painel" role="dismiss" label="Fechar" onPress={fechar} />
      </Box>
    )
  })

  // O painel "Anotações": o resumo, o formulário recolhido, as anotações por grupo que recolhe e as pendências em âmbar.
  on('ui.render', { component: 'Pane', requestId: PAINEL_DAS_ANOTACOES }, async ($, e, next) => {
    if (e.surface !== 'desktop' && e.surface !== 'terminal') return next(e)
    const { Box, Button, Input, Link, Text } = $.ui.resolve(e)
    const Svg = e.surface === 'desktop' ? $.ui.resolve(e).Svg : undefined
    const mudarJanela = (mudar: (atual: JanelaAnotacoes) => JanelaAnotacoes) => update($, janelaAnotacoes, mudar)
    // O painel sem o teclado recusa o foco: o campo fica onde está, sem aviso.
    const focar = (chave: string) => $.ui.focus({ requestId: PAINEL_DAS_ANOTACOES, key: chave }).catch(() => {})

    return desenharAnotacoes(
      { Box, Text, Button, Input, Link, Svg },
      {
        colunas: e.props.bodyColumns,
        anotacoes: await read($, anotacoes),
        pendencias: await read($, pendencias),
        janela: await read($, janelaAnotacoes),
        notasLivres: await lerNotasLivres($),
      },
      {
        abrirFormulario: async () => {
          await mudarJanela(atual => ({ ...atual, formulario: true, editando: null, edicao: CAMPOS_VAZIOS }))
          await focar('novo:titulo')
        },
        // Cancelar fecha e limpa o rascunho.
        cancelarFormulario: () => mudarJanela(atual => ({ ...atual, formulario: false, novo: CAMPOS_VAZIOS })),
        mudarNovo: (campo, valor) => mudarJanela(atual => ({ ...atual, novo: { ...atual.novo, [campo]: valor } })),
        adicionar: (campo, valor) => adicionarPeloPainel($, campo, valor),
        focar,
        alternarGrupo: grupo =>
          recolherNoPainel($, atual => {
            const fora = semGrupo(atual.recolhidos, grupo)
            return { recolhidos: fora.length < atual.recolhidos.length ? fora : [...atual.recolhidos, grupo] }
          }),
        alternarPendencias: () => recolherNoPainel($, atual => ({ pendenciasRecolhidas: !atual.pendenciasRecolhidas })),
        recolherTudo: (recolher, grupos) =>
          recolherNoPainel($, () => ({ recolhidos: recolher ? grupos : [], pendenciasRecolhidas: recolher, notasRecolhidas: recolher })),
        alternarNotas: () => recolherNoPainel($, atual => ({ notasRecolhidas: !atual.notasRecolhidas })),
        mudarAlturaDasNotas: passo => recolherNoPainel($, atual => ({ notasAltura: alturaDasNotas(atual.notasAltura, passo) })),
        mudarNotas: texto => mudarNotasLivres($, texto),
        alternarMenu: item => mudarJanela(atual => ({ ...atual, menu: atual.menu === item.titulo ? null : item.titulo, apagando: null })),
        copiar: (item, surface) => copiarAnotacao($, item, surface),
        editar: async item => {
          await mudarJanela(atual => ({ ...atual, editando: item.titulo, apagando: null, menu: null, edicao: { titulo: item.titulo, valor: item.valor, grupo: item.grupo } }))
          await focar('editar:titulo')
        },
        mudarEdicao: (campo, valor) => mudarJanela(atual => ({ ...atual, edicao: { ...atual.edicao, [campo]: valor } })),
        salvarEdicao: (campo, valor) => salvarEdicao($, campo, valor),
        cancelarEdicao: () => mudarJanela(atual => ({ ...atual, editando: null, edicao: CAMPOS_VAZIOS })),
        apagar: item => mudarJanela(atual => ({ ...atual, apagando: item.titulo, editando: null })),
        confirmarApagar: async item => {
          await mudarAnotacoes($, lista => lista.filter(outra => outra.titulo !== item.titulo))
          await mudarJanela(atual => ({ ...atual, apagando: null, menu: null }))
        },
        cancelarApagar: () => mudarJanela(atual => ({ ...atual, apagando: null })),
        resolver: item => resolverPeloPainel($, item),
      },
    )
  })
}
