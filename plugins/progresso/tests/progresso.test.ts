import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, SessionMessage, ToolCallInput } from 'claude-code'

import { custoDe, janelaDe } from '../hooks/precos'
import { desenhoDoTipo } from '../hooks/icones'
import { nivelDe } from '../hooks/modelo'

const FERRAMENTA = 'mcp__progresso__progresso'
const FAIXA = { hasSurvey: false, isWorking: true, maxRows: 20, bodyColumns: 110, scroll: { offset: 0, bodyRows: 20 }, view: {} }
const SUPERFICIES = ['terminal', 'desktop'] as const
// 110 colunas a 7,69 px menos 2 de folga (843), menos os 40 px da coluna do percentual, na grade de 8.
const LARGURA_DA_TRILHA = 800

/** O mundo embaixo do mod: relógio e store em memória, sons e toasts anotados. */
function mundo(on: On, loja?: Map<string, unknown>, sessao = { id: 's1' }) {
  const relogio = mock.clock(on, { now: 1_000_000 })
  if (loja) {
    on('store.get', ($, e) => ({ value: loja.get(e.key) }))
    on('store.set', ($, e) => (loja.set(e.key, e.value), { value: undefined }))
  } else mock.store(on)
  const sons: string[] = []
  const toasts: string[] = []
  const registradas: { name: string; description: string }[] = []
  const stop: { block?: string } = {}
  on('audio.play', ($, e) => (sons.push(e.clip.asset ?? ''), { value: undefined }))
  on('ui.toast', ($, e) => (toasts.push(e.text), { value: undefined }))
  on('session.id', () => ({ value: sessao.id }))
  on('tool.register', ($, e) => (registradas.push({ name: e.name, description: e.description }), { value: { tool: e.name } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('classic.PermissionRequest', () => ({}))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('classic.Stop', () => (stop.block ? { block: stop.block } : {}))
  on('prompt.compose', () => ({ sections: [] }))
  on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: 'faixa vazia' }))

  return { relogio, sons, toasts, registradas, stop }
}

let chamadas = 0
async function progresso($: Engine, entrada: Record<string, unknown>) {
  chamadas += 1
  return $.tool.call({ tool: FERRAMENTA, tool_use_id: `p${chamadas}`, ...entrada })
}

/** Uma chamada de ferramenta feita por um subagente: o `agentId` vai junto, como no evento que o engine levanta. */
const chamadaDeAgente = ($: Engine, entrada: ToolCallInput) => $.tool.call(entrada)

const comando = ($: Engine, command: string, args = '') =>
  $.command.run({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 110 } })

// Os desenhos da banda sem o ícone da calha (o Svg de 16 px antes do número clicável).
const desenhosDe = async (ui: { findAll: (q: { type: string }) => Promise<{ props: Record<string, unknown> }[]> }) =>
  (await ui.findAll({ type: 'Svg' })).filter(svg => svg.props.width !== 16)
const montar = ($: Engine, surface: 'terminal' | 'desktop') =>
  $.ui.mount({ plugin: 'progresso', surface, component: 'AbovePrompt', props: FAIXA })

const PLANO = {
  id: 'pub',
  titulo: 'Publicar página',
  etapas: [
    { nome: 'Preparar', passos: ['Ler briefing', 'Mapear seções'] },
    { nome: 'Construir', passos: ['Montar hero'] },
  ],
}

