import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { ModelUsage, On, PromptOrigin, PromptSubmitAttachment, Register } from 'claude-code'

const MINUTO = 60_000
const COMPOSER: PromptOrigin = { kind: 'composer' }

// O que fica abaixo do mod: relógio e store em memória, e o motor respondendo
// com o que o teste mandar.
function mundo(
  on: On,
  opcoes: { tokens: number; campoAceita?: boolean; semCampo?: boolean; guardado?: Record<string, unknown> },
) {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on, opcoes.guardado)
  const visto = {
    toasts: [] as string[],
    devolvidos: [] as string[],
    enviados: [] as string[],
    idSessao: 'sessao-a',
  }

  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.id', () => ({ value: visto.idSessao }))
  on('command.run', () => ({ text: 'sem resposta' }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)

    return <Box />
  })
  on('ui.toast', (_$, e) => {
    visto.toasts.push(e.text)

    return { value: undefined }
  })
  on('session.usage', () => ({
    value: { startedAt: 0, context: { tokens: opcoes.tokens, window: 1_000_000 }, rateLimits: [] },
  }))
  on('session.compact', (_$, e) => ({ messages: e.messages }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('prompt.fill', (_$, e) => {
    if (opcoes.semCampo) {
      return { isFilled: false, refusal: 'no_composer' as const }
    }

    if (opcoes.campoAceita === false) {
      return { isFilled: false, refusal: 'dialog' as const }
    }

    visto.devolvidos.push(e.text)

    return { isFilled: true }
  })
  on('prompt.submit', (_$, e) => {
    visto.enviados.push(e.text)

    return { text: e.text }
  })

  return { clock, visto }
}

async function turno($: Engine, uso?: ModelUsage, surface: 'terminal' | 'desktop' = 'terminal') {
  await $.session.start({ cwd: '/tmp', surface, isInteractive: true })
  await $.turn.start({ text: 'oi', turnId: 't1' })
  await $.turn.complete({
    answer: 'ok',
    durationMs: 1,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
    ...(uso && { usage: { ...uso, model: 'claude-opus-5-5' } }),
  })
}

const comando = ($: Engine, args: string) =>
  $.command.run({
    command: 'cache-frio',
    args,
    origin: COMPOSER,
    presentation: { isFullscreen: false, columns: 120 },
  })

// A primeira parte da resposta de `/cache-frio`: o estado do cache.
const estado = async ($: Engine) => (await comando($, '')).text?.split(' · ttl')[0]

const envia = (
  $: Engine,
  text: string,
  extra: { origin?: PromptOrigin; attachments?: PromptSubmitAttachment[]; turnId?: string } = {},
) => $.prompt.submit({ text, wait: false, origin: COMPOSER, ...extra })

test('/cache-frio: nada antes do turno, minutos enquanto quente, frio depois', async ($, on) => {
  const { clock } = mundo(on, { tokens: 212_400 })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  expect(await estado($)).toBe('sem turno nesta sessão ainda')

  await turno($)
  await clock.settle()
  expect(await estado($)).toBe('ctx 212k · cache 60min')

  await clock.advance(46 * MINUTO)
  expect(await estado($)).toBe('ctx 212k · cache 14min')

  await clock.advance(15 * MINUTO)
  expect(await estado($)).toBe('ctx 212k · cache frio')
})

test('quente não avisa', async ($, on) => {
  const { clock, visto } = mundo(on, { tokens: 212_400 })
  await turno($)
  await clock.advance(59 * MINUTO)

  expect(await envia($, 'reinicia o servidor')).toEqual({ text: 'reinicia o servidor' })
  expect(visto.toasts).toEqual([])
  expect(visto.devolvidos).toEqual([])
})

test('frio, ctx > 100k, sem anexo: segura uma vez, devolve o texto e o segundo envio passa', async ($, on) => {
  const { clock, visto } = mundo(on, { tokens: 286_609 })
  await turno($)
  await clock.advance(75 * MINUTO)

  const primeiro = await envia($, 'reinicia o servidor')
  expect(primeiro.drop).toBe(
    'Cache frio: parado há 1h15. Este envio regrava ~287k tokens. Enter de novo envia; ou compacte antes (/compact) ou abra sessão nova.',
  )
  expect(visto.devolvidos).toEqual(['reinicia o servidor'])
  expect(visto.enviados).toEqual([])

  await clock.advance(MINUTO)
  expect(await envia($, 'outro texto qualquer')).toEqual({ text: 'outro texto qualquer' })

  // Ainda no mesmo período frio (o turno não terminou): não avisa de novo.
  await clock.advance(10 * MINUTO)
  expect(await envia($, 'deu certo ai? acabou?')).toEqual({ text: 'deu certo ai? acabou?' })
  expect(visto.enviados).toEqual(['outro texto qualquer', 'deu certo ai? acabou?'])
  expect(visto.toasts).toEqual([])
})

test('frio: segundo envio depois de 3 minutos é segurado de novo', async ($, on) => {
  const { clock, visto } = mundo(on, { tokens: 200_849 })
  await turno($)
  await clock.advance(61 * MINUTO)

  expect((await envia($, 'a')).drop).toBeDefined()
  await clock.advance(4 * MINUTO)
  expect((await envia($, 'a')).drop).toBeDefined()
  expect(visto.devolvidos).toEqual(['a', 'a'])
})

test('frio com anexo passa, só com toast, uma vez', async ($, on) => {
  const { clock, visto } = mundo(on, { tokens: 200_849 })
  await turno($)
  await clock.advance(90 * MINUTO)

  const attachments: PromptSubmitAttachment[] = [{ type: 'image', mediaType: 'image/png' }]
  expect(await envia($, 'olha esse print', { attachments })).toEqual({ text: 'olha esse print' })
  expect(visto.toasts).toEqual(['Cache frio: parado há 1h30. Este envio regrava ~201k tokens.'])
  expect(visto.devolvidos).toEqual([])

  expect(await envia($, 'e esse', { attachments })).toEqual({ text: 'e esse' })
  expect(visto.toasts).toHaveLength(1)
})

test('frio com o campo recusando o texto: passa com toast, nunca segura', async ($, on) => {
  const { clock, visto } = mundo(on, { tokens: 200_849, campoAceita: false })
  await turno($)
  await clock.advance(90 * MINUTO)

  expect(await envia($, 'texto longo digitado')).toEqual({ text: 'texto longo digitado' })
  expect(visto.toasts).toHaveLength(1)
})

// O app desktop roda a engine como host SDK: `prompt.fill` recusa com no_composer, então o envio nunca é
// segurado (segurar sem devolver o texto perderia o que o usuário digitou). Só o toast avisa, uma vez.
test('app desktop (no_composer): o envio sdk passa com toast, e o seguinte passa sem outro', async ($, on) => {
  const { clock, visto } = mundo(on, { tokens: 200_849, semCampo: true })
  await turno($, undefined, 'desktop')
  await clock.advance(90 * MINUTO)

  expect(await envia($, 'texto longo digitado', { origin: { kind: 'sdk' } })).toEqual({ text: 'texto longo digitado' })
  expect(visto.enviados).toEqual(['texto longo digitado'])
  expect(visto.devolvidos).toEqual([])
  expect(visto.toasts).toEqual(['Cache frio: parado há 1h30. Este envio regrava ~201k tokens.'])

  await clock.advance(10 * MINUTO)
  expect(await envia($, 'e mais isso', { origin: { kind: 'sdk' } })).toEqual({ text: 'e mais isso' })
  expect(visto.toasts).toHaveLength(1)
})

test('origem que não é composer passa, e prompt digitado sobre turno rodando também', async ($, on) => {
  const { clock, visto } = mundo(on, { tokens: 286_609 })
  await turno($)
  await clock.advance(120 * MINUTO)

  expect(await envia($, 'tarefa terminou', { origin: { kind: 'task-notification' } })).toMatchObject({
    text: 'tarefa terminou',
  })
  expect(await envia($, 'de outro plugin', { origin: { kind: 'plugin', name: 'x' } })).toMatchObject({
    text: 'de outro plugin',
  })
  expect(await envia($, 'em cima do turno', { turnId: 't9' })).toEqual({ text: 'em cima do turno' })
  expect(await envia($, '/compact')).toEqual({ text: '/compact' })
  expect(visto.toasts).toEqual([])
  expect(visto.devolvidos).toEqual([])
})

test('ctx < 100k passa', async ($, on) => {
  const { clock, visto } = mundo(on, { tokens: 80_000 })
  await turno($)
  await clock.advance(120 * MINUTO)

  expect(await envia($, 'reinicia o servidor')).toEqual({ text: 'reinicia o servidor' })
  expect(visto.toasts).toEqual([])
  expect(await estado($)).toBe('ctx 80k · cache frio')
})

test('depois de compactar o ctx zera e o envio passa', async ($, on) => {
  const { clock, visto } = mundo(on, { tokens: 286_609 })
  await turno($)
  await clock.advance(120 * MINUTO)
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'oi', toolUses: [] }] })
  await clock.settle()

  expect(await estado($)).toBe('cache frio')
  expect(await envia($, 'segue')).toEqual({ text: 'segue' })
  expect(visto.devolvidos).toEqual([])
})

