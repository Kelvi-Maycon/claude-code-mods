import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, Timer, TurnUsage } from 'claude-code'

import type { Barra, Estado, Fala, Faixa } from '../types'
import {
  MAX_FALAS,
  PERFIS,
  adotar,
  aplicar,
  automatica,
  barraEmFoco,
  barraParaFaixa,
  comandoLegivel,
  comoBarra,
  comoFaixa,
  cortar,
  duracao,
  esforcoPt,
  falasDaConversa,
  falasDaLinha,
  ferramentaCurta,
  fimDoTurno,
  finalizada,
  modeloCurto,
  pendentes,
  percentual,
  perfilDoArquivo,
  relogioPreciso,
  restaurada,
  resumoDaBarra,
  textoDaLinha,
  textoDoBloqueio,
  tipoDoPasso,
  vistas,
} from './modelo'
import type { Perfil, Resposta, Tom } from './modelo'
import { desenhoDoTipo, glifoDe } from './icones'
import { desenharPainel } from './painel'
import { contextoDe, custoDe, janelaDe, somarUsd } from './precos'
import { ALT_TRILHA, DESLIZE_MS, svgDaTrilha, svgDasFaixas, svgDoDivisor, svgDoRotulo } from './svg'

const FERRAMENTA = 'mcp__progresso__progresso'
const MAX_FAIXAS = 40
const MAX_SESSOES = 20
const MAX_VISTAS = 4
// Espaço da largura de um dígito: o percentual ocupa sempre três casas.
const ESPACO_DE_DIGITO = String.fromCharCode(0x2007)
// A área acima do prompt no app desktop não tem 8 px por coluna: medida no app, fica entre 7,69 e 7,8 px por
// coluna, e a conta de 8 px estourava a linha (as imagens encolhiam e uma
// pílula perdia a borda). A estimativa fica no menor valor medido e só dimensiona os desenhos. A superfície não
// informa a largura em px (só colunas), então o erro da estimativa não pode virar vão entre a trilha e o
// percentual: o percentual e o "abrir" vêm logo depois da trilha, e a folga fica na borda externa.
const larguraUtil = (colunas: number) => Math.max(320, Math.floor(colunas * 7.69) - 2)
// À direita da trilha, o vão e a coluna do percentual ("100%"); as faixas vão até o fim dela.
const VAO = 8
const COLUNA_PCT = 32
// O app desenha a imagem em células de 8 px: trilha e faixas fecham num múltiplo de 8 para não crescer na tela.
const naGrade = (px: number) => Math.floor(px / 8) * 8
const SILENCIO_MS = 3000
// Quanto um nome de ferramenta fica na faixa antes de dar lugar ao seguinte: chamadas paralelas trocavam em milissegundos.
const TROCA_MS = 1000
// Quanto a banda espera o desenho dos mods de baixo. A espera em `next` não conta no orçamento de 10 s do hook nesta
// versão do engine, mas contava em versões anteriores; passado o limite, a banda
// sai sem o que eles desenham, em vez de não sair. Fica abaixo do tique de 1 s: um desenho que esperasse mais seria
// substituído pelo do tique seguinte antes de sair.
const ESPERA_ABAIXO_MS = 800
const SO_DA_PRINCIPAL =
  'ok: a barra de progresso é só da conversa principal e não foi alterada. O seu progresso já aparece na sua faixa; não chame esta ferramenta de novo.'

const barras = atom({ plugin: 'progresso', key: 'barras' } as const, [])
const faixas = atom({ plugin: 'progresso', key: 'faixas' } as const, [])
const oculto = atom({ plugin: 'progresso', key: 'oculto' } as const, false)
/** O agente aberto no painel e a cauda da conversa dele; agente null mostra a visão geral. */
const painel = atom({ plugin: 'progresso', key: 'painel' } as const, { agente: null, titulo: '', falas: [], aviso: '' })
const JANELA_INICIAL = { aberto: false, fechadoPeloUsuario: false, abriuSozinho: false, concluidos: true, recolhido: false, passosAbertos: false }
const janela = atom({ plugin: 'progresso', key: 'janela' } as const, JANELA_INICIAL)
const turno = atom({ plugin: 'progresso', key: 'turno' } as const, '')
const sessao = atom({ plugin: 'progresso', key: 'sessao' } as const, '')

const SONS = {
  decisao: 'sounds/decisao.wav',
  erro: 'sounds/erro.wav',
  concluido: 'sounds/concluido.wav',
} as const