test('cria a barra, avança com proximo e reescreve o plano preservando os feitos', async ($, on) => {
  mundo(on)
  expect((await progresso($, PLANO)).result).toBe('0/3 · em andamento · ativo: Ler briefing')
  expect((await progresso($, { id: 'pub', proximo: true })).result).toBe('1/3 · em andamento · ativo: Mapear seções')

  const reescrito = await progresso($, {
    id: 'pub',
    etapas: [{ nome: 'Preparar', passos: ['Ler briefing', 'Entrevistar cliente'] }, { nome: 'Construir', passos: ['Montar hero', 'Montar oferta'] }],
  })
  expect(reescrito.result).toBe('1/4 · em andamento · ativo: Entrevistar cliente')

  for (const surface of SUPERFICIES) {
    const ui = await montar($, surface)
    if (surface === 'terminal') {
      expect(await ui.find({ type: 'Text', text: 'Publicar página' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Preparar · Entrevistar cliente' })).toBeDefined()
      expect(String((await ui.find({ key: 'painel:pub' }))?.props.label)).toContain('25%')
    } else {
      const svg = await ui.find({ type: 'Svg' })
      expect(String(svg?.props.source)).toContain('>Publicar página<tspan class="kc"> · Preparar</tspan></text>')
      expect(String(svg?.props.alt)).toContain('Preparar · Entrevistar cliente, 1 de 4, 25%')
    }
    await ui.unmount()
  }
})

test('título desconhecido sozinho é negado com a lista numerada dos passos', async ($, on) => {
  mundo(on)
  await progresso($, PLANO)
  const negado = await progresso($, { id: 'pub', feitos: ['Passo que não existe'] })
  expect(negado.deny).toContain('1. Ler briefing | 2. Mapear seções | 3. Montar hero')

  const semBarra = await progresso($, { id: 'outra', proximo: true })
  expect(semBarra.deny).toContain('não existe')
})

test('esperando, erro e concluído tocam som e avisam, sem rajada', async ($, on) => {
  const { relogio, sons, toasts } = mundo(on)
  await progresso($, PLANO)
  await progresso($, { id: 'pub', estado: 'esperando', nota: 'Qual preço?' })
  await relogio.settle()
  expect(sons).toEqual(['sounds/decisao.wav'])
  expect(toasts.at(-1)).toBe('Esperando você: Publicar página · Qual preço?')

  await relogio.advance(1000)
  await progresso($, { id: 'pub', falhou: 'Mapear seções', nota: 'sem acesso' })
  await relogio.settle()
  expect(sons).toHaveLength(1)
  expect(toasts.at(-1)).toBe('Erro: Publicar página · sem acesso')

  await relogio.advance(240_000)
  const fim = await progresso($, { id: 'pub', feitos: ['Ler briefing', 'Mapear seções', 'Montar hero'], estado: 'concluido' })
  await relogio.settle()
  expect(fim.result).toBe('3/3 · concluído · sem passo ativo')
  expect(sons.at(-1)).toBe('sounds/concluido.wav')
  expect(toasts.at(-1)).toBe('Concluído: Publicar página em 4min')
})

test('o fim do turno fecha a barra com tudo feito e para a que tem passo aberto', async ($, on) => {
  const { relogio } = mundo(on)
  await $.turn.start({ text: 'faz', turnId: 't1' })
  await progresso($, { id: 'a', titulo: 'Completa', passos: ['um'] })
  await progresso($, { id: 'a', proximo: true })
  await progresso($, { id: 'b', titulo: 'Pela metade', passos: ['um', 'dois'] })
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
  await relogio.settle()

  const ui = await montar($, 'terminal')
  expect(await ui.find({ type: 'Text', text: /Concluído em/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Parada · parou em 0/2' })).toBeDefined()
  // Parada em cinza.
  expect((await ui.find({ type: 'Text', text: '■' }))?.props.color).toBe('inactive')
  await ui.unmount()
})

test('faixa de agente nasce no despacho, mostra a ferramenta e fecha no fim do turno', async ($, on) => {
  const { relogio } = mundo(on)
  on('agent.spawn', () => ({ model: 'claude-sonnet-5', agentId: 'ag1' }))
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  let soltar = () => {}
  on('tool.call', { tool: 'Read' }, async () => {
    await new Promise<void>(resolve => (soltar = resolve))
    return { result: { type: 'text', file: { filePath: '/x', content: '', numLines: 0, startLine: 1, totalLines: 0 } } }
  })

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await progresso($, PLANO)
  await $.agent.spawn({
    tool_use_id: 'd1', prompt: 'revise', description: 'Revisar o hero', subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: true, fork: false,
  })

  const ui = await montar($, 'terminal')
  expect(await ui.find({ type: 'Text', text: 'Revisar o hero' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'sonnet 5' })).toBeDefined()

  for await (const _ of $.turn.step({ turnId: 't2', index: 0, model: 'claude-haiku-4-5-20251001', effort: 'high', messageCount: 1, agentId: 'ag1' }));
  expect(await ui.find({ type: 'Text', text: 'haiku 4.5 · alto' })).toBeDefined()

  const lendo = chamadaDeAgente($, { tool: 'Read', tool_use_id: 'r1', file_path: '/x', agentId: 'ag1' })
  await relogio.settle()
  expect(await ui.find({ type: 'Text', text: 'Read' })).toBeDefined()
  await $.classic.PermissionRequest({ tool_name: 'Read', tool_input: {}, agent_id: 'ag1' })
  expect(await ui.find({ type: 'Text', text: 'aguardando aprovação' })).toBeDefined()
  soltar()
  await lendo
  // Fim da chamada: a aprovação sai e o nome da ferramenta fica, sem piscar até a próxima chamada.
  expect(await ui.find({ type: 'Text', text: 'aguardando aprovação' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'Read' })).toBeDefined()

  // No desktop o relógio conta dentro do SVG: o segundo que passa não troca a fonte da faixa nem repete animação.
  const desktop = await montar($, 'desktop')
  const faixaDesenhada = async () => String((await desenhosDe(desktop))[1]?.props.source)
  const primeira = await faixaDesenhada()
  expect(primeira).toContain('class="sw andamento">Read</tspan></text>')
  await relogio.advance(3000)
  expect(await faixaDesenhada()).toBe(primeira)
  await desktop.unmount()
  await relogio.advance(39_000)
  await $.turn.complete({ answer: 'feito', durationMs: 42_000, isAborted: false, turnId: 't2', agentId: 'ag1', reason: 'answer' })
  expect(await ui.find({ type: 'Text', text: 'concluído' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '0:42' })).toBeDefined()

  await relogio.advance(8000)
  expect(await ui.find({ type: 'Text', text: 'Revisar o hero' })).toBeUndefined()
  await ui.unmount()
})

test('comando em background abre a faixa e a notificação da tarefa fecha', async ($, on) => {
  const { relogio, toasts } = mundo(on)
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bg1' } }))
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'npm run build', run_in_background: true })

  for (const surface of SUPERFICIES) {
    const ui = await montar($, surface)
    if (surface === 'terminal') {
      expect(await ui.find({ type: 'Text', text: 'Em background' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '$ npm run build' })).toBeDefined()
    } else {
      // Sem barra da conversa principal: rótulo discreto e a faixa, sem trilha vazia nem percentual.
      const desenhos = await desenhosDe(ui)
      expect(desenhos).toHaveLength(2)
      expect(String(desenhos[0]?.props.source)).toContain('>Em background</tspan> · 1 em execução</text>')
      expect(String(desenhos[0]?.props.source)).not.toContain('class="pl"')
      expect(desenhos[0]?.props.height).toBe(20)
      expect(String(desenhos[1]?.props.source)).toContain('npm run build')
      expect(desenhos[1]?.props.height).toBe(24)
      expect(desenhos[0]?.props.width).toBe(LARGURA_DA_TRILHA)
      expect(await ui.find({ type: 'Text', text: '  0%' })).toBeUndefined()
    }
    await ui.unmount()
  }

  await relogio.advance(65_000)
  // O kit não guarda linha nenhuma embaixo dos plugins: a chamada rejeita no fundo, depois do hook do mod.
  await $.session
    .append({
    door: 'delivery',
    origin: { kind: 'task-notification' },
    uuid: 'u1',
    message: {
      type: 'user',
      role: 'user',
      isMeta: true,
      content: [{ type: 'text', text: '<task-notification>\n<task-id>bg1</task-id>\n<tool-use-id>b1</tool-use-id>\n<status>completed</status>\n<summary>ok</summary>\n</task-notification>' }],
      },
    })
    .catch(() => undefined)
  await relogio.settle()
  expect(toasts.at(-1)).toBe('Background concluído: npm run build em 1min')

  const ui = await montar($, 'terminal')
  expect(await ui.find({ type: 'Text', text: 'concluído' })).toBeDefined()
  await ui.unmount()
})

test('a barra não tem ✕: /progresso-limpar remove a barra e a regra entra no system prompt', async ($, on) => {
  mundo(on)
  await progresso($, PLANO)
  for (const surface of SUPERFICIES) {
    const ui = await montar($, surface)
    expect((await ui.findAll({ type: 'Button' })).filter(botao => botao.props.label === '✕')).toHaveLength(0)
    await ui.unmount()
  }
  const ui = await montar($, 'desktop')
  expect(await ui.find({ type: "Svg" })).toBeDefined()
  await comando($, 'progresso-limpar')
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'faixa vazia' })).toBeDefined()
  await ui.unmount()

  const prompt = await $.prompt.compose({
    model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['desktop'], tools: [FERRAMENTA], outputStyle: null, traits: [],
  })
  const regra = prompt.sections.find(secao => secao.id === 'progresso:lista')
  expect(regra?.text).toContain('mostrar o plano ao usuário')
  expect(regra?.text.split(/\s+/).length ?? 99).toBeLessThan(75)
})

test('o demo de 30 s abre o painel e passa por todos os estados: espera, erro, conclusão, agentes e comando', async ($, on) => {
  const { relogio, sons, toasts } = mundo(on)
  const abertos: unknown[] = []
  on('ui.open', ($, e) => (abertos.push(e), { value: { isPlaced: true } }))
  await comando($, 'progresso-demo')
  const ui = await montar($, 'terminal')

  await relogio.advance(6000)
  expect(abertos).toEqual([{ id: 'progresso', title: 'Progresso', columns: 60 }])
  expect(await ui.find({ type: 'Text', text: /^Esperando você · Qual assunto/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'aguardando aprovação' })).toBeDefined()
  // O comando aparece sem o "cd <pasta> &&" da frente.
  expect(await ui.find({ type: 'Text', text: '$ npm run build -- --filter vendas' })).toBeDefined()
  // Agentes de quatro tipos rodando ao mesmo tempo, cada um com o glifo do tipo (pesquisa, design, leve e leitor).
  for (const glifo of ['⌕', '✎', '◠', '⊙']) expect(await ui.find({ type: 'Text', text: glifo })).toBeDefined()

  await relogio.advance(2000)
  expect(await ui.find({ type: 'Text', text: 'Erro · CRM recusou 12 linhas' })).toBeDefined()
  expect((await ui.findAll({ type: 'Button' })).filter(botao => String(botao.props.label).endsWith('100%'))).toHaveLength(1)

  await relogio.advance(4000)
  expect(await ui.find({ type: 'Text', text: 'falhou' })).toBeDefined()

  await relogio.advance(16_000)
  expect(toasts.at(-1)).toBe('Concluído: Publicar página de vendas em 27s')
  expect(sons.filter(som => som === 'sounds/decisao.wav')).toHaveLength(1)
  expect(sons).toContain('sounds/erro.wav')
  expect(sons.at(-1)).toBe('sounds/concluido.wav')

  await relogio.advance(3000)
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  await ui.unmount()
})

test('agente sem faixa ganha uma no primeiro evento, fecha no fim do turno e volta na retomada', async ($, on) => {
  const { relogio } = mundo(on)
  on('agent.list', () => ({
    value: [
      { id: 'ag7', description: 'Refazer o desenho', type: 'executor-design', status: 'running' },
      { id: 'ag8', description: '', type: '', status: 'running' },
    ],
  }))
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  on('tool.call', { tool: 'Read' }, () => ({
    result: { type: 'text', file: { filePath: '/x', content: '', numLines: 0, startLine: 1, totalLines: 0 } },
  }))
  const ler = (agentId: string, id: string) => chamadaDeAgente($, { tool: 'Read', tool_use_id: id, file_path: '/x', agentId })
  const fim = (agentId: string) =>
    $.turn.complete({ answer: 'feito', durationMs: 1000, isAborted: false, turnId: 't1', agentId, reason: 'answer' })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const ui = await montar($, 'terminal')

  // Sem agent.spawn: o primeiro tool.call do agente abre a faixa com a descrição que o engine lista.
  await ler('ag7', 'r1')
  expect(await ui.find({ type: 'Text', text: 'Refazer o desenho' })).toBeDefined()
  await ler('ag8', 'r2')
  const linhas = async () => (await ui.findAll({ type: 'Text', text: '├' })).length + (await ui.findAll({ type: 'Text', text: '└' })).length
  expect(await ui.findAll({ type: 'Text', text: 'Agente' })).toHaveLength(2)
  expect(await linhas()).toBe(2)
  // Fork do engine (compactação, memória) tem id que a lista não conhece: fica sem faixa.
  await ler('fork1', 'r3')
  expect(await linhas()).toBe(2)

  await fim('ag7')
  expect(await ui.find({ type: 'Text', text: 'concluído' })).toBeDefined()
  // Evento atrasado do turno que fechou não reabre.
  await ler('ag7', 'r4')
  await relogio.advance(8000)
  expect(await ui.find({ type: 'Text', text: 'Refazer o desenho' })).toBeUndefined()

  // Retomada: um turn.step novo do mesmo id reabre, já com modelo e esforço.
  for await (const _ of $.turn.step({ turnId: 't2', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 3, agentId: 'ag7' }));
  expect(await ui.find({ type: 'Text', text: 'Refazer o desenho' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'opus 5.5 · alto' })).toBeDefined()
  await ui.unmount()

  // No desktop o grupo automático leva o rótulo e a faixa, sem ✕.
  const desktop = await montar($, 'desktop')
  expect(String((await desktop.find({ type: 'Svg' }))?.props.source)).toContain('>Agentes<')
  expect((await desktop.findAll({ type: 'Button' })).filter(botao => botao.props.label === '✕')).toHaveLength(0)
  await desktop.unmount()
})

test('a demonstração deixa a barra real como estava, na faixa e no store', async ($, on) => {
  const loja = new Map<string, unknown>()
  const { relogio } = mundo(on, loja)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await progresso($, { id: 'mods', titulo: 'Mods do Claude Code', passos: ['a', 'b', 'c', 'd', 'e'] })
  const ui = await montar($, 'terminal')

  await comando($, 'progresso-demo')
  await relogio.advance(1000)
  expect(await ui.find({ type: 'Text', text: 'Publicar página de vendas' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Mods do Claude Code' })).toBeDefined()

  await relogio.advance(31_000)
  await relogio.settle()
  expect(await ui.find({ type: 'Text', text: 'Publicar página de vendas' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'Mods do Claude Code' })).toBeDefined()
  expect((await progresso($, { id: 'mods', proximo: true })).result).toBe('1/5 · em andamento · ativo: b')
  await relogio.settle()
  const sessoes = loja.get('sessoes') as Record<string, { barras: { id: string }[] }>
  expect(Object.values(sessoes).flatMap(sessao => sessao.barras.map(barra => barra.id))).toEqual(['mods'])
  await ui.unmount()
})

test('/progresso on mostra, off esconde e sem argumento alterna', async ($, on) => {
  mundo(on)
  await progresso($, PLANO)
  const ui = await montar($, 'terminal')
  const visivel = async () => (await ui.find({ type: 'Text', text: 'Publicar página' })) !== undefined

  expect((await comando($, 'progresso', 'on')).text).toBe('Barras de progresso visíveis · 1 ativa')
  expect(await visivel()).toBe(true)
  expect((await comando($, 'progresso', ' OFF ')).text).toBe('Barras de progresso escondidas · 1 ativa')
  expect(await visivel()).toBe(false)
  await comando($, 'progresso', 'off')
  expect(await visivel()).toBe(false)
  await comando($, 'progresso', 'on')
  expect(await visivel()).toBe(true)
  await comando($, 'progresso')
  expect(await visivel()).toBe(false)
  await comando($, 'progresso')
  expect(await visivel()).toBe(true)

  // O caso comum: esconde, a barra sai, e mostrar de novo não tem o que mostrar. A resposta diz isso.
  await comando($, 'progresso', 'off')
  await comando($, 'progresso-limpar')
  expect((await comando($, 'progresso')).text).toBe('Barras de progresso visíveis · nenhuma barra ativa agora')
  expect(await visivel()).toBe(false)
  await progresso($, { id: 'b2', titulo: 'Outra', passos: ['x', 'y'] })
  await progresso($, { id: 'b3', titulo: 'Mais uma', passos: ['x', 'y'] })
  expect((await comando($, 'progresso', 'on')).text).toBe('Barras de progresso visíveis · 2 ativas')
  await ui.unmount()
})

test('a pílula desliza uma vez por mudança de progresso e evento de agente não troca a fonte da trilha', async ($, on) => {
  const { relogio } = mundo(on)
  on('agent.spawn', () => ({ model: 'claude-sonnet-5', agentId: 'ag1' }))
  on('tool.call', { tool: 'Read' }, () => ({
    result: { type: 'text', file: { filePath: '/x', content: '', numLines: 0, startLine: 1, totalLines: 0 } },
  }))
  await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
  await progresso($, PLANO)
  const ui = await montar($, 'desktop')
  const trilha = async () => String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(await trilha()).not.toContain('<animate')

  // Mudança de progresso: a fonte leva o deslize da posição antiga à nova enquanto ele toca.
  await progresso($, { id: 'pub', proximo: true })
  const deslizando = await trilha()
  expect(deslizando).toContain('<animateTransform')
  expect(deslizando).toContain('<animate attributeName="width"')

  // Passado o deslize, o redesenho que o próprio mod pede troca para a fonte parada, e ela não muda mais.
  await relogio.advance(500)
  const parada = await trilha()
  expect(parada).not.toContain('<animate')
  await relogio.advance(3000)
  expect(await trilha()).toBe(parada)

  // Agente novo, ferramenta nova e tique do relógio das faixas: a trilha fica com a mesma fonte.
  await $.agent.spawn({
    tool_use_id: 'd1', prompt: 'revise', description: 'Revisar o hero', subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: true, fork: false,
  })
  await chamadaDeAgente($, { tool: 'Read', tool_use_id: 'r1', file_path: '/x', agentId: 'ag1' })
  expect(await desenhosDe(ui)).toHaveLength(2)
  expect(await trilha()).toBe(parada)
  await relogio.advance(2000)
  expect(await trilha()).toBe(parada)
  await ui.unmount()
})

const PAINEL = { title: 'Revisar o hero', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const
const CONVERSA: SessionMessage[] = [
  { role: 'user', text: 'Revise o hero da página de vendas.', toolUses: [] },
  { role: 'assistant', text: 'Vou ler o arquivo do hero.', toolUses: [{ tool_use_id: 'u1', tool: 'Read', input: { file_path: '/site/hero.tsx' } }] },
]

/** O que o painel usa embaixo do mod: lugar para abrir, a conversa do agente, rolagem e envio. */
function mundoDoPainel(on: On, conversa: SessionMessage[] | { deny: string } = CONVERSA) {
  const abertos: { id: string; title?: string; focus?: true; closeOnEscape?: true }[] = []
  const fechados: string[] = []
  const enviados: { to: string; text: string }[] = []
  const lidos: (string | undefined)[] = []
  const entrega: { recusa: string; antes?: () => Promise<unknown> } = { recusa: '' }
  on('agent.spawn', () => ({ model: 'claude-sonnet-5', agentId: 'ag1' }))
  on('ui.open', ($, e) => (abertos.push(e), { value: { isPlaced: true } }))
  on('ui.close', ($, e) => (fechados.push(e.id), { value: undefined }))
  on('ui.scroll', () => ({}))
  on('session.messages', ($, e) => (lidos.push(e.agentId), { value: conversa }))
  on('session.send', async ($, e) => {
    enviados.push({ to: e.to, text: e.text })
    // O que acontece no meio da entrega, antes de ela responder (a linha do agente chegando antes).
    if (entrega.antes) await entrega.antes()
    return entrega.recusa ? { isDelivered: false, reason: entrega.recusa } : { isDelivered: true }
  })

  return { abertos, fechados, enviados, lidos, entrega }
}

const despachar = ($: Engine) =>
  $.agent.spawn({
    tool_use_id: 'd1', prompt: 'revise', description: 'Revisar o hero', subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: true, fork: false,
  })

const montarPainel = ($: Engine, surface: 'terminal' | 'desktop') =>
  $.ui.mount({ plugin: 'progresso', surface, component: 'Pane', requestId: 'progresso', props: PAINEL })

const linhaDoAgente = ($: Engine, agentId: string, uuid: string, texto: string) =>
  $.session
    .append({
      door: 'response',
      origin: { kind: 'model', model: 'claude-sonnet-5' },
      uuid,
      agentId,
      message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: texto }] },
    })
    .catch(() => undefined)

test('o "abrir" da faixa de agente abre o painel com a conversa dele; faixa de comando não tem o botão', async ($, on) => {
  mundo(on)
  const { abertos, lidos } = mundoDoPainel(on)
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bg1' } }))
  await despachar($)
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'npm run build', run_in_background: true })

  for (const surface of SUPERFICIES) {
    const faixa = await montar($, surface)
    expect(await faixa.find({ key: 'abrir:bg1' })).toBeUndefined()
    await faixa.press({ key: 'abrir:ag1' })
    await faixa.unmount()
    expect(abertos.at(-1)).toEqual({ id: 'progresso', title: 'Progresso', focus: true, closeOnEscape: true, columns: 60 })
    expect(lidos.at(-1)).toBe('ag1')

    const painel = await montarPainel($, surface)
    expect(await painel.find({ type: 'Text', text: 'Revise o hero da página de vendas.' })).toBeDefined()
    expect(String((await painel.find({ type: 'Markdown' }))?.props.text)).toBe('Vou ler o arquivo do hero.')
    expect(await painel.find({ type: 'Text', text: '› Read · /site/hero.tsx' })).toBeDefined()
    expect(await painel.find({ key: 'msg' })).toBeDefined()
    if (surface === 'desktop') expect(String((await painel.find({ type: 'Svg' }))?.props.alt)).toBe('agente Revisar o hero: em andamento')
    await painel.unmount()
  }
})

test('linha nova do agente aberto entra na cauda, a de outro agente não, e a cauda para em 200', async ($, on) => {
  mundo(on)
  mundoDoPainel(on)
  await despachar($)
  const faixa = await montar($, 'desktop')
  await faixa.press({ key: 'abrir:ag1' })
  await faixa.unmount()
  const painel = await montarPainel($, 'desktop')
  const respostas = async () => (await painel.findAll({ type: 'Markdown' })).map(item => String(item.props.text))

  await linhaDoAgente($, 'ag1', 'l1', 'Achei o título repetido.')
  await linhaDoAgente($, 'ag2', 'l2', 'Linha de outro agente.')
  await $.session
    .append({ door: 'response', origin: { kind: 'model', model: 'claude-sonnet-5' }, uuid: 'l3', message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: 'Linha da conversa principal.' }] } })
    .catch(() => undefined)
  expect(await respostas()).toEqual(['Vou ler o arquivo do hero.', 'Achei o título repetido.'])

  for (let i = 0; i < 205; i++) await linhaDoAgente($, 'ag1', `m${i}`, `Passo ${i}`)
  const cauda = await respostas()
  expect(cauda).toHaveLength(200)
  expect(cauda.at(-1)).toBe('Passo 204')
  await painel.unmount()
})

