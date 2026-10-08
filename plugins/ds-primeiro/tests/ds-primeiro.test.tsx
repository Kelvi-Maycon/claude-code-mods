import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, PromptEditInput, PromptEditResult, PromptOrigin, Register } from 'claude-code'

import { pedeDs } from '../hooks/detecta'

const COMPOSER: PromptOrigin = { kind: 'composer' }
const HTML = 'cria um HTML que mostre de forma clara como isso funciona'
const BANDA = {
  plugin: 'ds-primeiro',
  surface: 'terminal',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 120, scroll: { offset: 0, bodyRows: 4 }, view: {} },
} as const

const CONFIG = { skill: 'acme-design-system', rotulo: 'Acme', ignorar: 'marca da loja, sem identidade' }
const TERMOS = [CONFIG.skill, CONFIG.rotulo, ...CONFIG.ignorar.split(',')]

test('detecção: pedidos que anexam', () => {
  for (const texto of [
    HTML,
    'Melhora bastante essa tela, quero algo mais bonito e com mais motion',
    'refaça todas as paginas com uma organização melhor',
    // Uma pasta com o nome do DS no meio de um caminho não conta como citar o DS.
    "'~/projetos/acme/site' melhora bastante esse layout, deixa mais limpo",
    'cria uma landing em ~/projetos/acme/lp',
  ]) {
    expect(pedeDs(texto, TERMOS), texto).toBe(true)
  }
})

test('detecção: pedidos que não anexam', () => {
  for (const texto of [
    'Cria uma página simples de boas-vindas com o design da Contoso',
    'usa minha identidade visual, as cores e as fontes',
    'deu certo? acabou?',
    'reinicia o servidor',
    'Construa um jardim em Three.js. Não use skills. Faça você mesmo.',
    'analisa esse relatório aqui',
    'cria uma landing sem ds',
    'faz um dashboard, precisa usar mais o design system agora',
    'cria um guia de estilo',
    // A skill, o rótulo ou um termo extra citados no pedido dispensam a linha.
    'cria uma landing /acme-design-system',
    'monta um slide no padrão Acme',
    'faz uma página com a marca da loja',
  ]) {
    expect(pedeDs(texto, TERMOS), texto).toBe(false)
  }
})

test('detecção: sem termos configurados só as regras fixas valem', () => {
  expect(pedeDs('monta um slide no padrão Acme')).toBe(true)
  expect(pedeDs('cria uma landing sem ds')).toBe(false)
})

function mundo(on: On, opcoes: { guardado?: Record<string, unknown>; segura?: boolean } = {}) {
  mock.store(on, opcoes.guardado)
  const visto = { toasts: [] as string[], contextos: [] as (readonly string[] | undefined)[] }

  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('command.run', () => ({ text: 'sem resposta' }))
  on('ui.toast', (_$, e) => {
    visto.toasts.push(e.text)

    return { value: undefined }
  })
  on('session.compact', (_$, e) => ({ messages: e.messages }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)

    return <Box />
  })
  on('prompt.edit', (_$, e) => {
    const text = e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end)

    return { text, cursor: e.start + e.inputText.length }
  })
  on('prompt.submit', (_$, e) => {
    if (opcoes.segura) {
      return { drop: 'segurado por outro hook' }
    }

    visto.contextos.push(e.context)

    return { text: e.text, context: e.context }
  })

  return visto
}

const inicia = ($: Engine) => $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
const envia = ($: Engine, text: string, origin: PromptOrigin = COMPOSER) =>
  $.prompt.submit({ text, wait: false, origin })
// O kit dispara `prompt.edit` em runtime, mas o tipo do `$` de teste não declara essa chamada.
type ComEdicao = Engine & { prompt: { edit: (e: PromptEditInput) => Promise<PromptEditResult> } }
const digita = ($: Engine, texto: string) =>
  ($ as ComEdicao).prompt.edit({ origin: COMPOSER, text: '', cursor: 0, start: 0, end: 0, inputText: texto })
const ds = ($: Engine, args: string) =>
  $.command.run({ command: 'ds', args, origin: COMPOSER, presentation: { isFullscreen: false, columns: 120 } })