const REGRA = `# Barra de progresso
Em tarefa com vários passos, use \`${FERRAMENTA}\` para mostrar o plano ao usuário. Crie a barra uma vez, com o plano inteiro, e atualize quando um passo terminar ou falhar. Antes de encerrar o turno, feche-a: "concluido", "esperando" se precisa de resposta do usuário, ou falhou. Só a conversa principal usa; subagente não chama.`

const DESCRICAO = `Barra de progresso que o usuário vê acima do prompt.
Criar: {id, titulo, etapas:[{nome, passos:["..."]}]} ou {id, titulo, passos:["..."]}.
Atualizar com o mesmo id: {proximo:true} conclui o passo ativo e inicia o seguinte; {feitos:["..."], ativo:"..."} marca passos pelo título (aproximado) ou pelo número, a partir de 1; {falhou:"passo", nota:"motivo"}; {estado:"esperando"|"concluido"|"erro"|"andamento", nota}.
Feche antes de encerrar o turno: {proximo:true, estado:"concluido"}; "esperando" quando depende do usuário. Passos abertos numa barra concluída viram pulados.
Reenviar etapas reescreve o plano e preserva os passos já feitos. Só a conversa principal usa; subagente não chama.`

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
    estado: { type: 'string', enum: ['andamento', 'esperando', 'erro', 'concluido'] },
    nota: { type: 'string' },
  },
  required: ['id'],
}

// No terminal a cor vem da chave do tema, que acompanha claro e escuro; no desktop, das cores do desenho (svg.ts).
const COR_TERMINAL: Record<Tom, string | undefined> = {
  andamento: 'permission',
  esperando: 'warning',
  erro: 'error',
  concluido: 'success',
  parada: 'inactive',
  neutro: undefined,
}
const ICONE: Record<Tom, string> = { andamento: '✻', esperando: '◆', erro: '✕', concluido: '✓', parada: '■', neutro: '○' }
const QUEM = { agente: 'agente', entrada: 'recebido', voce: 'você' } as const
const FIM_DO_TURNO = { answer: 'concluida', aborted: 'parada', refusal: 'falhou', error: 'falhou' } as const
const FIM_DA_TAREFA: Record<string, Faixa['estado']> = { completed: 'concluida', failed: 'falhou', killed: 'parada', stopped: 'parada' }

type Som = keyof typeof SONS
type Sessoes = Record<string, { em: number; barras: Partial<Barra>[]; faixas?: Partial<Faixa>[] }>

let ultimoSom = 0
let gravacao: Promise<void> = Promise.resolve()
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
// O que o último Stop da conversa principal contou em background, no turno dele.
let fundoNoStop = { turno: '', n: -1 }

const demonstracao = (id: string) => id.startsWith('demo-')

// Modelo e esforço de cada tipo de agente: a tabela de PERFIS, trocada pelo frontmatter de ~/.claude/agents quando ele
// é lido no session.start. Os tipos padrão do Claude Code, que não têm arquivo, também nomeiam passos planejados.
let perfis: Record<string, Perfil> = { ...PERFIS }
const TIPOS_SEM_ARQUIVO = ['general-purpose', 'Explore', 'Plan', 'claude', 'fork']

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

