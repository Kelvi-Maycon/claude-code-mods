import { expect, mock, test } from 'claude-code/testing'

const CWD = '/home/dev/projetos/loja'
const BAND = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 120,
  scroll: { top: 0, bodyRows: 10, totalRows: 0 },
} as never

for (const surface of ['terminal', 'desktop'] as const) {
  test(`Write em .html sobe o servidor e a faixa mostra a URL (${surface})`, async ($, on) => {
    const clock = mock.clock(on)
    mock.store(on)
    mock.env(on, { HOME: '/home/dev' })

    const spawned: string[][] = []
    const ran: string[][] = []
    const dirs = new Set([CWD, `${CWD}/site`, `${CWD}/site/paginas`])
    const files = new Set([`${CWD}/site/index.html`, `${CWD}/site/paginas/sobre nos.html`])

    on('session.start', (_, e) => ({ cwd: e.cwd }))
    on('session.cwd', () => ({ value: CWD }))
    on('session.id', () => ({ value: 'sessao-1' }))
    on('command.register', (_, e) => ({ value: { command: e.name } }))
    on('ui.render', () => ({ type: 'engine', ref: 0 }))
    on('ui.toast', () => ({ value: undefined }))
    on('ui.log', () => ({ value: undefined }))
    on('fs.exists', (_, e) => ({ value: files.has(e.path) }))
    on('fs.stat', (_, e) => {
      if (!dirs.has(e.path) && !files.has(e.path)) throw new Error('ENOENT')
      const kind = dirs.has(e.path) ? ('dir' as const) : ('file' as const)
      return { value: { kind, size: 0, mtimeMs: 0, isLink: false, realPath: e.path } }
    })
    on('process.run', (_, e) => {
      ran.push([...e.argv])
      return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    on('process.spawn', async function* (_, e) {
      spawned.push([...e.argv])
      await clock.sleep(1e12)
      return { value: { code: 0, signal: null } }
    })
    on('tool.call', () => ({ result: {} }) as never)
    on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))

    await $.session.start({ cwd: CWD, surface, isInteractive: true })
    await clock.settle()

    const band = await $.ui.mount({ plugin: 'previa', surface, component: 'AbovePrompt', props: BAND })
    expect(await band.find({ text: /localhost/ })).toBeUndefined()

    await $.tool.call({ tool: 'Write', file_path: `${CWD}/site/paginas/sobre nos.html`, content: '<p>oi</p>' })
    await clock.settle()

    expect(spawned).toEqual([
      ['python3', '-m', 'http.server', '8765', '--bind', '127.0.0.1', '--directory', `${CWD}/site`],
    ])
    const url = 'http://localhost:8765/paginas/sobre%20nos.html'
    expect((await band.find({ text: url }))?.text).toMatch(url)
    expect(await band.findAll({ type: 'Button' })).toHaveLength(3)

    // Segunda edição na mesma raiz não abre outro processo.
    await $.tool.call({ tool: 'Edit', file_path: `${CWD}/site/index.html`, old_string: 'a', new_string: 'b' })
    await clock.settle()
    expect(spawned).toHaveLength(1)
    expect((await band.find({ text: /localhost:8765\/index\.html/ }))?.text).toMatch('index.html')

    // O modelo é avisado uma vez, também no app desktop (origem sdk); notificação de tarefa não conta.
    const tarefa = await $.prompt.submit({ text: 'fim', wait: false, origin: { kind: 'task-notification' } as never })
    expect(tarefa.context).toBeUndefined()
    const desktop = await $.prompt.submit({ text: 'oi', wait: false, origin: { kind: 'sdk' } as never })
    expect(desktop.context?.[0]).toMatch('servidor de prévia do usuário ativo em http://localhost:8765/')
    const segundo = await $.prompt.submit({ text: 'oi', wait: false, origin: { kind: 'sdk' } as never })
    expect(segundo.context).toBeUndefined()

    // O comando que mataria o servidor é negado.
    const kill = await $.tool.call({ tool: 'Bash', command: 'pkill -f http.server' })
    expect(kill.deny).toMatch('/previa parar')
    const ok = await $.tool.call({ tool: 'Bash', command: 'ls -la' })
    expect(ok.deny).toBeUndefined()

    await band.press({ key: 'parar-8765' })
    await clock.settle()
    expect(await band.find({ text: /localhost/ })).toBeUndefined()
  })
}