test('o campo do painel manda a mensagem ao agente aberto e a recusa vira toast com o motivo', async ($, on) => {
  const { toasts } = mundo(on)
  const { enviados, entrega } = mundoDoPainel(on)
  await despachar($)

  for (const surface of SUPERFICIES) {
    const faixa = await montar($, surface)
    await faixa.press({ key: 'abrir:ag1' })
    await faixa.unmount()
    const painel = await montarPainel($, surface)

    await painel.input({ key: 'msg', text: '  pare depois deste arquivo  ' })
    expect(enviados.at(-1)?.to).toBe('ag1')
    expect(enviados.at(-1)?.text).toBe('Mensagem do usuário, pelo painel do agente: pare depois deste arquivo')
    expect(await painel.find({ type: 'Text', text: 'pare depois deste arquivo' })).toBeDefined()

    // A mensagem volta como linha da conversa do agente: não aparece duas vezes.
    await $.session
      .append({ door: 'delivery', origin: { kind: 'model', model: 'claude-sonnet-5' }, uuid: `e:${surface}`, agentId: 'ag1', message: { type: 'user', role: 'user', isMeta: true, content: [{ type: 'text', text: '<message>Mensagem do usuário, pelo painel do agente: pare depois deste arquivo</message>' }] } })
      .catch(() => undefined)
    expect(await painel.findAll({ type: 'Text', text: /pare depois deste arquivo/ })).toHaveLength(1)

    const antes = enviados.length
    await painel.input({ key: 'msg', text: '   ' })
    expect(enviados).toHaveLength(antes)

    entrega.recusa = 'agente ag1 já encerrou'
    await painel.input({ key: 'msg', text: 'ainda está aí?' })
    expect(toasts.at(-1)).toBe('Mensagem não entregue ao agente: agente ag1 já encerrou')
    expect(await painel.find({ type: 'Text', text: 'ainda está aí?' })).toBeUndefined()
    entrega.recusa = ''
    await painel.unmount()
  }
})

test('conversa que a sessão não consegue ler vira uma linha no painel, e fechar o painel solta a cauda', async ($, on) => {
  mundo(on)
  mundoDoPainel(on, { deny: 'agent ag1 runs in another process' })
  await despachar($)
  const faixa = await montar($, 'desktop')
  await faixa.press({ key: 'abrir:ag1' })
  await faixa.unmount()

  const painel = await montarPainel($, 'desktop')
  expect(await painel.find({ type: 'Text', text: 'A sessão não consegue ler a conversa deste agente: agent ag1 runs in another process' })).toBeDefined()
  expect(await painel.find({ type: 'Markdown' })).toBeUndefined()
  // Sem a conversa antiga o painel ainda mostra o que chega e ainda envia.
  await linhaDoAgente($, 'ag1', 'l1', 'Terminei a revisão.')
  expect(String((await painel.find({ type: 'Markdown' }))?.props.text)).toBe('Terminei a revisão.')
  expect(await painel.find({ key: 'msg' })).toBeDefined()

  await painel.press({ key: 'fechar-painel' })
  await linhaDoAgente($, 'ag1', 'l2', 'Linha depois de fechar.')
  expect(await painel.find({ type: 'Markdown' })).toBeUndefined()
  expect(await painel.find({ type: 'Text', text: /Nenhuma tarefa ainda/ })).toBeDefined()
  await painel.unmount()
})

// Correções da crítica final, uma por item.