test('/cache-frio: estado, ttl e off', async ($, on) => {
  const { clock } = mundo(on, { tokens: 286_609 })
  await turno($)
  const roda = (args: string) => comando($, args)

  expect((await roda('')).text).toBe('ctx 287k · cache 60min · ttl 60 min · aviso ligado')
  expect((await roda('ttl 5')).text).toBe('ctx 287k · cache 5min · ttl 5 min · aviso ligado')

  await clock.advance(6 * MINUTO)
  expect((await envia($, 'a')).drop).toBeDefined()

  expect((await roda('off')).text).toBe('ctx 287k · cache frio · ttl 5 min · aviso desligado')
  await clock.advance(10 * MINUTO)
  expect(await envia($, 'b')).toEqual({ text: 'b' })
  expect(await estado($)).toBe('ctx 287k · cache frio')
  expect((await roda('ttl x')).text).toContain('número inteiro')
})

const inicia = ($: Engine) => $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
const encerra = ($: Engine, id: string) =>
  $.session.end({ reason: 'prompt_input_exit', sessionId: id, resume: { id } })

test('retomada depois de relançar: mesmo id de sessão segura o envio, id diferente passa', async ($, on) => {
  const { clock, visto } = mundo(on, { tokens: 200_000 })
  await turno($)
  await encerra($, 'sessao-a')
  expect(await estado($)).toBe('sem turno nesta sessão ainda')

  await clock.advance(120 * MINUTO)
  visto.idSessao = 'sessao-b'
  await inicia($)
  expect(await estado($)).toBe('sem turno nesta sessão ainda')
  expect(await envia($, 'reinicia o servidor')).toEqual({ text: 'reinicia o servidor' })
  await encerra($, 'sessao-b')

  visto.idSessao = 'sessao-a'
  await inicia($)
  expect(await estado($)).toBe('ctx 200k · cache frio')
  expect((await envia($, 'reinicia o servidor')).drop).toBe(
    'Cache frio: parado há 2h00. Este envio regrava ~200k tokens. Enter de novo envia; ou compacte antes (/compact) ou abra sessão nova.',
  )
  expect(visto.devolvidos).toEqual(['reinicia o servidor'])
})