test('porta ocupada pula para a seguinte, queda religa na mesma porta, /previa responde', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  mock.env(on, { HOME: '/home/dev' })

  const spawned: string[][] = []
  const toasts: string[] = []
  const answer = (stdout: string) => ({
    value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  })

  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: CWD }))
  on('session.id', () => ({ value: 'sessao-2' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('fs.exists', () => ({ value: false }))
  on('fs.stat', (_, e) => {
    if (e.path !== CWD) throw new Error('ENOENT')
    return { value: { kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false, realPath: e.path } }
  })
  // 8765 pertence a outro programa; as demais portas estão livres.
  on('process.run', (_, e) =>
    answer(e.argv.includes('-iTCP:8765') ? '999\n' : e.argv[0] === 'ps' ? 'nginx: master' : ''),
  )
  on('process.spawn', async function* (_, e) {
    spawned.push([...e.argv])
    await clock.sleep(spawned.length === 1 ? 20_000 : 1e12)
    return { value: { code: 1, signal: null } }
  })

  // O comando espera o timer que levanta o servidor: o relógio anda enquanto ele corre.
  const previa = async (args: string) => {
    const pending = $.command.run({ command: 'previa', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
    await clock.settle()

    return pending
  }

  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  await clock.settle()

  const on1 = await previa('')
  expect(on1.text).toBe('No ar: http://localhost:8766/')
  expect(spawned[0]).toEqual(['python3', '-m', 'http.server', '8766', '--bind', '127.0.0.1', '--directory', CWD])

  const missing = await previa('nao existe')
  expect(missing.text).toMatch('Caminho não encontrado')

  // O processo morre aos 20 s; a checagem dos 30 s o religa na mesma porta.
  await clock.advance(31_000)
  expect(spawned).toHaveLength(2)
  expect(spawned[1]).toEqual(spawned[0])
  expect(toasts).toEqual(['Prévia de loja caiu e voltou em http://localhost:8766/'])

  const status = await previa('status')
  expect(status.text).toBe('loja http://localhost:8766/')

  const stop = await previa('parar')
  expect(stop.text).toBe('1 servidor encerrado.')
  expect((await previa('status')).text).toBe('Nenhum servidor ativo.')

  await clock.advance(31_000)
  expect(spawned).toHaveLength(2)
})

test('/clear e /resume no mesmo processo: o aviso volta na conversa nova e a lista volta no primeiro envio', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  mock.env(on, { HOME: '/home/dev' })

  const sessao = { id: 's1' }
  const spawned: string[][] = []
  const dirs = new Set([CWD, `${CWD}/site`])
  const files = new Set([`${CWD}/site/index.html`])

  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('session.cwd', () => ({ value: CWD }))
  on('session.id', () => ({ value: sessao.id }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.render', () => ({ type: 'engine', ref: 0 }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('fs.exists', (_, e) => ({ value: files.has(e.path) }))
  on('fs.stat', (_, e) => {
    if (!dirs.has(e.path) && !files.has(e.path)) throw new Error('ENOENT')
    const kind = dirs.has(e.path) ? ('dir' as const) : ('file' as const)
    return { value: { kind, size: 0, mtimeMs: 0, isLink: false, realPath: e.path } }
  })
  on('process.run', () => ({
    value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('process.spawn', async function* (_, e) {
    spawned.push([...e.argv])
    await clock.sleep(1e12)
    return { value: { code: 0, signal: null } }
  })
  on('tool.call', () => ({ result: {} }) as never)
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))

  // O envio que restaura espera o timer que levanta o servidor.
  const envia = async (text: string) => {
    const pending = $.prompt.submit({ text, wait: false, origin: { kind: 'sdk' } as never })
    await clock.settle()

    return pending
  }
  const escreve = async () => {
    await $.tool.call({ tool: 'Write', file_path: `${CWD}/site/index.html`, content: '<p>oi</p>' })
    await clock.settle()
  }

  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  await clock.settle()
  const band = await $.ui.mount({ plugin: 'previa', surface: 'desktop', component: 'AbovePrompt', props: BAND })

  await escreve()
  expect(spawned).toHaveLength(1)
  expect((await envia('oi')).context?.[0]).toMatch('http://localhost:8765/')

  // /clear: a sessão nova começa sem servidor e sem linha de contexto.
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  sessao.id = 's2'
  await clock.settle()
  expect(await band.find({ text: /localhost/ })).toBeUndefined()
  expect((await envia('nova conversa')).context).toBeUndefined()
  expect(spawned).toHaveLength(1)

  // A mesma pasta volta na mesma porta: o modelo da conversa nova é avisado de novo.
  await escreve()
  expect(spawned).toHaveLength(2)
  expect(spawned[1]).toEqual(spawned[0])
  expect((await envia('e agora')).context?.[0]).toMatch('http://localhost:8765/')

  // /resume de volta à s1: o primeiro envio traz a lista dela e levanta o servidor.
  await $.session.end({ reason: 'resume', sessionId: 's2', resume: { id: 's2' } })
  sessao.id = 's1'
  await clock.settle()
  expect(await band.find({ text: /localhost/ })).toBeUndefined()

  const retomada = await envia('continua')
  expect(spawned).toHaveLength(3)
  expect(retomada.context?.[0]).toMatch('servidor de prévia do usuário ativo em http://localhost:8765/')
  expect((await band.find({ text: /localhost:8765\/index\.html/ }))?.text).toMatch('index.html')
  await band.unmount()
})