test('1. o envio do usuário no desktop chega como sdk e tira a espera; notificação de tarefa não mexe', async ($, on) => {
  mundo(on)
  on('prompt.submit', ($, e) => ({ text: e.text }))
  await $.turn.start({ text: 'faz', turnId: 't1' })
  await progresso($, { id: 'a', titulo: 'Já feita', passos: ['um'] })
  await progresso($, { id: 'a', estado: 'concluido' })
  await progresso($, { id: 'b', titulo: 'Na espera', passos: ['um'] })
  await progresso($, { id: 'b', estado: 'esperando', nota: 'qual preço?' })
  const ui = await montar($, 'terminal')

  await $.prompt.submit({ text: 'tarefa terminou', wait: false, origin: { kind: 'task-notification' } })
  expect(await ui.find({ type: 'Text', text: 'Já feita' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Esperando você · qual preço?' })).toBeDefined()

  await $.prompt.submit({ text: 'R$ 97', wait: false, origin: { kind: 'sdk' } })
  expect(await ui.find({ type: 'Text', text: /Esperando você/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'Na espera' })).toBeDefined()
  // A concluída sai da banda só no turno seguinte, e continua endereçável.
  expect(await ui.find({ type: 'Text', text: 'Já feita' })).toBeDefined()
  await $.turn.start({ text: 'R$ 97', turnId: 't2' })
  expect(await ui.find({ type: 'Text', text: 'Já feita' })).toBeUndefined()
  expect((await progresso($, { id: 'a', nota: 'retomando' })).result).toBe('1/1 · em andamento · sem passo ativo')
  expect(await ui.find({ type: 'Text', text: 'Já feita' })).toBeDefined()
  await ui.unmount()
})

test('2. chamada de subagente responde sucesso curto sem criar barra, e a regra diz que a lista é da conversa principal', async ($, on) => {
  mundo(on)
  await progresso($, PLANO)
  const doAgente = await progresso($, { id: 'sub', titulo: 'Barra do subagente', passos: ['x'], agentId: 'ag9' })
  expect(doAgente.deny).toBeUndefined()
  expect(String(doAgente.result)).toContain('conversa principal')
  // Nem atualização de uma barra da principal muda nada.
  await progresso($, { id: 'pub', proximo: true, agentId: 'ag9' })

  const ui = await montar($, 'terminal')
  expect(await ui.find({ type: 'Text', text: 'Barra do subagente' })).toBeUndefined()
  expect(String((await ui.find({ key: 'painel:pub' }))?.props.label)).toContain('0%')
  expect(await ui.find({ key: 'contagem:pub' })).toBeUndefined()
  await ui.unmount()

  const prompt = await $.prompt.compose({
    model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['desktop'], tools: [FERRAMENTA], outputStyle: null, traits: [],
  })
  expect(prompt.sections.find(secao => secao.id === 'progresso:lista')?.text).toContain('subagente não chama')
})

test('3. mudar a largura da faixa não faz a pílula deslizar', async ($, on) => {
  const { relogio } = mundo(on)
  await progresso($, PLANO)
  await progresso($, { id: 'pub', proximo: true })
  const largo = await montar($, 'desktop')
  await relogio.advance(500)
  expect(String((await largo.find({ type: 'Svg' }))?.props.source)).not.toContain('<animate')
  await largo.unmount()

  // O painel docado estreita a faixa; fechar devolve a largura.
  for (const bodyColumns of [80, 110, 80]) {
    const ui = await $.ui.mount({ plugin: 'progresso', surface: 'desktop', component: 'AbovePrompt', props: { ...FAIXA, bodyColumns } })
    expect(String((await ui.find({ type: 'Svg' }))?.props.source)).not.toContain('<animate')
    await ui.unmount()
    await relogio.advance(100)
  }
})

const despacharComo = ($: Engine, id: string) =>
  $.agent.spawn({
    tool_use_id: id, prompt: 'x', description: `Agente ${id}`, subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: true, fork: false,
  })

test('4. agente despachado antes da barra fica embaixo dela, sem barra automática', async ($, on) => {
  mundo(on)
  on('agent.spawn', ($, e) => ({ model: 'claude-sonnet-5', agentId: e.tool_use_id }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bg1' } }))
  // O agente e o comando nascem sem barra; a barra da conversa principal chega depois.
  await despacharComo($, 'a1')
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'npm run build', run_in_background: true })
  await progresso($, PLANO)

  const desktop = await montar($, 'desktop')
  const desenhos = await desenhosDe(desktop)
  expect(desenhos).toHaveLength(3)
  expect(String(desenhos[0]?.props.source)).toContain('>Publicar página<')
  expect(String(desenhos[1]?.props.source)).toContain('Agente a1')
  expect(String(desenhos[2]?.props.source)).toContain('npm run build')
  expect(desenhos.some(svg => String(svg.props.source).includes('>Agentes<'))).toBe(false)
  expect((await desktop.findAll({ type: 'Button' })).filter(botao => botao.props.label === '✕')).toHaveLength(0)
  // Limpar leva junto as faixas que ficaram embaixo da barra.
  await comando($, 'progresso-limpar')
  expect(await desktop.find({ type: 'Svg' })).toBeUndefined()
  await desktop.unmount()

  const terminal = await montar($, 'terminal')
  expect(await terminal.find({ type: 'Text', text: 'Agentes' })).toBeUndefined()
  await terminal.unmount()
})

test('4b. sem barra principal as faixas aparecem sozinhas com um rótulo, sem trilha a 0%', async ($, on) => {
  mundo(on)
  on('agent.spawn', ($, e) => ({ model: 'claude-sonnet-5', agentId: e.tool_use_id }))
  await despacharComo($, 'a1')

  const desktop = await montar($, 'desktop')
  const desenhos = await desenhosDe(desktop)
  expect(desenhos).toHaveLength(2)
  expect(String(desenhos[0]?.props.source)).toContain('>Agentes</tspan> · 1 em execução</text>')
  expect(desenhos.every(svg => !String(svg.props.source).includes('class="pl"'))).toBe(true)
  expect(await desktop.find({ type: 'Text', text: '  0%' })).toBeUndefined()
  expect((await desktop.findAll({ type: 'Button' })).filter(botao => botao.props.label === '✕')).toHaveLength(0)
  await desktop.unmount()

  const terminal = await montar($, 'terminal')
  expect(await terminal.find({ type: 'Text', text: 'Agentes' })).toBeDefined()
  expect(await terminal.find({ type: 'Text', text: '0%' })).toBeUndefined()
  expect(await terminal.find({ type: 'Text', text: '─'.repeat(17) })).toBeUndefined()
  await terminal.unmount()

  // A barra que chega depois recolhe a faixa: o rótulo sai.
  await progresso($, PLANO)
  const depois = await montar($, 'desktop')
  expect(String((await depois.findAll({ type: 'Svg' }))[0]?.props.source)).toContain('>Publicar página<')
  expect(String((await depois.findAll({ type: 'Svg' }))[0]?.props.source)).not.toContain('>Agentes<')
  await depois.unmount()
})

/** Agente ag1 despachado e chamadas de ferramenta que só terminam quando o teste solta. */
function agenteComFerramentas(on: On) {
  on('agent.spawn', () => ({ model: 'claude-sonnet-5', agentId: 'ag1' }))
  const soltar = new Map<string, () => void>()
  on('tool.call', async ($, e) => {
    await new Promise<void>(resolve => soltar.set(e.tool_use_id, resolve))
    return { result: { type: 'text', file: { filePath: '/x', content: '', numLines: 0, startLine: 1, totalLines: 0 } } } as never
  })

  return soltar
}

test('5. com chamadas paralelas o nome da ferramenta fica pelo menos 1 s antes de trocar', async ($, on) => {
  const { relogio } = mundo(on)
  const soltar = agenteComFerramentas(on)
  await despacharAgente($)
  const ui = await montar($, 'terminal')
  const emCurso: Promise<unknown>[] = []
  const chamar = (tool: string, id: string) => emCurso.push($.tool.call({ tool, tool_use_id: id, file_path: '/x', pattern: 'x', agentId: 'ag1' } as never))

  chamar('Read', 'c1')
  await relogio.settle()
  expect(await ui.find({ type: 'Text', text: 'Read' })).toBeDefined()
  await relogio.advance(100)
  chamar('Grep', 'c2')
  await relogio.settle()
  chamar('Glob', 'c3')
  await relogio.settle()
  expect(await ui.find({ type: 'Text', text: 'Read' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Glob' })).toBeUndefined()

  // Passado 1 s do Read, entra a última pedida, sem passar pelo Grep.
  await relogio.advance(950)
  expect(await ui.find({ type: 'Text', text: 'Glob' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Read' })).toBeUndefined()
  for (const solta of soltar.values()) solta()
  await Promise.all(emCurso)
  await ui.unmount()
})

test('6. a aprovação sai quando a chamada termina, mesmo com outra chamada paralela por cima', async ($, on) => {
  const { relogio } = mundo(on)
  const soltar = agenteComFerramentas(on)
  await despacharAgente($)
  const ui = await montar($, 'terminal')

  const primeira = chamadaDeAgente($, { tool: 'Bash', tool_use_id: 'c1', command: 'ls', agentId: 'ag1' })
  await relogio.settle()
  const segunda = chamadaDeAgente($, { tool: 'Read', tool_use_id: 'c2', file_path: '/x', agentId: 'ag1' })
  await relogio.settle()
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'ls' }, agent_id: 'ag1' })
  expect(await ui.find({ type: 'Text', text: 'aguardando aprovação' })).toBeDefined()

  soltar.get('c1')?.()
  await primeira
  expect(await ui.find({ type: 'Text', text: 'aguardando aprovação' })).toBeUndefined()
  soltar.get('c2')?.()
  await segunda
  await ui.unmount()
})

const despacharAgente = ($: Engine) =>
  $.agent.spawn({
    tool_use_id: 'd1', prompt: 'revise', description: 'Revisar o hero', subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: true, fork: false,
  })

async function abrirPainelDoAgente($: Engine) {
  const faixa = await montar($, 'desktop')
  await faixa.press({ key: 'abrir:ag1' })
  await faixa.unmount()

  return montarPainel($, 'desktop')
}

test('7. com o agente terminado o campo do painel avisa que enviar retoma o agente', async ($, on) => {
  mundo(on)
  mundoDoPainel(on)
  await despacharAgente($)
  const painel = await abrirPainelDoAgente($)
  expect((await painel.find({ key: 'msg' }))?.props.placeholder).toBe('Mensagem para o agente')

  await $.turn.complete({ answer: 'feito', durationMs: 10, isAborted: false, turnId: 't1', agentId: 'ag1', reason: 'answer' })
  expect((await painel.find({ key: 'msg' }))?.props.placeholder).toBe('Agente terminado: enviar retoma o agente')
  await painel.unmount()
})

test('8. o eco que volta antes da entrega responder não duplica, e envio curto não engole linha que o contém', async ($, on) => {
  mundo(on)
  const { entrega } = mundoDoPainel(on)
  await despacharAgente($)
  const painel = await abrirPainelDoAgente($)
  const chegou = (uuid: string, texto: string) =>
    $.session
      .append({ door: 'delivery', origin: { kind: 'model', model: 'claude-sonnet-5' }, uuid, agentId: 'ag1', message: { type: 'user', role: 'user', isMeta: true, content: [{ type: 'text', text: texto }] } })
      .catch(() => undefined)

  entrega.antes = () => chegou('e1', '<message>Mensagem do usuário, pelo painel do agente: revise o rodapé</message>')
  await painel.input({ key: 'msg', text: 'revise o rodapé' })
  expect(await painel.findAll({ type: 'Text', text: /revise o rodapé/ })).toHaveLength(1)

  entrega.antes = undefined
  await painel.input({ key: 'msg', text: 'ok' })
  await chegou('e2', 'Resultado do teste: tudo ok por aqui')
  expect(await painel.find({ type: 'Text', text: 'Resultado do teste: tudo ok por aqui' })).toBeDefined()
  await painel.unmount()
})

test('10. um desenho que termina depois de outro mais novo não volta a pílula para trás nem refaz o deslize', async ($, on) => {
  // Embaixo do mod, o desenho dos outros: o primeiro depois do sinal demora, e o progresso anda nesse meio-tempo.
  const segurar: { ativo: boolean; soltar?: () => void } = { ativo: false }
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (segurar.ativo) {
      segurar.ativo = false
      await new Promise<void>(resolve => (segurar.soltar = resolve))
    }
    return next(e)
  })
  const { relogio } = mundo(on)
  await progresso($, PLANO)
  const ui = await montar($, 'desktop')
  await relogio.advance(500)
  const fonte = async () => String((await ui.find({ type: 'Svg' }))?.props.source)
  const deslize = (svg: string) => (/from="([\d.]+) 0" to="([\d.]+) 0"/.exec(svg) ?? []).slice(1).map(Number)

  segurar.ativo = true
  await progresso($, { id: 'pub', proximo: true })
  const velho = fonte()
  await relogio.settle()
  await progresso($, { id: 'pub', proximo: true })
  await fonte()
  segurar.soltar?.()
  const [de = 0, para = 0] = deslize(await velho)
  expect(de).toBeLessThanOrEqual(para)

  await relogio.advance(500)
  expect(await fonte()).not.toContain('<animate')
  await ui.unmount()
})

test('11. /resume no mesmo processo não leva as barras de uma sessão para a outra', async ($, on) => {
  const loja = new Map<string, unknown>()
  const sessao = { id: 's1' }
  const { relogio } = mundo(on, loja, sessao)
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
  await progresso($, PLANO)
  await relogio.settle()

  await $.session.end({ reason: 'resume', sessionId: 's1', resume: { id: 's1' } })
  sessao.id = 's2'
  const ui = await montar($, 'terminal')
  expect(await ui.find({ type: 'Text', text: 'Publicar página' })).toBeUndefined()

  // De volta à s1: as barras dela voltam no primeiro envio.
  await $.session.end({ reason: 'resume', sessionId: 's2', resume: { id: 's2' } })
  sessao.id = 's1'
  await $.prompt.submit({ text: 'continua', wait: false, origin: { kind: 'composer' } })
  expect(await ui.find({ type: 'Text', text: 'Publicar página' })).toBeDefined()
  await ui.unmount()
})

test('12. argumento desconhecido do /progresso responde o uso e não mexe na visibilidade', async ($, on) => {
  mundo(on)
  await progresso($, PLANO)
  const ui = await montar($, 'terminal')

  expect((await comando($, 'progresso', 'xyz')).text).toBe(
    'use /progresso on para mostrar, /progresso off para esconder, /progresso sem nada para alternar ou /progresso painel para o painel lateral.',
  )
  expect(await ui.find({ type: 'Text', text: 'Publicar página' })).toBeDefined()
  await comando($, 'progresso', 'off')
  await comando($, 'progresso', 'xyz')
  expect(await ui.find({ type: 'Text', text: 'Publicar página' })).toBeUndefined()
  await ui.unmount()
})

test('13. /progresso off vale para as sessões seguintes e /progresso on desfaz', async ($, on) => {
  const loja = new Map<string, unknown>()
  mundo(on, loja)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await comando($, 'progresso', 'off')
  expect(loja.get('oculto')).toBe(true)
  await comando($, 'progresso', 'on')
  expect(loja.get('oculto')).toBe(false)
  await comando($, 'progresso')
  expect(loja.get('oculto')).toBe(true)
})

test('13b. sessão nova com o off guardado começa escondida, e o on mostra e guarda', async ($, on) => {
  const loja = new Map<string, unknown>([['oculto', true]])
  mundo(on, loja)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await progresso($, PLANO)
  const ui = await montar($, 'terminal')
  expect(await ui.find({ type: 'Text', text: 'Publicar página' })).toBeUndefined()

  expect((await comando($, 'progresso', 'on')).text).toBe('Barras de progresso visíveis · 1 ativa')
  expect(await ui.find({ type: 'Text', text: 'Publicar página' })).toBeDefined()
  expect(loja.get('oculto')).toBe(false)
  await ui.unmount()
})

test('14. o fim da sessão para o demo e fecha o painel do agente aberto', async ($, on) => {
  const { relogio } = mundo(on)
  const { fechados } = mundoDoPainel(on)
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  await despachar($)
  const faixa = await montar($, 'desktop')
  await faixa.press({ key: 'abrir:ag1' })
  await faixa.unmount()
  await comando($, 'progresso-demo')
  await relogio.advance(1000)

  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  expect(fechados).toEqual(['progresso'])
  const painel = await montarPainel($, 'terminal')
  expect(await painel.find({ key: 'msg' })).toBeUndefined()
  await painel.unmount()

  // Os passos do demo que faltavam não voltam a criar barras depois do fim.
  const ui = await montar($, 'terminal')
  await relogio.advance(35_000)
  await relogio.settle()
  expect(await ui.find({ type: 'Text', text: 'Publicar página de vendas' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'Importar leads de setembro' })).toBeUndefined()
  await ui.unmount()
})

test('15. no desktop a trilha vai até o vão antes do %, e as faixas até o fim da coluna do %; o número abre a conversa', async ($, on) => {
  mundo(on)
  on('agent.spawn', () => ({ model: 'claude-sonnet-5', agentId: 'ag1' }))
  await progresso($, PLANO)
  await despachar($)
  const ui = await montar($, 'desktop')
  const desenhos = await desenhosDe(ui)
  const trilha = Number(desenhos[0]?.props.width)
  const faixa = Number(desenhos[1]?.props.width)
  // Mesma conta em colunas nas duas linhas: trilha + vão + coluna de 4 do % = ícone 16 + vão + número de 2 + vão +
  // faixa. Com o número em 3 colunas (24) e a faixa = trilha − 16, a diferença entre os dois fins é 24 − (px de 3 colunas), ~1 px no app.
  expect(faixa).toBe(trilha - 16)
  expect(trilha % 8).toBe(0)
  const pct = caixasCom(await ui.drawn(), ['Button']).find(caixa => caixa.props?.width === 4)
  expect(pct?.props?.justifyContent).toBe('flex-end')
  expect(filhos(pct)[0]?.props?.label).toContain('0%')
  const linhaDaBarra = caixasCom(await ui.drawn(), ['Svg', 'Box']).find(caixa => filhos(caixa).length === 2)
  expect(linhaDaBarra?.props?.columnGap).toBe(1)
  // Nada de "abrir" à direita: o número da calha é o Button, apagado e com realce no hover.
  expect((await ui.findAll({ type: 'Button' })).some(botao => botao.props.label === 'abrir')).toBe(false)
  const numero = await ui.find({ key: 'abrir:ag1' })
  expect(String(numero?.props.label).trim()).toBe('1')
  expect(numero?.props.dimColor).toBe(true)
  // O realce do hover (hover={{ dimColor: false, bold: true }}) é aplicado pela superfície; a árvore do kit não o expõe.
  expect(String(desenhos[1]?.props.alt)).toContain('abre a conversa')
  // Linha da faixa: ícone, a coluna fixa de 2 com o número, e a faixa.
  const linha = caixasCom(await ui.drawn(), ['Svg', 'Box']).find(caixa => filhos(caixa).length === 3)
  expect(filhos(linha).map(f => f.type)).toEqual(['Svg', 'Box', 'Svg'])
  expect(filhos(linha)[1]?.props?.width).toBe(3)
  expect(filhos(filhos(linha)[1])[0]?.type).toBe('Button')
  await ui.unmount()
})

// Correções e ampliação de 2026-10-08: um teste ou mais por critério.

const SEM_FUNDO = { stop_hook_active: false, background_tasks: [] }
const fimDoTurnoPrincipal = ($: Engine, turnId: string, reason: 'answer' | 'aborted' | 'error' = 'answer') =>
  $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: reason === 'aborted', turnId, reason })

test('A1. o Stop pede uma vez por barra por turno para fechar a barra aberta; background, stop_hook_active e bloqueio de baixo passam', async ($, on) => {
  const { stop } = mundo(on)
  on('agent.spawn', ($, e) => ({ model: 'claude-sonnet-5', agentId: e.tool_use_id }))
  await $.turn.start({ text: 'faz', turnId: 't1' })
  await progresso($, PLANO)
  await progresso($, { id: 'pub', proximo: true })

  const pedido = await $.classic.Stop(SEM_FUNDO)
  expect(pedido.block).toContain('"Publicar página" (id pub) está em 1/3')
  expect(pedido.block).toContain('abertos: Mapear seções | Montar hero')
  expect(pedido.block).toContain('estado "concluido"')
  expect(pedido.block).toContain('"esperando"')
  expect(pedido.block).toContain('falhou')
  // No mesmo turno, não pede de novo.
  expect((await $.classic.Stop(SEM_FUNDO)).block).toBeUndefined()

  await $.turn.start({ text: 'segue', turnId: 't2' })
  expect((await $.classic.Stop({ stop_hook_active: true, background_tasks: [] })).block).toBeUndefined()
  const fundo = [{ id: 'b1', type: 'shell', status: 'running', description: 'npm run build' }]
  expect((await $.classic.Stop({ stop_hook_active: false, background_tasks: fundo })).block).toBeUndefined()
  // O bloqueio de um hook de Stop do settings.json vale sozinho, sem o do mod por cima.
  stop.block = 'Rode os testes antes de encerrar.'
  expect((await $.classic.Stop(SEM_FUNDO)).block).toBe('Rode os testes antes de encerrar.')
  stop.block = undefined
  // Faixa de agente rodando também conta como background.
  await despacharComo($, 'a1')
  expect((await $.classic.Stop(SEM_FUNDO)).block).toBeUndefined()
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 'x', agentId: 'a1', reason: 'answer' })
  expect((await $.classic.Stop(SEM_FUNDO)).block).toContain('1/3')
  // Subagente nunca recebe o pedido.
  await $.turn.start({ text: 'mais', turnId: 't3' })
  expect((await $.classic.Stop({ ...SEM_FUNDO, agent_id: 'a9' })).block).toBeUndefined()
})

test('A1. o fim do turno sem fechamento para a barra em X/Y; com background ela espera com contador', async ($, on) => {
  const { relogio } = mundo(on)
  on('agent.spawn', ($, e) => ({ model: 'claude-sonnet-5', agentId: e.tool_use_id }))
  await $.turn.start({ text: 'faz', turnId: 't1' })
  await progresso($, { id: 'a', titulo: 'Com agente', passos: ['um', 'dois', 'três'] })
  await progresso($, { id: 'a', proximo: true })
  await despacharComo($, 'a1')
  // O Stop vê o agente em background: a barra fica em andamento, esperando por ele.
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [{ id: 'a1', type: 'subagent', status: 'running', description: 'Agente a1' }] })
  await fimDoTurnoPrincipal($, 't1')
  await relogio.settle()
  const ui = await montar($, 'terminal')
  expect(await ui.find({ type: 'Text', text: 'aguardando 1 em background' })).toBeDefined()
  expect(String((await ui.find({ key: 'painel:a' }))?.props.label)).toContain('33%')

  // O agente termina, a notificação acorda o turno, e o modelo encerra sem fechar a barra: ela para em 1/3.
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 'x', agentId: 'a1', reason: 'answer' })
  await $.turn.start({ text: '', turnId: 't2' })
  await $.classic.Stop(SEM_FUNDO)
  await fimDoTurnoPrincipal($, 't2')
  expect(await ui.find({ type: 'Text', text: 'Parada · parou em 1/3' })).toBeDefined()
  // No turno seguinte a parada sai da banda; a próxima atualização a reabre.
  await $.turn.start({ text: 'continua', turnId: 't3' })
  expect(await ui.find({ type: 'Text', text: 'Com agente' })).toBeUndefined()
  expect((await progresso($, { id: 'a', proximo: true })).result).toBe('2/3 · em andamento · ativo: três')
  expect(await ui.find({ type: 'Text', text: 'Com agente' })).toBeDefined()
  await ui.unmount()
})

