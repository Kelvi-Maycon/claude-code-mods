import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, Register } from 'claude-code'

const FERRAMENTA = 'mcp__progresso__progresso'
const SUPERFICIES = ['terminal', 'desktop'] as const
const PAINEL = { title: 'Anotações', isFocused: true, bodyColumns: 56, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const
const AULAS = [1, 2, 3, 4, 5, 6].map(n => ({ titulo: `Aula ${n}`, valor: `https://exemplo.com/curso/aula-${n}`, grupo: 'Curso · páginas' }))
const EMOJI = /\p{Extended_Pictographic}/u

/** O mundo embaixo do mod: relógio, store (num Map quando o teste quer ler), sessão, painéis e toasts anotados. */
function mundo(on: On, loja = new Map<string, unknown>(), sessao = { id: 's1' }) {
  mock.clock(on, { now: 1_000_000 })
  on('store.get', (_$, e) => ({ value: loja.get(e.key) }))
  on('store.set', (_$, e) => (loja.set(e.key, e.value), { value: undefined }))
  const painel: string[] = []
  const toasts: string[] = []
  const copias: string[] = []
  const registradas: { name: string; description: string }[] = []
  on('audio.play', () => ({ value: undefined }))
  on('ui.toast', (_$, e) => (toasts.push(e.text), { value: undefined }))
  // Só o painel de anotações: o session.start fecha um painel antigo de outro id.
  on('ui.open', (_$, e) => (e.id === 'anotacoes' && painel.push(`abre ${e.id}`), { value: { isPlaced: true } }))
  on('ui.close', (_$, e) => (e.id === 'anotacoes' && painel.push(`fecha ${e.id}`), { value: undefined }))
  on('ui.copy', (_$, e) => (copias.push(e.text), { value: { isCopied: true } }))
  on('session.id', () => ({ value: sessao.id }))
  on('tool.register', (_$, e) => (registradas.push({ name: e.name, description: e.description }), { value: { tool: e.name } }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('prompt.compose', () => ({ sections: [] }))
  on('ui.render', ($, e) => $.ui.resolve(e).Box({ flexDirection: 'column' }))

  return { loja, sessao, painel, toasts, copias, registradas }
}

// O setTimeout do runtime do teste (os tipos do mod não trazem DOM nem Node).
const espera = (globalThis as unknown as { setTimeout: (feito: (valor?: unknown) => void, ms: number) => unknown }).setTimeout

/** Espera a fila de gravação do mod chegar ao store: até 100 voltas de 1 ms. */
async function gravado<T>(ler: () => T | undefined): Promise<T | undefined> {
  for (let i = 0; i < 100; i++) {
    const valor = ler()
    if (valor !== undefined) return valor
    await new Promise(resolve => espera(resolve, 1))
  }
  return ler()
}

let chamadas = 0
const progresso = ($: Engine, entrada: Record<string, unknown>) => $.tool.call({ tool: FERRAMENTA, tool_use_id: `a${(chamadas += 1)}`, ...entrada })
const inicia = ($: Engine, surface: 'terminal' | 'desktop' = 'desktop') => $.session.start({ cwd: '/tmp', surface, isInteractive: true })
const comando = ($: Engine, command: string, args = '') =>
  $.command.run({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 110 } })
const montar = ($: Engine, surface: 'terminal' | 'desktop') =>
  $.ui.mount({ plugin: 'progresso', surface, component: 'Pane', requestId: 'anotacoes', props: PAINEL })

test('N1. a ferramenta adiciona, atualiza pelo título, apaga e lista as anotações', async ($, on) => {
  mundo(on)
  await inicia($)
  const feita = await progresso($, { anotacoes: AULAS })
  expect(feita.result).toStartWith('6 anotadas · Anotações (6): 1. Aula 1: https://exemplo.com/curso/aula-1 [Curso · páginas] | 2. Aula 2')

  // Título repetido (sem caixa nem acento) atualiza o valor no lugar.
  const trocada = await progresso($, { anotacoes: [{ titulo: 'aula 4', valor: 'https://exemplo.com/curso/aula-4-v2', grupo: 'Curso · páginas' }] })
  expect(trocada.result).toContain('1 anotada · Anotações (6)')
  expect(trocada.result).toContain('4. aula 4: https://exemplo.com/curso/aula-4-v2')

  const apagada = await progresso($, { esquecer: ['Aula 6', '1'] })
  expect(apagada.result).toStartWith('2 esquecidas · Anotações (4): 1. Aula 2')

  const lista = await progresso($, { listarAnotacoes: true })
  expect(lista.result).toBe(
    'Anotações (4): 1. Aula 2: https://exemplo.com/curso/aula-2 [Curso · páginas] | 2. Aula 3: https://exemplo.com/curso/aula-3 [Curso · páginas] | 3. aula 4: https://exemplo.com/curso/aula-4-v2 [Curso · páginas] | 4. Aula 5: https://exemplo.com/curso/aula-5 [Curso · páginas].',
  )

  expect((await progresso($, { esquecer: ['Aula 99'] })).deny).toContain('Nenhuma anotação casou com "Aula 99"')
})

test('N2. senha e chave não entram; anotação junto de pendência e de barra responde uma linha por parte', async ($, on) => {
  mundo(on)
  await inicia($)
  expect((await progresso($, { anotacoes: [{ titulo: 'Senha do painel', valor: 'abc123' }] })).deny).toContain('Senha e segredo não entram')
  expect((await progresso($, { anotacoes: [{ titulo: 'Chave', valor: 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz' }] })).deny).toContain('Senha e segredo')

  await progresso($, { id: 'pub', titulo: 'Publicar', passos: ['um', 'dois'] })
  const junto = await progresso($, { id: 'pub', proximo: true, pendencias: [{ titulo: 'Prompt da aula 4', quem: 'você' }], anotacoes: [{ titulo: 'Página', valor: 'https://exemplo.com/curso' }] })
  expect(String(junto.result).split('\n')).toEqual([
    '1/2 · em andamento · ativo: dois',
    '1 adicionada · Pendências (1): 1. Prompt da aula 4 (você).',
    '1 anotada · Anotações (1): 1. Página: https://exemplo.com/curso.',
  ])
})

test('N3. a descrição e a regra falam de anotações e a regra continua curta', async ($, on) => {
  const { registradas } = mundo(on)
  await inicia($)
  const descricao = registradas.find(item => item.name === 'progresso')?.description ?? ''
  expect(descricao).toContain('{anotacoes:[{titulo, valor, grupo?}]}')
  expect(descricao).toContain('{esquecer:[')
  expect(descricao).toContain('{listarAnotacoes:true}')
  expect(descricao).toContain('Nunca senha')
  const prompt = await $.prompt.compose({ model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['desktop'], tools: [FERRAMENTA], outputStyle: null, traits: [] })
  const regra = prompt.sections.find(secao => secao.id === 'progresso:lista')?.text ?? ''
  expect(regra).toContain('`anotacoes`')
  expect(regra).toContain('nunca segredo')
  expect(regra.split(/\s+/).length).toBeLessThan(95)
  expect(EMOJI.test(descricao + regra)).toBe(false)
})

test('N4. as anotações ficam no store da conversa e voltam no /resume, sem vazar para outra', async ($, on) => {
  const { loja, sessao } = mundo(on)
  await inicia($)
  await progresso($, { anotacoes: AULAS.slice(0, 2) })
  // A gravação no store é uma fila do mod, fora da resposta da ferramenta.
  const guardadas = await gravado(() => (loja.get('sessoes') as Record<string, { anotacoes?: unknown[] }> | undefined)?.s1?.anotacoes)
  expect(guardadas).toHaveLength(2)

  await $.session.end({ reason: 'resume', sessionId: 's1', resume: { id: 's1' } })
  sessao.id = 's2'
  await $.prompt.submit({ text: 'outra', wait: false, origin: { kind: 'composer' } })
  expect((await progresso($, { listarAnotacoes: true })).result).toBe('Anotações (0): nenhuma.')

  await $.session.end({ reason: 'resume', sessionId: 's2', resume: { id: 's2' } })
  sessao.id = 's1'
  await $.prompt.submit({ text: 'continua', wait: false, origin: { kind: 'composer' } })
  expect((await progresso($, { listarAnotacoes: true })).result).toStartWith('Anotações (2): 1. Aula 1')
})

test('N5. processo novo (reinício do app) devolve as anotações da conversa', async ($, on) => {
  const guardado = new Map<string, unknown>([
    ['sessoes', { s1: { em: 1, barras: [], anotacoes: [{ titulo: 'Aula 1', valor: 'https://exemplo.com/curso/aula-1', grupo: 'Curso · páginas', criadaEm: 1 }] } }],
  ])
  mundo(on, guardado)
  await inicia($)
  expect((await progresso($, { listarAnotacoes: true })).result).toBe('Anotações (1): 1. Aula 1: https://exemplo.com/curso/aula-1 [Curso · páginas].')
})

test('N6. o painel agrupa por grupo, o URL vira link e as pendências ficam numa seção âmbar separada, sem emoji', async ($, on) => {
  mundo(on)
  await inicia($)
  await progresso($, { anotacoes: [...AULAS, { titulo: 'Decisão do checkout', valor: 'Hotmart, não Kiwify' }] })
  await progresso($, { pendencias: [{ titulo: 'Ligar as 6 automações', quem: 'seu ok' }, { titulo: 'Prompt da aula 4', quem: 'você' }] })
  for (const surface of SUPERFICIES) {
    const painel = await montar($, surface)
    // O título do pane é do app: o painel abre com o resumo, sem repetir "Anotações" nem desenhar um Fechar.
    expect(await painel.find({ type: 'Text', text: '7 anotações · 2 pendências' })).toBeDefined()
    expect(await painel.find({ type: 'Text', text: 'Anotações' })).toBeUndefined()
    expect(JSON.stringify(await painel.drawn())).not.toContain('"Fechar"')
    // Cabeçalho do grupo: chevron e nome no Button, a contagem fora dele, apagada; sem grupo vai em "Sem grupo".
    expect((await painel.find({ key: 'grupo:1:alternar' }))?.props.label).toBe('⏷ Curso · páginas')
    expect(await painel.find({ type: 'Text', text: '6' })).toMatchObject({ props: { dimColor: true } })
    expect((await painel.find({ key: 'grupo:0:alternar' }))?.props.label).toBe('⏷ Sem grupo')
    const links = await painel.findAll({ type: 'Link' })
    expect(links.map(link => link.props.href)).toEqual(AULAS.map(aula => aula.valor))
    expect(links[0]?.props.label).toBe('exemplo.com/curso/aula-1')
    expect(await painel.find({ type: 'Text', text: 'Hotmart, não Kiwify' })).toBeDefined()
    // Pendências: cabeçalho em warning, fora da lista de anotações, com o resolver de cada uma.
    expect((await painel.find({ key: 'pendencias:topo:alternar' }))?.props.label).toBe('⏷ Pendências')
    // As ações do item ficam atrás do "⋯": nenhum Copiar/Editar/Apagar à vista antes do clique.
    expect(await painel.find({ key: 'nota:0:copiar' })).toBeUndefined()
    expect((await painel.findAll({ type: 'Button' })).filter(botao => botao.props.label === '⋯').length).toBe(7)
    const secaoNotas = JSON.stringify(await painel.find({ key: 'secao:anotacoes' }))
    expect(secaoNotas).not.toContain('Ligar as 6 automações')
    const secaoPend = JSON.stringify(await painel.find({ key: 'secao:pendencias' }))
    expect(secaoPend).toContain('Ligar as 6 automações')
    expect(secaoPend).toContain('Prompt da aula 4')
    expect(secaoPend).not.toContain('Aula 1')
    expect(EMOJI.test(JSON.stringify(await painel.drawn()))).toBe(false)
    await painel.unmount()
  }
})

test('N7. pelo painel: adicionar, editar, copiar, apagar com confirmação e resolver pendência, nas duas superfícies', async ($, on) => {
  const { copias, loja } = mundo(on)
  await inicia($)
  for (const surface of SUPERFICIES) {
    await progresso($, { pendencias: [{ titulo: 'Ligar as 6 automações', quem: 'seu ok' }] })
    const painel = await montar($, surface)
    expect(await painel.find({ type: 'Text', text: '0 anotações · 1 pendência' })).toBeDefined()
    expect(JSON.stringify(await painel.find({ key: 'secao:anotacoes' }))).toContain('Nada anotado nesta conversa')

    // Adicionar: título e valor digitados, o Enter no último campo (grupo) grava, limpa e recolhe o formulário.
    await painel.press({ key: 'novo:abrir' })
    await painel.input({ key: 'novo:titulo', text: 'Aula 1', kind: 'change' })
    await painel.input({ key: 'novo:valor', text: 'https://exemplo.com/curso/aula-1', kind: 'change' })
    await painel.input({ key: 'novo:grupo', text: 'Curso · páginas' })
    expect((await painel.find({ type: 'Link' }))?.props.href).toBe('https://exemplo.com/curso/aula-1')
    expect(await painel.find({ key: 'novo:titulo' })).toBeUndefined()
    // Pelo botão Salvar também.
    await painel.press({ key: 'novo:abrir' })
    expect((await painel.find({ key: 'novo:titulo' }))?.props.value).toBe('')
    await painel.input({ key: 'novo:titulo', text: 'ID da lista', kind: 'change' })
    await painel.input({ key: 'novo:valor', text: '4821', kind: 'change' })
    await painel.press({ key: 'novo:adicionar' })
    expect(await painel.find({ type: 'Text', text: '2 anotações · 1 pendência' })).toBeDefined()
    expect((await gravado(() => (loja.get('sessoes') as Record<string, { anotacoes?: unknown[] }> | undefined)?.s1?.anotacoes?.length === 2 || undefined))).toBe(true)

    // Copiar leva o valor: o "⋯" abre as ações do item, e só dele.
    await painel.press({ key: 'nota:1:mais' })
    expect(await painel.find({ key: 'nota:0:copiar' })).toBeUndefined()
    await painel.press({ key: 'nota:1:copiar' })
    expect(copias.at(-1)).toBe('4821')

    // Editar inline: os campos com o valor atual, Salvar grava; Cancelar não muda nada.
    await painel.press({ key: 'nota:1:editar' })
    expect((await painel.find({ key: 'editar:titulo' }))?.props.value).toBe('ID da lista')
    expect(await painel.find({ key: 'nota:1:copiar' })).toBeUndefined()
    await painel.input({ key: 'editar:valor', text: '4822', kind: 'change' })
    await painel.press({ key: 'editar:cancelar' })
    expect(await painel.find({ type: 'Text', text: '4821' })).toBeDefined()
    await painel.press({ key: 'nota:1:mais' })
    await painel.press({ key: 'nota:1:editar' })
    await painel.input({ key: 'editar:titulo', text: 'ID da lista ActiveCampaign', kind: 'change' })
    await painel.input({ key: 'editar:valor', text: '4822', kind: 'change' })
    await painel.press({ key: 'editar:salvar' })
    expect(await painel.find({ key: 'editar:titulo' })).toBeUndefined()
    expect(await painel.find({ type: 'Text', text: 'ID da lista ActiveCampaign' })).toBeDefined()
    expect(await painel.find({ type: 'Text', text: '4822' })).toBeDefined()

    // Apagar pede confirmação: Cancelar mantém, Apagar de novo remove.
    await painel.press({ key: 'nota:1:mais' })
    await painel.press({ key: 'nota:1:apagar' })
    expect(await painel.find({ type: 'Text', text: 'Apagar?' })).toBeDefined()
    await painel.press({ key: 'nota:1:nao' })
    expect(await painel.find({ type: 'Text', text: '2 anotações · 1 pendência' })).toBeDefined()
    await painel.press({ key: 'nota:1:apagar' })
    await painel.press({ key: 'nota:1:sim' })
    expect(await painel.find({ type: 'Text', text: '1 anotação · 1 pendência' })).toBeDefined()
    expect((await progresso($, { listarAnotacoes: true })).result).toStartWith('Anotações (1): 1. Aula 1')

    // Resolver tira a pendência da conversa.
    await painel.press({ key: 'pend:0:resolver' })
    expect(JSON.stringify(await painel.find({ key: 'secao:pendencias' }))).toContain('Nenhuma pendência nesta conversa')
    expect((await progresso($, { listar: true })).result).toBe('Pendências (0): nenhuma.')

    await progresso($, { esquecer: ['Aula 1'] })
    await painel.unmount()
  }
})

test('N8. /anotacoes abre e fecha o painel', async ($, on) => {
  const { painel } = mundo(on)
  await inicia($)
  await progresso($, { anotacoes: AULAS })
  expect((await comando($, 'anotacoes')).text).toBe('Painel de anotações aberto · Anotações · 6')
  expect((await comando($, 'anotacoes')).text).toBe('Painel de anotações fechado · Anotações · 6')
  expect(painel).toEqual(['abre anotacoes', 'fecha anotacoes'])
})

// O barra-uso como ele se mostra a este mod: o clique no botão "Anotações" só escreve o contador dele.
const barraUso: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'clique-anotacoes', description: 'clique' })

    return next(e)
  })
  on('command.run', { command: 'clique-anotacoes' }, async $ => {
    const ref = { plugin: 'barra-uso', key: 'anotacoes' }
    const { value } = await ($.state.get as (r: typeof ref) => Promise<{ value: unknown }>)(ref)
    await ($.state.set as (r: typeof ref, v: unknown) => Promise<unknown>)(ref, (typeof value === 'number' ? value : 0) + 1)

    return { text: 'clicou' }
  })
}

test('N9. o clique no botão do barra-uso (a escrita do contador dele) alterna o painel deste mod', { plugins: [{ name: 'barra-uso', register: barraUso }] }, async ($, on) => {
  const { painel } = mundo(on)
  await inicia($)
  await comando($, 'clique-anotacoes')
  await comando($, 'clique-anotacoes')
  await comando($, 'clique-anotacoes')
  expect(painel).toEqual(['abre anotacoes', 'fecha anotacoes', 'abre anotacoes'])
  // Fechado por outro caminho (o /anotacoes; o X do pane passa pelo mesmo ui.close), o clique seguinte abre de novo.
  await comando($, 'anotacoes')
  await comando($, 'clique-anotacoes')
  expect(painel.slice(-2)).toEqual(['fecha anotacoes', 'abre anotacoes'])
})

const MANYCHAT = ['Fluxo de boas-vindas', 'Palavra-chave AULA', 'Tag de aluno'].map(titulo => ({ titulo, valor: `ManyChat: ${titulo}`, grupo: 'Curso · ManyChat' }))
const textos = async (painel: Awaited<ReturnType<typeof montar>>) => JSON.stringify(await painel.drawn())

test('N10. cada grupo recolhe e expande pelo cabeçalho; recolher tudo e expandir tudo valem para grupos e pendências', async ($, on) => {
  mundo(on)
  await inicia($)
  await progresso($, { anotacoes: [...AULAS, ...MANYCHAT] })
  await progresso($, { pendencias: [{ titulo: 'Prompt da aula 4', quem: 'você' }] })
  for (const surface of SUPERFICIES) {
    const painel = await montar($, surface)
    expect((await painel.findAll({ type: 'Link' })).length).toBe(6)
    await painel.press({ key: 'grupo:0:alternar' })
    expect(await painel.findAll({ type: 'Link' })).toHaveLength(0)
    // O cabeçalho fica, com a contagem; o outro grupo segue aberto.
    expect((await painel.find({ key: 'grupo:0:alternar' }))?.props.label).toBe('⏵ Curso · páginas')
    expect(JSON.stringify(await painel.find({ key: 'grupo:0' }))).toContain('"6"')
    expect(await textos(painel)).toContain('Palavra-chave AULA')
    await painel.press({ key: 'grupo:0:alternar' })
    expect((await painel.findAll({ type: 'Link' })).length).toBe(6)

    await painel.press({ key: 'recolher-tudo' })
    const recolhido = await textos(painel)
    expect(recolhido).not.toContain('Palavra-chave AULA')
    expect(recolhido).not.toContain('Prompt da aula 4')
    expect((await painel.find({ key: 'recolher-tudo' }))?.props.label).toBe('Expandir tudo')
    await painel.press({ key: 'recolher-tudo' })
    expect(await textos(painel)).toContain('Prompt da aula 4')
    expect((await painel.find({ key: 'recolher-tudo' }))?.props.label).toBe('Recolher tudo')
    await painel.unmount()
  }
})

test('N11. a seção de pendências recolhe pelo cabeçalho e mantém a contagem', async ($, on) => {
  mundo(on)
  await inicia($)
  await progresso($, { pendencias: [{ titulo: 'Prompt da aula 4', quem: 'você' }, { titulo: 'Ligar as 6 automações', quem: 'seu ok' }] })
  for (const surface of SUPERFICIES) {
    const painel = await montar($, surface)
    expect(await painel.find({ key: 'pend:1:resolver' })).toBeDefined()
    // Quem depende é texto do tamanho do corpo; o ok do usuário em âmbar.
    expect((await painel.find({ type: 'Text', text: 'seu ok' }))?.props.color).toBe('warning')
    expect((await painel.find({ type: 'Text', text: 'você' }))?.props.dimColor).toBe(true)
    await painel.press({ key: 'pendencias:topo:alternar' })
    expect(await painel.find({ key: 'pend:0:resolver' })).toBeUndefined()
    expect(JSON.stringify(await painel.find({ key: 'pendencias:topo' }))).toContain('"2"')
    await painel.press({ key: 'pendencias:topo:alternar' })
    expect(await painel.find({ key: 'pend:0:resolver' })).toBeDefined()
    await painel.unmount()
  }
})

test('N12. o formulário fica atrás de "+ Nova anotação": abre com o foco no título, o Enter no título não salva e Cancelar fecha', async ($, on) => {
  const { toasts } = mundo(on)
  await inicia($)
  for (const surface of SUPERFICIES) {
    const painel = await montar($, surface)
    expect(await painel.find({ key: 'novo:titulo' })).toBeUndefined()
    await painel.press({ key: 'novo:abrir' })
    // O foco vai ao título (autoFocus e $.ui.focus; o kit de teste não implementa ui.focus, e a recusa fica calada).
    expect((await painel.find({ key: 'novo:titulo' }))?.props.autoFocus).toBe(true)
    expect(toasts).toEqual([])
    expect(await painel.find({ key: 'novo:abrir' })).toBeUndefined()
    // Um botão de salvar só; o rótulo do Enter diz o que ele faz em cada campo.
    // O campo das notas livres é outro Input; os do formulário têm a key "novo:".
    const campos = (await painel.findAll({ type: 'Input' })).filter(campo => String(campo.props.key).startsWith('novo:'))
    expect(campos.map(campo => [campo.props.placeholder, campo.props.submitLabel])).toEqual([
      ['Título', 'próximo'],
      ['Valor ou URL', 'próximo'],
      ['Grupo (opcional)', 'salvar'],
    ])
    expect((await painel.findAll({ type: 'Button' })).filter(botao => botao.props.label === 'Salvar').length).toBe(1)
    // Enter no título guarda o texto e não salva: só o último campo salva.
    await painel.input({ key: 'novo:titulo', text: 'Rascunho' })
    expect((await painel.find({ key: 'novo:titulo' }))?.props.value).toBe('Rascunho')
    expect((await progresso($, { listarAnotacoes: true })).result).toBe('Anotações (0): nenhuma.')
    await painel.press({ key: 'novo:cancelar' })
    expect(await painel.find({ key: 'novo:titulo' })).toBeUndefined()
    // Cancelar descarta o rascunho: reaberto, o campo vem vazio.
    await painel.press({ key: 'novo:abrir' })
    expect((await painel.find({ key: 'novo:titulo' }))?.props.value).toBe('')
    await painel.press({ key: 'novo:cancelar' })
    await painel.unmount()
  }
})

test('N13. o que foi recolhido fica no store da conversa e volta no /resume, sem vazar para outra', async ($, on) => {
  const { loja, sessao } = mundo(on)
  await inicia($)
  await progresso($, { anotacoes: [...AULAS, ...MANYCHAT] })
  await progresso($, { pendencias: [{ titulo: 'Prompt da aula 4', quem: 'você' }] })
  const painel = await montar($, 'desktop')
  await painel.press({ key: 'grupo:1:alternar' })
  await painel.press({ key: 'pendencias:topo:alternar' })
  await painel.unmount()
  const salvo = await gravado(() => (loja.get('sessoes') as Record<string, { recolhidos?: unknown }> | undefined)?.s1?.recolhidos)
  expect(salvo).toEqual({ grupos: ['Curso · ManyChat'], pendencias: true })

  await $.session.end({ reason: 'resume', sessionId: 's1', resume: { id: 's1' } })
  sessao.id = 's2'
  await $.prompt.submit({ text: 'outra', wait: false, origin: { kind: 'composer' } })
  await progresso($, { anotacoes: MANYCHAT })
  const outra = await montar($, 'desktop')
  expect(await textos(outra)).toContain('Palavra-chave AULA')
  await outra.unmount()

  await $.session.end({ reason: 'resume', sessionId: 's2', resume: { id: 's2' } })
  sessao.id = 's1'
  await $.prompt.submit({ text: 'continua', wait: false, origin: { kind: 'composer' } })
  const volta = await montar($, 'desktop')
  const desenho = await textos(volta)
  expect(desenho).not.toContain('Palavra-chave AULA')
  expect(desenho).not.toContain('Prompt da aula 4')
  expect((await volta.findAll({ type: 'Link' })).length).toBe(6)
  await volta.unmount()
})

const NOTA = 'Publicar aula 4 depois do prompt\nConferir ManyChat\nchave sk-ant-api03-abcdefghijklmnopqrstuvwxyz e senha: hunter22'
const sessoesDe = (loja: Map<string, unknown>) => loja.get('sessoes') as Record<string, { notasLivres?: { texto?: string; altura?: number; recolhida?: boolean } }> | undefined

test('N14. notas livres: o texto grava a cada mudança no store da conversa, o Enter não limpa, e o painel não redesenha por tecla', async ($, on) => {
  const { loja } = mundo(on)
  await inicia($)
  for (const surface of SUPERFICIES) {
    const painel = await montar($, surface)
    const campo = await painel.find({ key: 'notas:texto' })
    expect(campo?.props.rows).toBe(8)
    expect(campo?.props.submitLabel).toBe('salvar')
    await painel.input({ key: 'notas:texto', text: `Fazendo: ${surface}`, kind: 'change' })
    expect(await gravado(() => (sessoesDe(loja)?.s1?.notasLivres?.texto === `Fazendo: ${surface}` ? true : undefined))).toBe(true)
    // Mesma linha: nada mudou no que o painel desenha, então o campo não recebe outro value enquanto se digita.
    const antes = await painel.drawn()
    await painel.input({ key: 'notas:texto', text: `Fazendo: ${surface}!`, kind: 'change' })
    expect(await painel.drawn()).toEqual(antes)
    await painel.input({ key: 'notas:texto', text: `Fazendo: ${surface}!!` })
    expect(await gravado(() => (sessoesDe(loja)?.s1?.notasLivres?.texto === `Fazendo: ${surface}!!` ? true : undefined))).toBe(true)
    await painel.unmount()
    // Remontado, o campo vem com o texto (o Enter não limpou).
    const outra = await montar($, surface)
    expect((await outra.find({ key: 'notas:texto' }))?.props.value).toBe(`Fazendo: ${surface}!!`)
    await outra.unmount()
  }
})

test('N15. notas livres voltam do store em processo novo e no /resume, sem vazar para outra conversa', async ($, on) => {
  const guardado = new Map<string, unknown>([['sessoes', { s1: { em: 1, barras: [], notasLivres: { texto: 'linha 1\nlinha 2', altura: 12, recolhida: false } } }]])
  const { sessao } = mundo(on, guardado)
  await inicia($)
  const painel = await montar($, 'desktop')
  const campo = await painel.find({ key: 'notas:texto' })
  expect(campo?.props.value).toBe('linha 1\nlinha 2')
  expect(campo?.props.rows).toBe(12)
  await painel.unmount()

  await $.session.end({ reason: 'resume', sessionId: 's1', resume: { id: 's1' } })
  sessao.id = 's2'
  await $.prompt.submit({ text: 'outra', wait: false, origin: { kind: 'composer' } })
  const outra = await montar($, 'desktop')
  expect((await outra.find({ key: 'notas:texto' }))?.props.value).toBe('')
  expect((await outra.find({ key: 'notas:texto' }))?.props.rows).toBe(8)
  await outra.unmount()

  await $.session.end({ reason: 'resume', sessionId: 's2', resume: { id: 's2' } })
  sessao.id = 's1'
  await $.prompt.submit({ text: 'volta', wait: false, origin: { kind: 'composer' } })
  const volta = await montar($, 'desktop')
  expect((await volta.find({ key: 'notas:texto' }))?.props.value).toBe('linha 1\nlinha 2')
  await volta.unmount()
})

test('N16. maior e menor andam de 4 em 4 entre 4 e 40, somem no limite e a altura fica guardada', async ($, on) => {
  const { loja } = mundo(on)
  await inicia($)
  const painel = await montar($, 'desktop')
  await painel.press({ key: 'notas:menor' })
  expect((await painel.find({ key: 'notas:texto' }))?.props.rows).toBe(4)
  expect(await painel.find({ key: 'notas:menor' })).toBeUndefined()
  for (let i = 0; i < 9; i++) await painel.press({ key: 'notas:maior' })
  expect((await painel.find({ key: 'notas:texto' }))?.props.rows).toBe(40)
  expect(await painel.find({ key: 'notas:maior' })).toBeUndefined()
  await painel.press({ key: 'notas:menor' })
  expect((await painel.find({ key: 'notas:texto' }))?.props.rows).toBe(36)
  expect(await gravado(() => sessoesDe(loja)?.s1?.notasLivres?.altura === 36 || undefined)).toBe(true)
  await painel.unmount()
})

test('N17. o campo cresce com o texto (linhas + 1) até 40 e recolhe mostrando quantas linhas tem', async ($, on) => {
  const { loja } = mundo(on)
  await inicia($)
  for (const surface of SUPERFICIES) {
    const painel = await montar($, surface)
    const dez = Array.from({ length: 10 }, (_, i) => `passo ${i + 1}`).join('\n')
    await painel.input({ key: 'notas:texto', text: dez, kind: 'change' })
    expect((await painel.find({ key: 'notas:texto' }))?.props.rows).toBe(11)
    await painel.input({ key: 'notas:texto', text: Array.from({ length: 60 }, () => 'x').join('\n'), kind: 'change' })
    expect((await painel.find({ key: 'notas:texto' }))?.props.rows).toBe(40)
    await painel.input({ key: 'notas:texto', text: dez, kind: 'change' })

    await painel.press({ key: 'notas:alternar' })
    expect(await painel.find({ key: 'notas:texto' })).toBeUndefined()
    expect(await painel.find({ type: 'Text', text: '10 linhas' })).toBeDefined()
    expect((await painel.find({ key: 'notas:seta' }))?.props.label).toBe('⏵')
    expect(await gravado(() => sessoesDe(loja)?.s1?.notasLivres?.recolhida === true || undefined)).toBe(true)
    await painel.press({ key: 'notas:seta' })
    expect((await painel.find({ key: 'notas:texto' }))?.props.value).toBe(dez)
    // Recolher tudo leva as notas junto.
    await painel.press({ key: 'recolher-tudo' })
    expect(await painel.find({ key: 'notas:texto' })).toBeUndefined()
    await painel.press({ key: 'recolher-tudo' })
    await painel.unmount()
  }
})

test('N18. listarAnotacoes devolve as notas livres com segredo mascarado, trecho de até 1500 e a contagem; o system prompt não as leva', async ($, on) => {
  mundo(on)
  await inicia($)
  await progresso($, { anotacoes: AULAS.slice(0, 1) })
  const painel = await montar($, 'desktop')
  await painel.input({ key: 'notas:texto', text: NOTA, kind: 'change' })
  await painel.unmount()
  const lista = String((await progresso($, { listarAnotacoes: true })).result)
  expect(lista).toStartWith('Anotações (1): 1. Aula 1')
  expect(lista).toContain(`Notas livres (3 linhas, ${NOTA.length} caracteres):\nPublicar aula 4 depois do prompt\nConferir ManyChat`)
  expect(lista).toContain('chave [oculto] e senha: [oculto]')
  expect(lista).not.toContain('hunter22')
  expect(lista).not.toContain('sk-ant')
  // Só a listagem: adicionar não repete as notas.
  expect(String((await progresso($, { anotacoes: [{ titulo: 'ID', valor: '4821' }] })).result)).not.toContain('Notas livres')
  const prompt = await $.prompt.compose({ model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['desktop'], tools: [FERRAMENTA], outputStyle: null, traits: [] })
  expect(JSON.stringify(prompt)).not.toContain('Conferir ManyChat')

  const longo = await montar($, 'desktop')
  await longo.input({ key: 'notas:texto', text: 'a'.repeat(2000), kind: 'change' })
  await longo.unmount()
  const cortada = String((await progresso($, { listarAnotacoes: true })).result)
  expect(cortada).toContain('Notas livres (1 linhas, 2000 caracteres)')
  expect(cortada).toContain(`${'a'.repeat(1500)}… (+500 caracteres)`)
})