test('retomada no mesmo processo, sem session.start: o envio restaura e é segurado', async ($, on) => {
  const { clock, visto } = mundo(on, { tokens: 200_000 })
  await turno($)
  await $.session.end({ reason: 'resume', sessionId: 'sessao-a', resume: { id: 'sessao-a' } })
  await clock.advance(120 * MINUTO)

  expect((await envia($, 'deu certo ai? acabou?')).drop).toBeDefined()
  expect(visto.devolvidos).toEqual(['deu certo ai? acabou?'])
})

test('compactar e relançar: o ctx guardado também zera', async ($, on) => {
  const { clock } = mundo(on, { tokens: 200_000 })
  await turno($)
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'oi', toolUses: [] }] })
  await encerra($, 'sessao-a')
  await clock.advance(120 * MINUTO)
  await inicia($)

  expect(await estado($)).toBe('cache frio')
  expect(await envia($, 'segue')).toEqual({ text: 'segue' })
})

test('store guarda só as 30 sessões mais recentes', async ($, on) => {
  const guardado: Record<string, unknown> = {}

  for (let i = 0; i <= 30; i += 1) {
    guardado[`sessao:s${i}`] = { fim: 1000 + i, ctx: 200_000 }
  }

  const { visto } = mundo(on, { tokens: 200_000, guardado: { ...guardado, ttl: 60 } })
  visto.idSessao = 'nova'
  await inicia($)
  await encerra($, 'nova')

  visto.idSessao = 's0'
  await inicia($)
  expect(await estado($)).toBe('sem turno nesta sessão ainda')
  await encerra($, 's0')

  // s1 ficou: restaura (fim em 1001 ms, relógio em 1_000_000 ms, ainda quente).
  visto.idSessao = 's1'
  await inicia($)
  expect(await estado($)).toBe('ctx 200k · cache 44min')
})