test('A1. turno interrompido ou com erro de API para a barra; tudo feito fecha em qualquer estado não final', async ($, on) => {
  const { relogio, sons } = mundo(on)
  await $.turn.start({ text: 'faz', turnId: 't1' })
  await progresso($, { id: 'i', titulo: 'Interrompida', passos: ['um', 'dois'] })
  await fimDoTurnoPrincipal($, 't1', 'aborted')
  await $.turn.start({ text: 'faz', turnId: 't2' })
  await progresso($, { id: 'e', titulo: 'Com erro', passos: ['um', 'dois'] })
  await fimDoTurnoPrincipal($, 't2', 'error')
  await $.turn.start({ text: 'faz', turnId: 't3' })
  await progresso($, { id: 'w', titulo: 'Esperando feita', passos: ['um'] })
  await progresso($, { id: 'w', feitos: ['um'], estado: 'esperando', nota: 'ok?' })
  await relogio.advance(4000)
  await fimDoTurnoPrincipal($, 't3')
  await relogio.settle()

  const ui = await montar($, 'terminal')
  expect(await ui.find({ type: 'Text', text: /Concluído em/ })).toBeDefined()
  expect(sons).toContain('sounds/concluido.wav')
  await ui.unmount()
  // As paradas guardam o motivo: a atualização seguinte responde a partir delas.
  expect((await progresso($, { id: 'i', nota: 'retomo' })).result).toBe('0/2 · em andamento · ativo: um')
  const painel = await $.ui.mount({ plugin: 'progresso', surface: 'terminal', component: 'Pane', requestId: 'progresso', props: PAINEL })
  expect(await painel.find({ type: 'Text', text: 'retomo' })).toBeDefined()
  await painel.unmount()
  expect((await progresso($, { id: 'e', nota: 'de novo' })).result).toContain('em andamento')
})

test('A2. concluido com passos abertos marca pulados: a % é feitos/total e a banda mostra os pulados', async ($, on) => {
  mundo(on)
  await progresso($, { id: 'p', titulo: 'Cinco passos', passos: ['a', 'b', 'c', 'd', 'e'] })
  await progresso($, { id: 'p', proximo: true })
  await progresso($, { id: 'p', proximo: true })
  expect((await progresso($, { id: 'p', estado: 'concluido' })).result).toBe('3/5 · concluído · 2 pulados · sem passo ativo')

  const terminal = await montar($, 'terminal')
  // A banda não mostra mais a contagem nem os pulados: só o % (os pulados ficam no painel e na ferramenta).
  expect(await terminal.find({ key: 'contagem:p' })).toBeUndefined()
  expect(await terminal.find({ type: 'Text', text: /pulado/ })).toBeUndefined()
  expect(String((await terminal.find({ key: 'painel:p' }))?.props.label)).toContain('60%')
  expect(String((await terminal.find({ key: 'painel:p' }))?.props.label)).not.toContain('100%')
  await terminal.unmount()
  const desktop = await montar($, 'desktop')
  expect(String((await desktop.find({ type: 'Svg' }))?.props.alt)).toContain('3 de 5, 60%')
  expect(await desktop.find({ key: 'contagem:p' })).toBeUndefined()
  await desktop.unmount()
  // Reaberta, os pulados voltam a abertos.
  expect((await progresso($, { id: 'p', ativo: 'd' })).result).toBe('3/5 · em andamento · ativo: d')
})

test('A3. finalizada fica endereçável; as finalizadas passam por poda de idade e de quantidade', async ($, on) => {
  const { relogio } = mundo(on)
  for (let i = 0; i < 22; i++) {
    await progresso($, { id: `b${i}`, titulo: `Barra ${i}`, passos: ['x'] })
    await progresso($, { id: `b${i}`, estado: 'concluido' })
    await relogio.advance(1000)
  }
  // 20 finalizadas no máximo: as duas mais velhas saíram.
  expect((await progresso($, { id: 'b0', nota: 'x' })).deny).toContain('não existe')
  expect((await progresso($, { id: 'b1', nota: 'x' })).deny).toContain('não existe')
  expect((await progresso($, { id: 'b2', nota: 'x' })).result).toContain('em andamento')

  // Mais de 12 h depois de fechada, sai na próxima mudança; a aberta fica.
  await progresso($, { id: 'viva', titulo: 'Aberta', passos: ['x', 'y'] })
  await relogio.advance(13 * 3_600_000)
  await progresso($, { id: 'nova', titulo: 'Nova', passos: ['x'] })
  expect((await progresso($, { id: 'b5', nota: 'x' })).deny).toContain('não existe')
  expect((await progresso($, { id: 'viva', proximo: true })).result).toBe('1/2 · em andamento · ativo: y')
})

test('A4. passo casa sem acento, caixa, espaço e pontuação, pelo número ou por prefixo único', async ($, on) => {
  mundo(on)
  await progresso($, {
    id: 't',
    titulo: 'Tolerante',
    etapas: [{ nome: 'A', passos: ['Ler briefing', 'Mapear seções'] }, { nome: 'B', passos: ['Montar hero', 'Montar oferta', 'Publicar'] }],
  })
  expect((await progresso($, { id: 't', feitos: ['ler  BRIEFING.'] })).result).toBe('1/5 · em andamento · ativo: Mapear seções')
  expect((await progresso($, { id: 't', feitos: ['mapear secoes'] })).result).toBe('2/5 · em andamento · ativo: Montar hero')
  expect((await progresso($, { id: 't', ativo: '5' })).result).toBe('2/5 · em andamento · ativo: Publicar')
  expect((await progresso($, { id: 't', feitos: ['Montar of'] })).result).toBe('3/5 · em andamento · ativo: Publicar')

  // Prefixo ambíguo não casa: o resto da chamada se aplica e o resultado avisa com os passos.
  const misto = await progresso($, { id: 't', feitos: ['Montar', 'Publicar'], nota: 'quase' })
  expect(misto.deny).toBeUndefined()
  expect(String(misto.result)).toContain('4/5 · em andamento')
  expect(String(misto.result)).toContain('Aviso: "Montar" não casou com nenhum passo e foi ignorado. Passos: 1. Ler briefing | 2. Mapear seções | 3. Montar hero')

  // Título errado não segura o fechamento.
  const fecha = await progresso($, { id: 't', feitos: ['Passo inventado'], estado: 'concluido' })
  expect(String(fecha.result)).toContain('concluído')
  expect(String(fecha.result)).toContain('"Passo inventado" não casou')
})

test('A4. proximo e concluido na mesma chamada fecham no último passo', async ($, on) => {
  mundo(on)
  await progresso($, { id: 'u', titulo: 'Último', passos: ['a', 'b'] })
  await progresso($, { id: 'u', proximo: true })
  expect((await progresso($, { id: 'u', proximo: true, estado: 'concluido' })).result).toBe('2/2 · concluído · sem passo ativo')
})

test('A5. faixa só se pendura na barra aberta do dono mudada neste turno; o subagente segue a barra do pai', async ($, on) => {
  mundo(on)
  on('agent.spawn', ($, e) => ({ model: 'claude-sonnet-5', agentId: e.tool_use_id }))
  const fonte = async (ui: Awaited<ReturnType<typeof montar>>) => (await ui.findAll({ type: 'Svg' })).map(svg => String(svg.props.source))
  await $.turn.start({ text: 'faz', turnId: 't1' })
  await progresso($, PLANO)
  await $.turn.start({ text: 'outra coisa', turnId: 't2' })
  // Barra de turno antigo: o agente vai ao grupo automático.
  await despacharComo($, 'velho')
  let ui = await montar($, 'desktop')
  expect((await fonte(ui)).some(svg => svg.includes('>Agentes<'))).toBe(true)
  await ui.unmount()

  // Mudada neste turno, a barra recebe o agente novo e o filho dele.
  await progresso($, { id: 'pub', proximo: true })
  await despacharComo($, 'novo')
  await $.agent.spawn({
    tool_use_id: 'neto', prompt: 'x', description: 'Agente neto', subagentType: 'executor-leve', parentAgentId: 'novo',
    provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: true, fork: false,
  })
  ui = await montar($, 'desktop')
  const svgs = await fonte(ui)
  const trilha = svgs.findIndex(svg => svg.includes('>Publicar página<'))
  expect(svgs.findIndex(svg => svg.includes('Agente novo'))).toBeGreaterThan(trilha)
  expect(svgs.findIndex(svg => svg.includes('Agente neto'))).toBeGreaterThan(trilha)
  // O agente despachado neste turno antes da mudança entra na barra junto: o grupo automático some.
  expect(svgs.findIndex(svg => svg.includes('Agente velho'))).toBeGreaterThan(trilha)
  expect(svgs.some(svg => svg.includes('>Agentes<'))).toBe(false)
  await ui.unmount()

  // Barra parada não recebe faixa.
  await fimDoTurnoPrincipal($, 't2', 'aborted')
  await $.turn.start({ text: 'mais', turnId: 't3' })
  await progresso($, { id: 'pub', estado: 'concluido' })
  await despacharComo($, 'tardio')
  ui = await montar($, 'terminal')
  expect(await ui.find({ type: 'Text', text: 'Agentes' })).toBeDefined()
  await ui.unmount()
})

test('A6. stopped vira faixa parada; notificação com content em texto fecha; o relógio corre sem session.start', async ($, on) => {
  const { relogio } = mundo(on)
  on('agent.spawn', ($, e) => ({ model: 'claude-sonnet-5', agentId: e.tool_use_id }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bg1' } }))
  await despacharComo($, 'a1')
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'npm run build', run_in_background: true })
  const ui = await montar($, 'terminal')
  await relogio.advance(3000)
  expect(await ui.find({ type: 'Text', text: '0:03' })).toBeDefined()

  const notificar = (content: unknown, uuid: string) =>
    $.session
      .append({ door: 'delivery', origin: { kind: 'task-notification' }, uuid, message: { type: 'user', role: 'user', isMeta: true, content: content as never } })
      .catch(() => undefined)
  await notificar('<task-notification>\n<task-id>a1</task-id>\n<status>stopped</status>\n</task-notification>', 'n1')
  expect(await ui.find({ type: 'Text', text: 'parado' })).toBeDefined()
  await notificar([{ type: 'text', text: '<task-notification><task-id>bg1</task-id><tool-use-id>b1</tool-use-id><status>killed</status></task-notification>' }], 'n2')
  expect(await ui.findAll({ type: 'Text', text: 'parado' })).toHaveLength(2)
  await ui.unmount()
})

test('A6. a banda não espera mais que 0,8 s o desenho do mod de baixo', async ($, on) => {
  // O mod de baixo leva 5 s (no relógio do teste) para desenhar.
  const lento: { sleep?: (ms: number) => Promise<void> } = {}
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
    await lento.sleep?.(5000)
    return $.ui.resolve(e).Text({ children: 'desenho de baixo' })
  })
  const { relogio } = mundo(on)
  lento.sleep = relogio.sleep
  await progresso($, PLANO)
  const montando = montar($, 'terminal')
  for (let i = 0; i < 24; i++) await relogio.advance(250)
  const ui = await montando
  // A banda saiu no limite, sem o desenho de baixo, que chegou depois.
  expect(await ui.find({ type: 'Text', text: 'Publicar página' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'desenho de baixo' })).toBeUndefined()
  await ui.unmount()
})

test('A7. processo novo: o store volta com as abertas paradas e as faixas ativas paradas; reload a quente não mexe', async ($, on) => {
  const barra = {
    id: 'velha', titulo: 'Tarefa de ontem', passos: [{ titulo: 'um', etapa: '', estado: 'ativo' }, { titulo: 'dois', etapa: '', estado: 'aberto' }],
    estado: 'andamento', nota: '', criadaEm: 900_000, fechadaEm: null, dono: null,
  }
  const faixa = { id: 'ag-velho', tipo: 'agente', titulo: 'Agente de ontem', estado: 'ativa', inicio: 900_000, fim: null, barra: 'velha' }
  const loja = new Map<string, unknown>([['sessoes', { s1: { em: 950_000, barras: [barra], faixas: [faixa] } }]])
  mundo(on, loja)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  expect((await comando($, 'progresso', 'on')).text).toBe('Barras de progresso visíveis · nenhuma barra ativa agora')
  const painel = await $.ui.mount({ plugin: 'progresso', surface: 'terminal', component: 'Pane', requestId: 'progresso', props: PAINEL })
  expect(await painel.find({ type: 'Text', text: 'Tarefa de ontem' })).toBeDefined()
  expect(await painel.find({ type: 'Text', text: '0/2 · sessão anterior' })).toBeDefined()
  expect(await painel.find({ type: 'Text', text: 'Falharam · 1' })).toBeDefined()
  await painel.unmount()

  // Reload a quente (session.start de novo, estado da mesma sessão): a barra nova continua em andamento.
  await progresso($, { id: 'hoje', titulo: 'Tarefa de hoje', passos: ['x', 'y'] })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  expect((await comando($, 'progresso', 'on')).text).toBe('Barras de progresso visíveis · 1 ativa')
})