test('anexa uma vez por sessão, sem tocar no texto, e rearma depois de compactar', { options: CONFIG }, async ($, on) => {
  const visto = mundo(on)
  await inicia($)

  const primeiro = await envia($, HTML)
  expect(primeiro.text).toBe(HTML)
  expect(primeiro.context).toHaveLength(1)
  expect(primeiro.context?.[0]).toStartWith(
    'ds-primeiro: em peça visual o usuário usa por padrão o design system Acme. Carregue a skill acme-design-system',
  )
  expect(visto.toasts).toEqual(['DS Acme anexado a este pedido · /ds off desliga'])

  expect((await envia($, 'refaça todas as paginas com uma organização melhor')).context).toBeUndefined()
  expect(visto.toasts).toHaveLength(1)

  await $.session.compact({ trigger: 'auto', messages: [{ role: 'user', text: 'oi', toolUses: [] }] })
  expect((await envia($, HTML)).context).toHaveLength(1)
  expect(visto.toasts).toHaveLength(2)
})

test('pedido não visual e origem que não é composer passam intactos', { options: CONFIG }, async ($, on) => {
  const visto = mundo(on)
  await inicia($)

  expect(await envia($, 'reinicia o servidor')).toEqual({ text: 'reinicia o servidor' })
  expect((await envia($, HTML, { kind: 'task-notification' })).context).toBeUndefined()
  expect((await envia($, HTML, { kind: 'plugin', name: 'x' })).context).toBeUndefined()
  expect(visto.toasts).toEqual([])
  expect(visto.contextos).toEqual([undefined, undefined, undefined])
})

test('app desktop: sem prompt.edit a faixa não aparece, e o envio sdk anexa como o do terminal', { options: CONFIG }, async ($, on) => {
  const visto = mundo(on)
  await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
  const faixa = await $.ui.mount({ ...BANDA, surface: 'desktop' })

  expect(await faixa.find({ key: 'tirar' })).toBeUndefined()
  expect((await envia($, HTML, { kind: 'sdk' })).context).toHaveLength(1)
  expect(visto.toasts).toEqual(['DS Acme anexado a este pedido · /ds off desliga'])
  expect(await faixa.find({ key: 'tirar' })).toBeUndefined()
  expect((await envia($, HTML, { kind: 'sdk' })).context).toBeUndefined()
  await faixa.unmount()
})

test('envio segurado por outro hook não conta como anexado', { options: CONFIG }, async ($, on) => {
  const visto = mundo(on, { segura: true })
  await inicia($)

  expect((await envia($, HTML)).drop).toBe('segurado por outro hook')
  expect(visto.toasts).toEqual([])
  expect((await ds($, '')).text).toContain('DS ainda não anexado')
})

test('/ds: estado, off, on rearma, sempre guarda o padrão', { options: CONFIG }, async ($, on) => {
  const visto = mundo(on)
  await inicia($)

  expect((await ds($, '')).text).toBe('ligado nesta sessão · DS ainda não anexado · padrão ligado')
  expect((await ds($, 'off')).text).toContain('desligado nesta sessão')
  expect((await envia($, HTML)).context).toBeUndefined()

  await ds($, 'on')
  expect((await envia($, HTML)).context).toHaveLength(1)
  expect((await ds($, '')).text).toContain('DS já anexado')

  await ds($, 'on')
  expect((await envia($, HTML)).context).toHaveLength(1)

  expect((await ds($, 'sempre off')).text).toBe(
    'desligado nesta sessão · DS já anexado (/ds on anexa de novo) · padrão desligado',
  )
  expect((await ds($, 'qualquer')).text).toContain('Use /ds')
  expect(visto.toasts).toHaveLength(2)
})

// Outro mod que lê o estado publicado, como a `barra-uso`.
const leitor: Register = on => {
  on('command.run', { command: 'le-ds' }, async $ => ({
    text: String((await $.state.get({ plugin: 'ds-primeiro', key: 'ativo' })).value),
  }))
}

test('estado publicado para outros mods: on, off, sempre e o reset do /clear', { options: CONFIG, plugins: [{ name: 'leitor', register: leitor }] }, async ($, on) => {
  mundo(on)
  const ativo = async () => {
    const lido = (await $.command.run({ command: 'le-ds', args: '', origin: COMPOSER, presentation: { isFullscreen: false, columns: 120 } })).text

    return lido === 'undefined' ? undefined : lido === 'true'
  }

  expect(await ativo()).toBeUndefined()

  await inicia($)
  expect(await ativo()).toBe(true)
  await ds($, 'off')
  expect(await ativo()).toBe(false)
  await ds($, 'on')
  expect(await ativo()).toBe(true)
  await ds($, 'sempre off')
  expect(await ativo()).toBe(false)
  await ds($, 'on')
  expect(await ativo()).toBe(true)

  // /clear: o /ds on da sessão sai e vale o padrão guardado (desligado).
  await $.session.end({ reason: 'clear', sessionId: 's', resume: { id: 's' } })
  expect(await ativo()).toBe(false)
  await ds($, 'sempre on')
  await $.session.end({ reason: 'clear', sessionId: 's', resume: { id: 's' } })
  expect(await ativo()).toBe(true)
})