/** Um toast sempre; o som, no máximo um a cada SILENCIO_MS. */
async function avisar($: EngineInterface, som: Som, texto: string | null) {
  if (texto) $.ui.toast(texto)
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
      const sessoes = { ...(((await $.store.get('sessoes')) ?? {}) as Sessoes) }
      if (lista.length > 0 || vivas.length > 0) sessoes[id] = { em: await $.clock.now(), barras: lista, faixas: vivas }
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
  const emMemoria = (await read($, barras)).length > 0 || (await read($, faixas)).length > 0
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
  const B = 'demo-csv'
  const C = 'demo-email'
  const D = 'demo-notas'
  const agente = (id: string, titulo: string, tipoAgente: string, modelo: string, esforco: string, ferramenta: string) =>
    abrirFaixa($, { id, tipo: 'agente', titulo, modelo, esforco, ferramenta, barra: A, tipoAgente })
  const build = comandoLegivel('cd ~/projetos/app && npm run build -- --filter docs')
  const roteiro: [number, () => Promise<unknown>][] = [
    [0, () => abrirPainelProgresso($).catch(() => {})],
    [0, () =>
      atualizar($, {
        id: A,
        titulo: 'Publicar a versão 2.0',
        etapas: [
          { nome: 'Preparar', passos: ['Ler o changelog', 'Mapear mudanças da API (investigador)'] },
          { nome: 'Construir', passos: ['Redesenhar a página de docs (executor-design)', 'Conferir os exemplos (executor-leve)', 'Ler o guia de migração (leitor)'] },
          { nome: 'Verificar', passos: ['Testar no celular', 'Revisar tudo (executor-pesado)'] },
        ],
      }, null)],
    [200, () => atualizar($, { id: B, titulo: 'Migrar usuários do CSV', passos: ['Ler o CSV', 'Limpar duplicados', 'Gravar no banco'] }, null)],
    [400, () => atualizar($, { id: C, titulo: 'Rodar a suíte de testes', passos: ['Rodar unitários', 'Escolher o ambiente', 'Rodar e2e'] }, null)],
    [600, () => atualizar($, { id: D, titulo: 'Atualizar notas de versão', passos: ['Ler o diff', 'Escrever', 'Revisar'] }, null)],
    [1000, () => atualizar($, { id: A, proximo: true }, null)],
    [1200, () => agente('demo-pesquisa', 'Mapear mudanças da API', 'investigador', 'opus 5.5', 'alto', 'WebSearch')],
    [1800, () => agente('demo-docs', 'Redesenhar a página de docs', 'executor-design', 'sonnet 5.5', 'médio', 'Read')],
    [2200, () => abrirFaixa($, { id: 'demo-build', tipo: 'comando', titulo: build.titulo, pasta: build.pasta, barra: B })],
    [2400, () => agente('demo-exemplos', 'Conferir os exemplos', 'executor-leve', 'haiku 4.5', 'baixo', 'Grep')],
    [2800, () => agente('demo-guia', 'Ler o guia de migração', 'leitor', 'sonnet 5.5', 'médio', 'Read')],
    [3000, () => atualizar($, { id: B, proximo: true }, null)],
    [3200, () => atualizar($, { id: C, proximo: true }, null)],
    [3400, () => atualizar($, { id: D, proximo: true }, null)],
    [3800, () => mudarFaixa($, 'demo-docs', faixa => ({ ...faixa, ferramenta: 'Edit' }))],
    [4200, () => atualizar($, { id: D, proximo: true }, null)],
    [4600, () => atualizar($, { id: C, estado: 'esperando', nota: 'Rodo os e2e no staging?' }, null)],
    [5400, () => mudarFaixa($, 'demo-exemplos', faixa => ({ ...faixa, ferramenta: 'Bash', aprovacao: true }))],
    [5800, () => atualizar($, { id: D, estado: 'concluido', proximo: true }, null)],
    [7000, () => atualizar($, { id: B, falhou: 'Limpar duplicados', nota: '12 linhas com data inválida' }, null)],
    [7400, () => mudarFaixa($, 'demo-exemplos', faixa => ({ ...faixa, aprovacao: false }))],
    [8000, () => atualizar($, { id: A, proximo: true }, null)],
    [9000, () => fecharFaixas($, faixa => faixa.id === 'demo-pesquisa', 'concluida')],
    [11000, () => fecharFaixas($, faixa => faixa.id === 'demo-guia', 'falhou')],
    [13000, () => fecharFaixas($, faixa => faixa.id === 'demo-exemplos', 'concluida')],
    [14000, () => atualizar($, { id: A, proximo: true }, null)],
    [17000, () => fecharFaixas($, faixa => faixa.id === 'demo-build', 'concluida')],
    [19000, () => fecharFaixas($, faixa => faixa.id === 'demo-docs', 'concluida')],
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

/** Abre sozinho uma vez por sessão (primeira barra com 3+ passos, primeiro subagente), se o usuário não o fechou. */
async function abrirSozinho($: EngineInterface) {
  const estado = await read($, janela)
  if (estado.fechadoPeloUsuario || estado.abriuSozinho || estado.aberto) return
  garantirRelogio($)
  await update($, janela, atual => ({ ...atual, abriuSozinho: true }))
  const lugar = await $.ui.open({ id: PAINEL, title: TITULO_DO_PAINEL, columns: 60 }).catch(() => undefined)
  if (lugar) await update($, janela, atual => ({ ...atual, aberto: true }))
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
async function fecharPainel($: EngineInterface, peloUsuario: boolean) {
  aberto = null
  enviadas = []
  await update($, painel, () => SEM_AGENTE)
  await update($, janela, atual => ({ ...atual, aberto: false, fechadoPeloUsuario: atual.fechadoPeloUsuario || peloUsuario }))
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

    // O `/progresso off` vale para as sessões seguintes até um `/progresso on`.
    const guardado = (await $.store.get('oculto')) === true
    await update($, oculto, () => guardado)
    // Um reload a quente mantém o estado (a sessão confere); processo novo e sessão retomada buscam no store.
    await restaurarSessao($)
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
    await fecharPainel($, false)
    await update($, janela, () => JANELA_INICIAL)
    await update($, barras, () => [])
    await update($, faixas, () => [])
    await update($, turno, () => '')
    await update($, sessao, () => '')
    proximaFerramenta.clear()
    bloqueadas.clear()

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
    const resposta = await atualizar($, e, null)
    if ('negar' in resposta) return { deny: resposta.negar }
    if (resposta.barra.passos.length >= 3) await abrirSozinho($)

    return { result: resposta.texto }
  })

  // O turno da conversa principal: a faixa só se pendura em barra mudada nele, e a banda mostra as finalizadas dele.
  on('turn.start', async ($, e, next) => {
    garantirRelogio($)
    await update($, turno, () => e.turnId)

    return next(e)
  })

  // A resposta do usuário tira a espera. No app desktop o Enter do usuário chega com origem sdk; notificação de tarefa e
  // as outras origens ficam de fora.
  on('prompt.submit', async ($, e, next) => {
    garantirRelogio($)
    await restaurarSessao($)
    if (e.origin.kind === 'composer' || e.origin.kind === 'bridge' || e.origin.kind === 'sdk') {
      if ((await read($, barras)).some(barra => barra.estado === 'esperando')) {
        await update($, barras, lista =>
          lista.map((barra): Barra => (barra.estado === 'esperando' ? { ...barra, estado: 'andamento', nota: '' } : barra)),
        )
        void guardar($)
      }
    }

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
    if (resultado.block !== undefined || e.stop_hook_active) return resultado
    const vivas = (await read($, faixas)).filter(faixa => faixa.fim === null && !demonstracao(faixa.id)).length
    if (fundo > 0 || vivas > 0) return resultado
    const lista = pendentes(await read($, barras)).filter(barra => !demonstracao(barra.id) && bloqueadas.get(barra.id) !== atual)
    if (lista.length === 0) return resultado
    for (const barra of lista) bloqueadas.set(barra.id, atual)

    return { ...resultado, block: textoDoBloqueio(lista, FERRAMENTA) }
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
      await abrirSozinho($)
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
    if (agente === undefined) return next(e)
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

  // O fechar do usuário, pela marca do painel ou pelo Esc: o painel não abre mais sozinho nesta sessão.
  on('ui.close', { id: PAINEL }, async ($, e, next) => {
    const fechou = await next(e)
    await fecharPainel($, e.origin.kind === 'person')

    return fechou
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
    const vazio = () => abaixo ?? <Caixa flexDirection="column" />
    if (e.props.hasSurvey || (await read($, oculto))) return vazio()
    const agora = await $.clock.now()
    const todas = vistas(await read($, barras), await read($, faixas), agora, await read($, turno))
    if (todas.length === 0) return vazio()

    // Passou do limite: saem primeiro as barras mais novas do demo, depois as mais velhas; sem demo, é o slice(-4) de
    // sempre. Assim o demo nunca empurra para fora uma barra de trabalho real.
    const candidatas = [...todas.filter(vista => demonstracao(vista.id)).reverse(), ...todas.filter(vista => !demonstracao(vista.id))]
    const fora = new Set(candidatas.slice(0, Math.max(0, todas.length - MAX_VISTAS)))
    const mostradas = todas.filter(vista => !fora.has(vista))
    const colunas = e.props.bodyColumns
    const escondidas =
      todas.length > mostradas.length ? `+${todas.length - mostradas.length} barras · /progresso painel mostra todas` : ''
    // Só o percentual à direita de cada barra, numa coluna fixa ("100%" cabe), clicável: abre o painel. A contagem
    // X/Y fica no painel e no resultado da ferramenta.
    // A coluna do % tem 4 colunas ("100%"), alinhada à direita: o fim dela é trilha + vão + 4 colunas, a mesma conta
    // em colunas da linha da faixa (ícone 16 px + vão + número de 2 + vão + faixa), e as duas acabam juntas.
    const percentualDe = (vista: (typeof mostradas)[number]) =>
      automatica(vista)
        ? []
        : [
            <Caixa key={`pct:${vista.id}`} width={4} flexShrink={0} justifyContent="flex-end">
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
      // A trilha vai até um vão de 8 px antes da coluna do percentual (32 px, cabe "100%"); as faixas vão até o fim
      // dessa coluna. À esquerda delas, o ícone (16), o número (24, 3 colunas) e dois vãos de 8: a faixa tem a trilha menos 16.
      // Tudo em múltiplos de 8, a célula em que o app desenha a imagem.
      const trilha = naGrade(Math.max(120, larguraUtil(colunas) - VAO - COLUNA_PCT))
      const total = trilha + VAO + COLUNA_PCT
      const larguraFaixa = total - 16 - VAO - 24 - VAO
      const linhaCheia = { flexDirection: 'row', alignItems: 'center', columnGap: 1 } as const

      return (
        <Box flexDirection="column" gap={1}>
          {!!escondidas && <Text dimColor>{escondidas}</Text>}
          {mostradas.flatMap((vista, i) => {
            const debaixo = svgDasFaixas(vista, larguraFaixa, agora, false)
            // Grupo automático: sem trilha vazia a 0%, só o rótulo, a contagem e as faixas.
            let desenho
            if (automatica(vista)) {
              const rotulo = svgDoRotulo(vista, trilha)
              desenho = <Svg key={`rotulo:${vista.id}`} source={rotulo.source} alt={rotulo.alt} width={trilha} height={rotulo.altura} />
            } else {
              const trilhaSvg = svgDaTrilha(vista, trilha, agora)
              if (trilhaSvg.desliza) assentar($, agora)
              desenho = <Svg key={`trilha:${vista.id}`} source={trilhaSvg.source} alt={trilhaSvg.alt} width={trilha} height={ALT_TRILHA} />
            }

            return [
              ...(i > 0 ? [<Svg key={`fio:${vista.id}`} source={svgDoDivisor(total)} alt="divisor" width={total} height={1} />] : []),
              <Box key={`barra:${vista.id}`} flexDirection="column">
                <Box {...linhaCheia}>
                  {desenho}
                  {percentualDe(vista)}
                </Box>
                {debaixo.map(faixa => {
                  const linha = vista.linhas.find(item => item.id === faixa.key)
                  const alt = linha && !linha.comando ? `${faixa.alt}; o número ${faixa.rotulo} abre a conversa` : faixa.alt

                  return (
                    <Box key={`linha:${vista.id}:${faixa.key}`} {...linhaCheia}>
                      {/* alt não vazio: com alt "" o app não desenha o Svg (o ícone sumia da calha ao vivo). */}
                      <Svg key={`icone:${vista.id}:${faixa.key}`} source={faixa.icone} alt={linha?.comando ? 'comando' : 'agente'} width={16} height={faixa.altura} />
                      {/* Coluna fixa de 3 colunas: o botão nativo do desktop tem respiro interno e cortava o "2" com 2 colunas. */}
                      <Box key={`numero:${vista.id}:${faixa.key}`} width={3} flexShrink={0}>
                        {numeroDaFaixa(faixa.key, faixa.rotulo, linha)}
                      </Box>
                      <Svg key={`faixa:${vista.id}:${faixa.key}`} source={faixa.source} alt={alt} width={larguraFaixa} height={faixa.altura} />
                    </Box>
                  )
                })}
              </Box>,
            ]
          })}
          {abaixo}
        </Box>
      )
    }

    const { Box, Text } = $.ui.resolve(e)
    const larguraTitulo = Math.max(8, Math.min(28, Math.floor(colunas * 0.24)))
    const larguraTrilho = Math.max(6, Math.min(20, Math.floor(colunas * 0.16)))
    // Ícone, contagem, percentual e os vãos entre eles ocupam umas 20 colunas.
    const larguraRotulo = Math.max(6, colunas - larguraTitulo - larguraTrilho - 20)

    return (
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
        {abaixo}
      </Box>
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
      await fecharPainel($, true)
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
      const largura = Math.max(240, e.props.bodyColumns * 8)
      // Id próprio: a faixa do painel tem outra largura e não disputa o desenho guardado com a da banda.
      const faixa = svgDasFaixas({ ...vista, id: `painel:${vista.id}`, linhas: [linha], ocultas: 0 }, largura, agora)[0]
      if (faixa) topo = <Svg key="topo" source={faixa.source} alt={faixa.alt} width={largura} height={faixa.altura} />
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
}