test('A8. a descrição da ferramenta e a regra pedem para fechar a barra antes de encerrar o turno', async ($, on) => {
  const { registradas } = mundo(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  expect(registradas.find(item => item.name === 'progresso')?.description).toContain('Feche antes de encerrar o turno')
  const prompt = await $.prompt.compose({
    model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['desktop'], tools: [FERRAMENTA], outputStyle: null, traits: [],
  })
  const regra = prompt.sections.find(secao => secao.id === 'progresso:lista')?.text ?? ''
  expect(regra).toContain('Antes de encerrar o turno, feche-a')
  expect(regra.split(/\s+/).length).toBeLessThan(75)
})

test('R1. a banda tem uma linha por barra: só o % à direita, sem X/Y, e clicar nele abre o painel', async ($, on) => {
  mundo(on)
  const abertos: string[] = []
  on('ui.open', ($, e) => (abertos.push(e.id), { value: { isPlaced: true } }))
  await progresso($, PLANO)
  await progresso($, { id: 'pub', proximo: true })
  for (const surface of SUPERFICIES) {
    const ui = await montar($, surface)
    // Sem X/Y: o percentual, em tinta cheia.
    expect(await ui.find({ key: 'contagem:pub' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: '1/3' })).toBeUndefined()
    const pct = await ui.find({ key: 'painel:pub' })
    expect(String(pct?.props.label)).toContain('33%')
    expect(pct?.props.dimColor).toBeFalsy()
    // A linha de baixo saiu inteira: nem "faltam N", nem o botão "painel".
    expect(await ui.find({ type: 'Text', text: /faltam/ })).toBeUndefined()
    expect(await ui.find({ key: 'painel' })).toBeUndefined()
    if (surface === 'desktop') {
      // Sem faixa, a banda é a trilha e os dois botões numa linha só: nenhum texto embaixo.
      expect((await ui.findAll({ type: 'Text' })).filter(texto => texto.text !== 'faixa vazia')).toHaveLength(0)
      expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toContain('>Publicar página<')
      expect(caixasCom(await ui.drawn(), ['Svg', 'Box']).length).toBe(1)
    } else {
      expect(await ui.find({ type: 'Text', text: 'Publicar página' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Preparar · Mapear seções' })).toBeDefined()
    }
    for (const chave of ['painel:pub']) {
      abertos.length = 0
      await ui.press({ key: chave })
      expect(abertos).toEqual(['progresso'])
    }
    await ui.unmount()
  }
})

type No = { type: string; props?: Record<string, unknown>; children?: (No | string)[] }
const filhos = (no: No | undefined) => (no?.children ?? []).filter((f): f is No => typeof f !== 'string')
/** As Box cujos filhos diretos incluem todos os tipos pedidos. */
function caixasCom(arvore: unknown, tipos: string[]) {
  const saida: No[] = []
  const anda = (no: No | string) => {
    if (typeof no === 'string') return
    if (no.type === 'Box' && tipos.every(tipo => filhos(no).some(f => f.type === tipo))) saida.push(no)
    for (const filho of no.children ?? []) anda(filho)
  }
  anda(arvore as No)
  return saida
}
/** Os textos e rótulos da árvore na ordem em que aparecem: Text junta os pedaços aninhados, Button dá o rótulo. */
function sequencia(arvore: unknown) {
  const saida: string[] = []
  const texto = (no: No | string): string => (typeof no === 'string' ? no : (no.children ?? []).map(texto).join(''))
  const anda = (no: No | string) => {
    if (typeof no === 'string') return
    if (no.type === 'Text') return void saida.push(texto(no))
    if (no.type === 'Button') return void saida.push(String(no.props?.label ?? ''))
    // Cartão desenhado em Svg no desktop: o alt "Rótulo: valor" entra como os dois textos do cartão do terminal.
    if (no.type === 'Svg' && String(no.props?.alt ?? '').includes(': ')) return void saida.push(...String(no.props?.alt).split(': '))
    // A linha de métricas do desktop é um Svg: o alt dela entra como o texto da linha.
    if (no.type === 'Svg' && no.props?.alt) return void saida.push(String(no.props.alt))
    for (const filho of no.children ?? []) anda(filho)
  }
  anda(arvore as No)
  return saida
}

const USO = { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 30_000, cache_creation_input_tokens: 2000, model: 'claude-sonnet-5-5' }

const PAINEL_LARGO = { ...PAINEL, bodyColumns: 50 } as const

/**
 * A tarefa 5/7 com um passo planejado para o executor-pesado; um executor-leve rodando, executor e investigador
 * concluídos, um leitor que falhou e um comando em background.
 */
async function cenarioRico($: Engine, on: On) {
  const { relogio } = mundo(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.scroll', () => ({}))
  on('session.messages', () => ({ value: [{ role: 'assistant', text: 'Comecei.', toolUses: [] }] }))
  on('agent.spawn', ($, e) => ({ model: /leve|leitor/.test(e.subagentType) ? 'claude-sonnet-5-5' : 'claude-opus-5-5', agentId: e.tool_use_id }))
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { ...USO, model: e.model } }
  })
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bg1' } }))
  on('tool.call', { tool: 'Edit' }, () => ({ result: {} }) as never)

  await $.turn.start({ text: 'faz', turnId: 't1' })
  await progresso($, {
    id: 'kit',
    titulo: 'Lançar o kit de vendas',
    etapas: [
      { nome: 'Preparar', passos: ['Ler o briefing', 'Pesquisar concorrentes (investigador)'] },
      { nome: 'Construir', passos: ['Montar a landing (executor)', 'Ler os dados de 2025 (leitor)', 'Escrever o hero (executor-leve)'] },
      { nome: 'Verificar', passos: ['Testar no app', 'Revisar o kit inteiro (executor-pesado)'] },
    ],
  })
  const agente = async (id: string, tipo: string, descricao: string, modelo: string, esforco: 'medium' | 'high') => {
    await $.agent.spawn({
      tool_use_id: id, prompt: 'x', description: descricao, subagentType: tipo,
      provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: true, fork: false,
    })
    for await (const _ of $.turn.step({ turnId: `t-${id}`, index: 0, model: modelo, effort: esforco, messageCount: 1, agentId: id }));
  }
  const fim = (id: string, reason: 'answer' | 'error') =>
    $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: `t-${id}`, agentId: id, reason })
  await progresso($, { id: 'kit', proximo: true })
  await agente('a-inv', 'investigador', 'Pesquisar lançamentos concorrentes', 'claude-opus-5-5', 'medium')
  await relogio.advance(17_000)
  await fim('a-inv', 'answer')
  await progresso($, { id: 'kit', proximo: true })
  await agente('a-exe', 'executor', 'Montar a landing do kit', 'claude-opus-5-5', 'medium')
  await relogio.advance(18_000)
  await fim('a-exe', 'answer')
  await progresso($, { id: 'kit', proximo: true })
  await agente('a-lei', 'leitor', 'Ler os dados de 2025', 'claude-sonnet-5-5', 'medium')
  await relogio.advance(9_000)
  await fim('a-lei', 'error')
  await progresso($, { id: 'kit', proximo: true })
  await agente('a-leve', 'executor-leve', 'Escrever o hero', 'claude-sonnet-5-5', 'medium')
  await $.tool.call({ tool: 'Edit', tool_use_id: 'e1', file_path: '/site/hero.tsx', old_string: 'a', new_string: 'b', agentId: 'a-leve' } as never)
  await progresso($, { id: 'kit', proximo: true })
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'npm run build -- --filter kit', run_in_background: true })
  await relogio.advance(26_000)

  return { relogio }
}

const montarPainelLargo = ($: Engine, surface: 'terminal' | 'desktop') =>
  $.ui.mount({ plugin: 'progresso', surface, component: 'Pane', requestId: 'progresso', props: PAINEL_LARGO })

test('C. o painel Progresso: título, cartões, Recolher, tarefa com prancheta, grupos e Passos recolhíveis', async ($, on) => {
  await cenarioRico($, on)
  for (const surface of SUPERFICIES) {
    const painel = await montarPainelLargo($, surface)
    const ordem = sequencia(await painel.drawn())
    const onde = (texto: string | RegExp) => ordem.findIndex(item => (typeof texto === 'string' ? item === texto : texto.test(item)))
    // De cima para baixo: título, cartões, Recolher, a linha da tarefa, Passos e os grupos na ordem do contrato.
    const marcos = ['Lançar o kit de vendas', 'Custo', 'Tokens', 'Tempo', 'Recolher', /^5\/7 · Testar no app/, '▸ Passos · 7', 'Rodando · 2', '▾ Concluídos · 2', 'Falharam · 1', 'Planejados · 1']
    const posicoes = marcos.map(marco => onde(marco))
    expect(posicoes.every(posicao => posicao >= 0)).toBe(true)
    expect([...posicoes].sort((a, b) => a - b)).toEqual(posicoes)
    // A situação e os números: texto no terminal; no desktop um Svg da largura da barra, com o alt inteiro.
    const metrica = async (texto: string, numeros: string) => {
      if (surface === 'terminal') {
        expect(await painel.find({ type: 'Text', text: texto })).toBeDefined()
        expect(await painel.find({ type: 'Text', text: numeros })).toBeDefined()
      } else {
        expect((await painel.findAll({ type: 'Svg' })).map(svg => svg.props.alt)).toContain(`${texto} · ${numeros}`)
      }
    }
    await metrica('5/7 · Testar no app', 'faltam 2 · 1:10')
    expect(await painel.find({ type: 'Text', text: 'Construir' })).toBeUndefined()
    // Linha de agente: título, nível colorido com modelo · esforço, situação e números, ícone de estado.
    // A cor do nível é uma só: o texto e a barra do agente usam o mesmo hex.
    expect((await painel.find({ type: 'Text', text: /^leve$/ }))?.props.color).toBe('#4CB782')
    expect((await painel.find({ type: 'Text', text: /^médio$/ }))?.props.color).toBe('#4B8FE8')
    if (surface === 'desktop') {
      const barras = (await painel.findAll({ type: 'Svg' })).map(svg => String(svg.props.source))
      expect(barras.some(fonte => fonte.includes('fill="#4B8FE8"') && fonte.includes('height="4"'))).toBe(true)
    }
    expect(await painel.find({ type: 'Text', text: ' Sonnet 5.5 · médio' })).toBeDefined()
    await metrica('Edit', 'ctx 3% · 34k ≈$0.02 0:26')
    expect((await painel.find({ type: 'Text', text: /^pesado$/ }))?.props.color).toBe('#E5533A')
    expect(await painel.find({ type: 'Text', text: '7. Revisar o kit inteiro' })).toBeDefined()
    expect(await painel.find({ type: 'Text', text: ' Opus 5.5 · alto' })).toBeDefined()
    // Ícone de estado: glifo no terminal, Svg de 16 px no desktop; nenhum botão "abrir" na linha.
    if (surface === 'terminal') {
      expect((await painel.findAll({ type: 'Text', text: /^✓$/ })).length).toBe(2)
      expect(await painel.find({ type: 'Text', text: '✕' })).toBeDefined()
      expect(await painel.find({ type: 'Text', text: '◷' })).toBeDefined()
    } else {
      const estados = (await painel.findAll({ type: 'Svg' })).filter(svg => svg.props.width === 16 && svg.props.height === 16).map(svg => svg.props.alt)
      expect(estados).toEqual(['rodando', 'rodando', 'rodando', 'concluído', 'concluído', 'falhou', 'planejado'])
    }
    expect((await painel.findAll({ type: 'Button' })).some(botao => botao.props.label === 'abrir')).toBe(false)
    expect((await painel.find({ key: 'card:a-inv' }))?.props.label).toBe('Pesquisar lançamentos concorrentes')
    expect(await painel.find({ type: 'Text', text: 'npm run build -- --filter kit' })).toBeDefined()
    // Desktop: os três cartões são Svg com canto arredondado e o valor maior que o rótulo.
    if (surface === 'desktop') {
      const cartoes = (await painel.findAll({ type: 'Svg' })).filter(svg => /^(Custo|Tokens|Tempo): /.test(String(svg.props.alt)))
      expect(cartoes.map(svg => svg.props.alt)).toEqual(['Custo: ≈$0.10', 'Tokens: 134k', 'Tempo: 1:10'])
      expect(cartoes.every(svg => String(svg.props.source).includes('rx="9"') && String(svg.props.source).includes('600 20px'))).toBe(true)
    }
    // Sem caixa de borda em volta de cada agente: só os cartões do terminal têm borda.
    const bordas = caixasCom(await painel.drawn(), ['Text']).filter(caixa => caixa.props?.borderStyle)
    expect(bordas.length).toBe(surface === 'terminal' ? 3 : 0)
    await painel.press({ key: 'passos' })
    expect(await painel.find({ type: 'Text', text: 'Construir' })).toBeDefined()
    await painel.press({ key: 'passos' })
    await painel.unmount()
  }

  const painel = await montarPainelLargo($, 'desktop')
  // Concluídos abre por padrão e recolhe; Recolher deixa só os títulos dos grupos.
  expect(await painel.find({ key: 'card:a-exe' })).toBeDefined()
  await painel.press({ key: 'concluidos' })
  expect(await painel.find({ key: 'card:a-exe' })).toBeUndefined()
  await painel.press({ key: 'concluidos' })
  await painel.press({ key: 'recolher' })
  expect((await painel.find({ key: 'recolher' }))?.props.label).toBe('Expandir')
  expect(await painel.find({ key: 'card:a-leve' })).toBeUndefined()
  expect(await painel.find({ type: 'Text', text: 'Rodando · 2' })).toBeDefined()
  await painel.press({ key: 'recolher' })
  // Clicar no "abrir" abre a conversa do agente no mesmo painel; voltar devolve a visão geral.
  await painel.press({ key: 'card:a-exe' })
  expect(String((await painel.find({ type: 'Markdown' }))?.props.text)).toBe('Comecei.')
  await painel.press({ key: 'voltar' })
  expect(await painel.find({ key: 'concluidos' })).toBeDefined()
  await painel.unmount()
})