const BANDA = {
  plugin: 'cache-frio',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 120, scroll: { offset: 0, bodyRows: 4 }, view: {} },
} as const
const SUPERFICIES = ['terminal', 'desktop'] as const
// 196.000 lidos do cache em 200.000 de entrada: 98% hit.
const USO: ModelUsage = {
  input_tokens: 1_000,
  output_tokens: 500,
  cache_read_input_tokens: 196_000,
  cache_creation_input_tokens: 3_000,
}

// Outro mod que desenha em AbovePrompt uma linha da largura que recebe, como
// o `progresso` dimensiona as barras por `bodyColumns`: o comprimento da linha
// é a largura que ele recebeu. Roda em ambiente próprio, sem acesso ao teste.
const vizinho: Register = on => {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const abaixo = await next(e)
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        <Text>{'━'.repeat(e.props.bodyColumns)}</Text>
        {abaixo}
      </Box>
    )
  })
}

test('AbovePrompt: o cache não desenha nada; o vizinho recebe os 120 de bodyColumns e a faixa é só a dele', { plugins: [{ name: 'vizinho', register: vizinho }] }, async ($, on) => {
  const { clock } = mundo(on, { tokens: 278_000 })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  for (const surface of SUPERFICIES) {
    const faixa = await $.ui.mount({ ...BANDA, surface })
    // Antes do primeiro turno: a árvore do vizinho sobre a resposta vazia do motor.
    const doVizinho = await faixa.drawn()
    expect(doVizinho).toMatchObject({
      type: 'Box',
      props: { flexDirection: 'column' },
      children: [{ type: 'Text', children: ['━'.repeat(120)] }, { type: 'Box' }],
    })

    // Quente, faltando 9 min, frio e com turno rodando: a mesma árvore.
    await turno($, USO)
    expect(await faixa.drawn()).toEqual(doVizinho)
    await clock.advance(51 * MINUTO)
    expect(await faixa.drawn()).toEqual(doVizinho)
    await clock.advance(10 * MINUTO)
    expect(await faixa.drawn()).toEqual(doVizinho)
    await $.turn.start({ text: 'oi', turnId: 't2' })
    expect(await faixa.drawn()).toEqual(doVizinho)

    await faixa.unmount()
    await $.session.end({ reason: 'clear', sessionId: 'sessao-a', resume: { id: 'sessao-a' } })
  }
})

test('AbovePrompt sem vizinho: a faixa é a resposta vazia do motor, com cache frio', async ($, on) => {
  const { clock } = mundo(on, { tokens: 278_000 })
  await turno($, USO)
  await clock.advance(90 * MINUTO)

  for (const surface of SUPERFICIES) {
    const faixa = await $.ui.mount({ ...BANDA, surface })
    expect(await faixa.drawn()).toMatchObject({ type: 'Box' })
    expect(JSON.stringify(await faixa.drawn())).not.toContain('●')
    await faixa.unmount()
  }
})

test('/cache-frio responde o detalhe: ctx, tempo restante, hit de um usage conhecido e ttl', async ($, on) => {
  const { clock } = mundo(on, { tokens: 278_000 })
  await turno($, USO)
  await clock.advance(16 * MINUTO)

  expect((await comando($, '')).text).toBe('ctx 278k · cache 44min · 98% hit · ttl 60 min · aviso ligado')
})

test('/cache-frio faixa: o subcomando saiu, responde o uso', async ($, on) => {
  mundo(on, { tokens: 278_000 })
  await turno($, USO)

  expect((await comando($, 'faixa off')).text).toBe('Use /cache-frio, /cache-frio ttl <minutos>, /cache-frio off ou /cache-frio on.')
})