test('padrão guardado desligado: sessão nova não anexa', { options: CONFIG }, async ($, on) => {
  mundo(on, { guardado: { sempre: false } })
  await inicia($)

  expect((await envia($, HTML)).context).toBeUndefined()
  expect((await ds($, '')).text).toContain('desligado nesta sessão')
})

test('faixa: aparece com o rascunho casando, some com "Tirar deste envio" e esse envio sai sem o DS', { options: CONFIG }, async ($, on) => {
  const visto = mundo(on)
  await inicia($)

  for (const surface of ['terminal', 'desktop'] as const) {
    const faixa = await $.ui.mount({ ...BANDA, surface })
    expect(await faixa.find({ key: 'tirar' })).toBeUndefined()

    await digita($, 'reinicia o servidor')
    expect(await faixa.find({ key: 'tirar' })).toBeUndefined()

    await digita($, HTML)
    expect(await faixa.find({ type: 'Text', text: /DS Acme será anexado a este pedido/ })).toBeDefined()

    await faixa.press({ key: 'tirar' })
    expect(await faixa.find({ key: 'tirar' })).toBeUndefined()
    expect((await envia($, HTML)).context).toBeUndefined()

    // O envio seguinte volta a valer: a faixa reaparece e o DS entra.
    await digita($, HTML)
    expect(await faixa.find({ key: 'tirar' })).toBeDefined()
    expect((await envia($, HTML)).context).toHaveLength(1)
    expect(await faixa.find({ key: 'tirar' })).toBeUndefined()

    await faixa.unmount()
    await ds($, 'on')
  }

  expect(visto.toasts).toHaveLength(2)
})

// Outro mod que desenha em AbovePrompt com o mesmo padrão de empilhar.
const vizinho: Register = on => {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const abaixo = await next(e)
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {abaixo}
        <Text>faixa do vizinho</Text>
      </Box>
    )
  })
}

test('faixa empilhada: a do vizinho e a do DS aparecem juntas', { options: CONFIG, plugins: [{ name: 'vizinho', register: vizinho }] }, async ($, on) => {
  mundo(on)
  await inicia($)

  for (const surface of ['terminal', 'desktop'] as const) {
    const faixa = await $.ui.mount({ ...BANDA, surface })
    const desenho = async () => JSON.stringify(await faixa.drawn())
    expect(await desenho()).toContain('faixa do vizinho')
    expect(await desenho()).not.toContain('DS Acme')

    // As duas no mesmo desenho, a do DS por último (junto do campo).
    await digita($, HTML)
    const juntas = await desenho()
    expect(juntas).toContain('faixa do vizinho')
    expect(juntas.indexOf('DS Acme será anexado a este pedido')).toBeGreaterThan(
      juntas.indexOf('faixa do vizinho'),
    )

    await faixa.press({ key: 'tirar' })
    expect(await desenho()).toContain('faixa do vizinho')
    expect(await desenho()).not.toContain('DS Acme')

    // O envio consome o "Tirar deste envio"; a próxima superfície começa limpa.
    await envia($, 'reinicia o servidor')
    await faixa.unmount()
  }
})

test('sem configuração: não anexa, não registra /ds, não desenha faixa e não publica estado', { plugins: [{ name: 'leitor', register: leitor }] }, async ($, on) => {
  const visto = mundo(on)
  await inicia($)

  expect((await envia($, HTML)).context).toBeUndefined()
  expect((await ds($, '')).text).toBe('sem resposta')
  expect(visto.toasts).toEqual([])

  for (const surface of ['terminal', 'desktop'] as const) {
    const faixa = await $.ui.mount({ ...BANDA, surface })
    await digita($, HTML)
    expect(await faixa.find({ key: 'tirar' })).toBeUndefined()
    await faixa.unmount()
  }

  const lido = await $.command.run({ command: 'le-ds', args: '', origin: COMPOSER, presentation: { isFullscreen: false, columns: 120 } })
  expect(lido.text).toBe('undefined')
})

test('rótulo vazio usa o nome da skill', { options: { skill: 'acme-design-system' } }, async ($, on) => {
  const visto = mundo(on)
  await inicia($)

  expect((await envia($, HTML)).context?.[0]).toContain('design system acme-design-system')
  expect(visto.toasts).toEqual(['DS acme-design-system anexado a este pedido · /ds off desliga'])
})