test('C. a primeira barra com 3+ passos abre o painel sozinho, sem tomar o teclado', async ($, on) => {
  mundo(on)
  const abertos: unknown[] = []
  on('ui.open', ($, e) => (abertos.push(e), { value: { isPlaced: true } }))
  await progresso($, { id: 'curta', titulo: 'Curta', passos: ['a', 'b'] })
  expect(abertos).toEqual([])
  await progresso($, PLANO)
  expect(abertos).toEqual([{ id: 'progresso', title: 'Progresso', columns: 60 }])
  await progresso($, { id: 'outra', titulo: 'Outra', passos: ['a', 'b', 'c', 'd'] })
  expect(abertos).toHaveLength(1)
})

test('Ícones de linha monocromáticos por tipo e estado, na banda e no painel, sem cor de nível', async ($, on) => {
  await cenarioRico($, on)
  const niveis = ['#4CB782', '#4B8FE8', '#E5533A', '#D9A033', '#3CC4D8']
  // Banda no desktop: o ícone de linha de 16 px na calha, antes do número, como na v1; a antena (ou os olhos) pisca.
  const banda = await montar($, 'desktop')
  // O ícone vem num Svg de 16 px logo antes do número e da faixa.
  const faixas = (await banda.findAll({ type: 'Svg' })).map(svg => String(svg.props.source))
  const iconeAntes = (texto: string) => faixas[faixas.findIndex(fonte => fonte.includes(texto)) - 1] ?? ''
  const doLeve = iconeAntes('Escrever o hero')
  expect(doLeve).toContain('class="gi" transform="translate(0 6) scale(0.6667)"')
  expect(doLeve).toContain('M13.5 6.5H23')
  expect(doLeve).toContain('class="ib"')
  expect(doLeve).not.toContain('crispEdges')
  const doComando = iconeAntes('npm run build')
  expect(doComando).toContain('m4 17 6-6-6-6')
  expect(doComando).toContain('<g class="cb"><path d="M12 19h8"/></g>')
  await banda.unmount()
  // Banda no terminal: o glifo do tipo, sem cor de nível, e ">_" no comando.
  const linha = await montar($, 'terminal')
  const glifo = await linha.find({ type: 'Text', text: '◠' })
  expect(glifo?.props.color).toBeUndefined()
  expect(await linha.find({ type: 'Text', text: '>_' })).toBeDefined()
  await linha.unmount()

  // Painel no desktop: a casa de 40 px com o ícone no centro; falhou de olhos em X, planejado tracejado.
  const desktop = await montarPainelLargo($, 'desktop')
  const icones = (await desktop.findAll({ type: 'Svg' })).filter(svg => String(svg.props.alt).startsWith('ícone'))
  expect(icones.map(svg => svg.props.alt)).toEqual(['ícone tarefa', 'ícone leve', 'ícone terminal', 'ícone executor', 'ícone investigador', 'ícone leitor falhou', 'ícone pesado planejado'])
  expect(icones.every(svg => svg.props.width === 44 && svg.props.height === 40)).toBe(true)
  const fontes = icones.map(svg => String(svg.props.source))
  expect(fontes.every(fonte => fonte.includes('<rect width="40" height="40" rx="10"'))).toBe(true)
  expect(fontes[1]).toContain('<animate attributeName="opacity"')
  expect(icones[1]?.props.isInteractive).toBe(true)
  expect(fontes[2]).toContain('M12 19h8')
  expect(fontes[5]).toContain('m8 12.5 2 2')
  expect(fontes[6]).toContain('class="ic pl"')
  expect(fontes.some(fonte => niveis.some(cor => fonte.includes(cor)))).toBe(false)
  await desktop.unmount()

  // Painel no terminal: um glifo por linha, sem sprite colorido.
  const terminal = await montarPainelLargo($, 'terminal')
  const pedacos = await terminal.findAll({ type: 'Text' })
  for (const g of ['▤', '◠', '>_', '⊓', '⌕', '⊙', '⌓']) expect(pedacos.some(pedaco => pedaco.text === g)).toBe(true)
  expect(pedacos.some(pedaco => /[▀▄█]/.test(String(pedaco.text ?? '')))).toBe(false)
  await terminal.unmount()
})

test('R3. estado vazio: sem agentes nenhum grupo aparece; sem nada, só o aviso', async ($, on) => {
  mundo(on)
  for (const surface of SUPERFICIES) {
    const nada = await montarPainelLargo($, surface)
    expect(sequencia(await nada.drawn())).toEqual(['Nenhuma tarefa ainda. A barra de progresso aparece aqui quando o modelo cria uma.', 'Fechar'])
    await nada.unmount()
  }
  await progresso($, PLANO)
  for (const surface of SUPERFICIES) {
    const painel = await montarPainelLargo($, surface)
    // Sem agentes nenhum grupo aparece: só o título, os cartões, o Recolher e a linha da tarefa.
    const ordem = sequencia(await painel.drawn())
    expect(ordem.slice(0, 5)).toEqual(['Publicar página', 'Custo', '—', 'Tokens', '—'])
    for (const grupo of ['Rodando', '▾ Concluídos', '▸ Concluídos', 'Falharam', 'Planejados']) {
      expect(ordem.some(item => item.startsWith(grupo))).toBe(false)
    }
    await painel.unmount()
  }
})

test('C. fechado pelo usuário, o painel não abre sozinho de novo nesta sessão', async ($, on) => {
  mundo(on)
  const abertos: string[] = []
  on('ui.open', ($, e) => (abertos.push(e.id), { value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('agent.spawn', ($, e) => ({ model: 'claude-sonnet-5', agentId: e.tool_use_id }))
  await despacharComo($, 'a1')
  expect(abertos).toEqual(['progresso'])
  const painel = await $.ui.mount({ plugin: 'progresso', surface: 'terminal', component: 'Pane', requestId: 'progresso', props: PAINEL })
  await painel.press({ key: 'fechar-painel' })
  await painel.unmount()
  await progresso($, { id: 'grande', titulo: 'Grande', passos: ['a', 'b', 'c', 'd'] })
  await despacharComo($, 'a2')
  expect(abertos).toEqual(['progresso'])
  // Pedido pelo usuário ainda abre.
  await comando($, 'progresso', 'painel')
  expect(abertos).toEqual(['progresso', 'progresso'])
})

test('C. preço e janela pela tabela da skill claude-api; modelo sem preço fica sem ≈$ no cartão', async ($, on) => {
  const perto = (valor: number | null, alvo: number) => expect(Math.abs((valor ?? Infinity) - alvo) < 1e-9).toBe(true)
  perto(custoDe('claude-sonnet-5-5', USO), 0.018)
  perto(custoDe('claude-opus-5-5[1m]', USO), (1000 * 4 + 2000 * 5 + 30_000 * 0.2 + 500 * 20) / 1e6)
  expect(custoDe('claude-modelo-novo-9', USO)).toBeNull()
  expect(janelaDe('claude-haiku-4-5-20251001')).toBe(200_000)
  expect(janelaDe('claude-opus-5-5')).toBe(1_000_000)

  mundo(on)
  on('agent.spawn', ($, e) => ({ model: 'claude-modelo-novo-9', agentId: e.tool_use_id }))
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { ...USO, model: 'claude-modelo-novo-9' } }
  })
  await progresso($, PLANO)
  await despacharComo($, 'a1')
  for await (const _ of $.turn.step({ turnId: 'ta', index: 0, model: 'claude-modelo-novo-9', messageCount: 1, agentId: 'a1' }));
  const painel = await $.ui.mount({ plugin: 'progresso', surface: 'terminal', component: 'Pane', requestId: 'progresso', props: PAINEL })
  expect(await painel.find({ type: 'Text', text: /^34k 0:00$/ })).toBeDefined()
  expect(await painel.find({ type: 'Text', text: /≈\$/ })).toBeUndefined()
  await painel.unmount()
})


// --- v3 -------------------------------------------------------------------------------------------------------------

const trilhaDe = async (ui: Awaited<ReturnType<typeof montar>>, titulo: string) =>
  String((await ui.findAll({ type: 'Svg' })).find(svg => String(svg.props.alt).startsWith(`${titulo}:`))?.props.source ?? '')

test('V1. o estado vai dentro da trilha, à direita da pílula, sem linha embaixo; esperando pulsa em âmbar', async ($, on) => {
  mundo(on)
  await progresso($, { id: 'and', titulo: 'Andando', passos: ['Ler o diff', 'Escrever as notas', 'Revisar'] })
  await progresso($, { id: 'esp', titulo: 'Esperando', passos: ['a', 'b', 'c', 'd'] })
  await progresso($, { id: 'esp', estado: 'esperando', nota: 'qual preço?' })
  await progresso($, { id: 'err', titulo: 'Quebrou', passos: ['Baixar', 'Subir no CRM', 'Avisar'] })
  await progresso($, { id: 'err', falhou: 'Baixar' })
  // Concluída com pulados: a pílula fica no meio e sobra trilho para o texto à direita.
  await progresso($, { id: 'con', titulo: 'Fechou', passos: ['x', 'y', 'z'] })
  await progresso($, { id: 'con', proximo: true, estado: 'concluido' })

  const ui = await montar($, 'desktop')
  const andando = await trilhaDe(ui, 'Andando')
  expect(andando).toContain('class="ks">Ler o diff</text>')
  const esperando = await trilhaDe(ui, 'Esperando')
  expect(esperando).toContain('class="ks">Esperando você · qual preço?</text>')
  expect(esperando).toContain('M12 4 2 20h20zM12 10.5v4M12 17.5h.01" transform="translate(')
  expect(esperando).toContain('class="ki"')
  expect(esperando).toContain('class="pu"')
  expect(andando).not.toContain('class="pu"')
  expect(await trilhaDe(ui, 'Quebrou')).toContain('class="ks">Falhou: Baixar</text>')
  expect(await trilhaDe(ui, 'Fechou')).toMatch(/class="ks">Concluído em \d+s<\/text>/)
  // Concluída a 100% não tem trilho à direita: o texto não vira chip sobre o preenchido (a pílula já tem ✓ e o tempo).
  await progresso($, { id: 'cheia', titulo: 'Cheia', passos: ['x'] })
  await progresso($, { id: 'cheia', proximo: true, estado: 'concluido' })
  expect(await trilhaDe(ui, 'Cheia')).not.toContain('class="kq"')
  // Nada de Text com o estado embaixo da barra: ele só existe dentro do Svg.
  expect((await ui.findAll({ type: 'Text' })).some(texto => /Esperando você|Falhou/.test(String(texto.text ?? '')))).toBe(false)
  await ui.unmount()

  // No terminal o estado segue na mesma linha da barra, como antes.
  const linha = await montar($, 'terminal')
  expect(await linha.find({ type: 'Text', text: 'Esperando você · qual preço?' })).toBeDefined()
  await linha.unmount()
})

test('V1. barra parada mostra "Parou em X/Y" e esperando sem nota "Aguardando informação"; texto longo corta com reticências', async ($, on) => {
  mundo(on)
  await $.turn.start({ text: 'faz', turnId: 't1' })
  await progresso($, PLANO)
  await progresso($, { id: 'pub', proximo: true })
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
  await progresso($, { id: 'sem', titulo: 'Sem nota', passos: ['a', 'b'] })
  await progresso($, { id: 'sem', estado: 'esperando' })
  await progresso($, { id: 'longa', titulo: 'Longa', passos: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'] })
  await progresso($, { id: 'longa', estado: 'esperando', nota: 'Conferir a banda e o painel ao vivo no app desktop, no terminal estreito e no tema escuro antes de instalar a versão nova do plugin em todas as máquinas' })
  const ui = await montar($, 'desktop')
  expect(await trilhaDe(ui, 'Publicar página')).toContain('class="ks">Parou em 1/3</text>')
  expect(await trilhaDe(ui, 'Sem nota')).toContain('class="ks">Aguardando informação</text>')
  const longa = await trilhaDe(ui, 'Longa')
  expect(longa).toMatch(/class="ks">Esperando você · Conferir[^<]*…<\/text>/)
  await ui.unmount()
})

test('V2. a estrela do Claude gira na pílula em andamento, nas faixas de agente e no painel; os outros estados trocam pelo ícone', async ($, on) => {
  await cenarioRico($, on)
  const banda = await montar($, 'desktop')
  const trilha = await trilhaDe(banda, 'Lançar o kit de vendas')
  expect(trilha).toContain('fill="#D97757"')
  expect(trilha).toContain('<g class="eg"><g class="ep">')
  expect(trilha).not.toContain('class="mk sd"')
  // Brilho na parte cheia da barra em andamento.
  expect(trilha).toContain('class="sh"')
  const faixas = (await banda.findAll({ type: 'Svg' })).map(svg => String(svg.props.source))
  expect(faixas.find(fonte => fonte.includes('Escrever o hero'))).toContain('<g class="eg">')
  // O comando não é o Claude: fica com o ponto.
  expect(faixas.find(fonte => fonte.includes('npm run build'))).not.toContain('<g class="eg">')
  await banda.unmount()

  const painel = await montarPainelLargo($, 'desktop')
  const estados = (await painel.findAll({ type: 'Svg' })).filter(svg => svg.props.width === 16 && svg.props.height === 16)
  const rodando = estados.filter(svg => svg.props.alt === 'rodando')
  expect(rodando.filter(svg => String(svg.props.source).includes('#D97757') && String(svg.props.source).includes('animateTransform'))).toHaveLength(2)
  expect(rodando.every(svg => svg.props.isInteractive === true)).toBe(true)
  expect(estados.some(svg => String(svg.props.source).includes('#4CB782') && String(svg.props.source).includes('circle cx="7"'))).toBe(false)
  // A barra da tarefa em andamento leva o brilho em SMIL, num Svg isInteractive.
  const barras = (await painel.findAll({ type: 'Svg' })).filter(svg => svg.props.height === 4)
  expect(barras.some(svg => String(svg.props.source).includes('<animate attributeName="x" values="-64;') && svg.props.isInteractive === true)).toBe(true)
  await painel.unmount()

  const terminal = await montarPainelLargo($, 'terminal')
  expect((await terminal.findAll({ type: 'Text', text: '✻' })).every(t => t.props.color === 'claude')).toBe(true)
  await terminal.unmount()
})

test('V5. prancheta, terminal com cursor piscando e ícones de passo em Svg no desktop, glifos no terminal', async ($, on) => {
  await cenarioRico($, on)
  const painel = await montarPainelLargo($, 'desktop')
  const icones = (await painel.findAll({ type: 'Svg' })).filter(svg => String(svg.props.alt).startsWith('ícone'))
  expect(String(icones[0]?.props.source)).toContain('m9 14 2 2 4-4')
  const terminal = icones.find(svg => svg.props.alt === 'ícone terminal')
  expect(String(terminal?.props.source)).toContain('values="1;0"')
  expect(terminal?.props.isInteractive).toBe(true)
  await painel.press({ key: 'passos' })
  // Os ícones de passo (o ✕ de estado do agente que falhou, "M4 4l8 8", fica de fora).
  const passos = (await painel.findAll({ type: 'Svg' })).filter(
    svg => ['feito', 'ativo', 'aberto', 'falhou', 'pulado'].includes(String(svg.props.alt)) && !String(svg.props.source).includes('M4 4l8 8'),
  )
  expect(passos.map(svg => svg.props.alt)).toEqual(['feito', 'feito', 'feito', 'feito', 'feito', 'ativo', 'aberto'])
  expect(passos.every(svg => svg.props.width === 16)).toBe(true)
  expect(String(passos[5]?.props.source)).toContain('#D97757')
  await painel.unmount()
})

test('V6. passo que falhou é ✕ vermelho no painel, também depois de o plano ser reescrito', async ($, on) => {
  mundo(on)
  await progresso($, PLANO)
  await progresso($, { id: 'pub', falhou: 'Ler briefing' })
  await progresso($, { ...PLANO, etapas: [...PLANO.etapas, { nome: 'Verificar', passos: ['Testar'] }] })
  for (const surface of SUPERFICIES) {
    const painel = await montarPainelLargo($, surface)
    // "Passos" aberto fica guardado na janela: abre uma vez só.
    if (surface === 'terminal') await painel.press({ key: 'passos' })
    if (surface === 'terminal') {
      expect((await painel.find({ type: 'Text', text: '✕' }))?.props.color).toBe('error')
      expect((await painel.find({ type: 'Text', text: 'Ler briefing' }))?.props.color).toBe('error')
    } else {
      const falho = (await painel.findAll({ type: 'Svg' })).find(svg => svg.props.alt === 'falhou' && svg.props.width === 16 && String(svg.props.source).includes('m15 9-6 6'))
      expect(String(falho?.props.source)).toContain('#E5534B')
    }
    await painel.unmount()
  }
})

test('V6. comando sem o "cd <pasta> &&" no rótulo, pasta no alt; segue vivo com o fim do subagente e fecha no Stop quando sai do background', async ($, on) => {
  mundo(on)
  on('agent.spawn', ($, e) => ({ model: 'claude-sonnet-5-5', agentId: e.tool_use_id }))
  on('tool.call', { tool: 'Bash' }, ($, e) => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: `bg-${e.tool_use_id}` } }))
  await $.turn.start({ text: 'faz', turnId: 't1' })
  await $.tool.call({ tool: 'Bash', tool_use_id: 'p1', command: 'cd /private/tmp/claude-501/proj && npm test -- --watch', run_in_background: true })
  await $.tool.call({ tool: 'Bash', tool_use_id: 'p2', command: 'cd "/tmp/com espaço"; npm run dev', run_in_background: true })
  await despacharComo($, 'ag1')
  await $.tool.call({ tool: 'Bash', tool_use_id: 'f1', command: 'npm run lint', run_in_background: true, agentId: 'ag1' } as never)

  const altos = async () => {
    const ui = await montar($, 'desktop')
    const alt = (await ui.findAll({ type: 'Svg' })).map(svg => String(svg.props.alt))
    await ui.unmount()
    return alt
  }
  let alt = await altos()
  expect(alt).toContain('comando npm test -- --watch em /private/tmp/claude-501/proj: em andamento')
  expect(alt).toContain('comando npm run dev em /tmp/com espaço: em andamento')
  const terminal = await montar($, 'terminal')
  expect(await terminal.find({ type: 'Text', text: '$ npm test -- --watch' })).toBeDefined()
  expect((await terminal.findAll({ type: 'Text' })).some(t => String(t.text ?? '').includes('cd /private'))).toBe(false)
  await terminal.unmount()

  // O subagente termina: não está provado que o processo morre com ele, então o comando dele segue rodando.
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 'ta', agentId: 'ag1', reason: 'answer' })
  alt = await altos()
  expect(alt).toContain('comando npm run lint: em andamento')

  // Stop sem a lista (host antigo): nada fecha.
  await $.classic.Stop({ stop_hook_active: false })
  alt = await altos()
  expect(alt.filter(texto => texto.endsWith(': em andamento') && texto.startsWith('comando'))).toHaveLength(3)

  // Stop da conversa principal: fica o que o host ainda lista, por id ou pelo command (id diferente, command igual
  // com espaços a mais e cortado em 1000 com o marcador do host).
  const fundo = [
    { id: 'bg-p2', type: 'shell', status: 'running', description: 'npm run dev' },
    { id: 'outro-id', type: 'shell', status: 'running', description: 'lint', command: 'npm  run   lint... [+0 chars]' },
  ]
  await $.classic.Stop({ stop_hook_active: false, background_tasks: fundo })
  alt = await altos()
  expect(alt).toContain('comando npm test -- --watch em /private/tmp/claude-501/proj: concluído')
  expect(alt).toContain('comando npm run dev em /tmp/com espaço: em andamento')
  expect(alt).toContain('comando npm run lint: em andamento')
  // Subagente no Stop não mexe.
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [], agent_id: 'x' })
  expect(await altos()).toContain('comando npm run dev em /tmp/com espaço: em andamento')
})

test('V6. o command só casa inteiro; o começo basta só quando o host cortou e marcou o corte', async ($, on) => {
  mundo(on)
  on('tool.call', { tool: 'Bash' }, ($, e) => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: `bg-${e.tool_use_id}` } }))
  await $.turn.start({ text: 'faz', turnId: 't1' })
  await $.tool.call({ tool: 'Bash', tool_use_id: 'a', command: 'npm run build', run_in_background: true })
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b', command: 'npm run build:prod', run_in_background: true })
  const longo = `node gera.js ${'x'.repeat(1200)}`
  await $.tool.call({ tool: 'Bash', tool_use_id: 'c', command: longo, run_in_background: true })
  // Ids que não casam: só o command decide. "npm run build" não segura "npm run build:prod"; o cortado casa pelo começo.
  await $.classic.Stop({
    stop_hook_active: false,
    background_tasks: [
      { id: 'x1', type: 'shell', status: 'running', description: 'build', command: 'npm run build' },
      { id: 'x2', type: 'shell', status: 'running', description: 'gera', command: `${longo.slice(0, 1000)}... [+${longo.length - 1000} chars]` },
    ],
  })
  const ui = await montar($, 'desktop')
  const alt = (await ui.findAll({ type: 'Svg' })).map(svg => String(svg.props.alt)).filter(texto => texto.startsWith('comando'))
  await ui.unmount()
  expect(alt).toContain('comando npm run build: em andamento')
  expect(alt).toContain('comando npm run build:prod: concluído')
  expect(alt.some(texto => texto.startsWith('comando node gera.js') && texto.endsWith(': em andamento'))).toBe(true)
})

test('3.3. com os mesmos dados nenhum Svg do painel muda entre dois tiques, nem o cartão Tempo', async ($, on) => {
  const { relogio } = await cenarioRico($, on)
  const fontes = async () => {
    const painel = await montarPainelLargo($, 'desktop')
    const lista = (await painel.findAll({ type: 'Svg' })).map(svg => `${String(svg.props.alt).startsWith('Tempo:') ? 'tempo' : ''}|${String(svg.props.source)}`)
    await painel.unmount()
    return lista
  }
  const antes = await fontes()
  expect(antes.find(fonte => fonte.startsWith('tempo|'))).toContain('class="ps1"')
  await relogio.advance(2000)
  expect(await fontes()).toEqual(antes)
})

test('robustez: no terminal a 30 colunas nenhuma linha do painel passa da largura', async ($, on) => {
  await cenarioRico($, on)
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b2', command: 'cd ~/projetos/site-de-vendas && npm run dev', run_in_background: true })
  const painel = await $.ui.mount({ plugin: 'progresso', surface: 'terminal', component: 'Pane', requestId: 'progresso', props: { ...PAINEL, bodyColumns: 30 } })
  const textos = (await painel.findAll({ type: 'Text' })).map(texto => String(texto.text ?? ''))
  expect(textos.some(texto => texto.startsWith('comando em background ·'))).toBe(true)
  expect(textos.filter(texto => texto.startsWith('comando em background')).every(texto => texto.length <= 30)).toBe(true)
  await painel.unmount()
})

test('V6. no Stop, comando de subagente terminado e fora da lista fecha; de subagente ainda rodando, fica', async ($, on) => {
  mundo(on)
  on('agent.spawn', ($, e) => ({ model: 'claude-sonnet-5-5', agentId: e.tool_use_id }))
  on('tool.call', { tool: 'Bash' }, ($, e) => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: `bg-${e.tool_use_id}` } }))
  await $.turn.start({ text: 'faz', turnId: 't1' })
  await despacharComo($, 'velho')
  await despacharComo($, 'vivo')
  await $.tool.call({ tool: 'Bash', tool_use_id: 'v1', command: 'cd /private/tmp/x && npm run dev', run_in_background: true, agentId: 'velho' } as never)
  await $.tool.call({ tool: 'Bash', tool_use_id: 'w1', command: 'npm run watch', run_in_background: true, agentId: 'vivo' } as never)
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 'tv', agentId: 'velho', reason: 'answer' })

  await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })
  const ui = await montar($, 'desktop')
  const alt = (await ui.findAll({ type: 'Svg' })).map(svg => String(svg.props.alt)).filter(texto => texto.startsWith('comando'))
  expect(alt).toContain('comando npm run dev em /private/tmp/x: concluído')
  expect(alt).toContain('comando npm run watch: em andamento')
  await ui.unmount()
})

test('calha: o ícone do tipo vem antes do número em agente e comando, nas duas superfícies; nenhum Svg com alt vazio', async ($, on) => {
  await cenarioRico($, on)
  const desktop = await montar($, 'desktop')
  for (const [texto, tipo, traco] of [['Escrever o hero', 'agente', 'M13.5 6.5H23'], ['npm run build', 'comando', 'm4 17 6-6-6-6']] as const) {
    const linha = caixasCom(await desktop.drawn(), ['Svg', 'Box']).find(caixa => filhos(caixa).some(f => String(f.props?.source ?? '').includes(texto)))
    const [icone, numero, faixa] = filhos(linha)
    expect(icone?.type).toBe('Svg')
    expect(icone?.props?.alt).toBe(tipo)
    expect(String(icone?.props?.source)).toContain(traco)
    expect(numero?.type).toBe('Box')
    expect(String(faixa?.props?.source)).toContain(texto)
  }
  const vazios = async (ui: Awaited<ReturnType<typeof montar>>) => (await ui.findAll({ type: 'Svg' })).filter(svg => !String(svg.props.alt ?? '').trim())
  expect(await vazios(desktop)).toHaveLength(0)
  await desktop.unmount()
  const painel = await montarPainelLargo($, 'desktop')
  expect((await painel.findAll({ type: 'Svg' })).filter(svg => !String(svg.props.alt ?? '').trim())).toHaveLength(0)
  await painel.unmount()

  const terminal = await montar($, 'terminal')
  const textos = sequencia(await terminal.drawn())
  for (const glifo of ['◠', '>_']) {
    const k = textos.indexOf(glifo)
    expect(k).toBeGreaterThanOrEqual(0)
    expect(textos[k + 1]).toMatch(/^\d+$/)
  }
  await terminal.unmount()
})

test('tipos padrão do Claude Code e tipos desconhecidos têm ícone e nível', () => {
  expect(desenhoDoTipo('Explore')).toBe('investigador')
  for (const tipo of ['general-purpose', 'Plan', 'claude', 'fork', 'meu-agente', 'plugin-x:revisor']) {
    expect(desenhoDoTipo(tipo), tipo).toBe('robo')
  }
  expect(desenhoDoTipo('plugin-x:executor-leve')).toBe('leve')
  expect(nivelDe('general-purpose')).toEqual({ rotulo: 'general-purpose', cor: '#8A857B', hex: '#8A857B' })
  expect(nivelDe('').rotulo).toBe('agente')
})
