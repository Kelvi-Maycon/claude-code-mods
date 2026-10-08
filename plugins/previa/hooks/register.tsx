import { atom, read, update } from 'claude-code'
import type {
  EngineInterface,
  HookStream,
  ProcessSpawnChunk,
  ProcessSpawnResult,
  Register,
  Timer,
} from 'claude-code'

import type { Servidor } from '../types'

type Filho = HookStream<ProcessSpawnChunk, ProcessSpawnResult>

const servidores = atom({ plugin: 'previa', key: 'servidores' } as const, [])

const PRIMEIRA_PORTA = 8765
const MAXIMO = 3
const FIM: ProcessSpawnResult = { code: null, signal: null }

// Processos que este carregamento do mod abriu, por raiz. Um reload zera o mapa
// e a engine mata os filhos; o session.start seguinte os levanta de novo.
const vivos = new Map<string, Filho>()
const falhas = new Map<string, { vezes: number; erro: string }>()
const caidos = new Set<string>()
let fila: Promise<void> = Promise.resolve()
let gravado = '[]'
let ultimoHtml: string | undefined
let batida: Timer | undefined
let avisado = ''
let restaurar = false

const pai = (caminho: string) =>
  caminho.slice(0, caminho.lastIndexOf('/')) || '/'

const nome = (caminho: string) =>
  caminho.slice(caminho.lastIndexOf('/') + 1) || '/'

const urlDe = (s: Servidor) =>
  `http://localhost:${s.porta}/${s.arquivo.split('/').map(encodeURIComponent).join('/')}`

// argv em lista: a raiz pode ter espaço e nunca passa por shell.
const argvDe = (s: Servidor) => [
  'python3',
  '-m',
  'http.server',
  String(s.porta),
  '--bind',
  '127.0.0.1',
  '--directory',
  s.raiz,
]

const comLimite = <T,>(
  mapa: Record<string, T>,
  chave: string,
  valor: T,
  limite: number,
) => {
  const outras = Object.entries(mapa).filter(([k]) => k !== chave)

  return Object.fromEntries([...outras, [chave, valor] as const].slice(-limite))
}

const pidNa = async ($: EngineInterface, porta: number) => {
  const { stdout } = await $.process.run([
    'lsof',
    '-nP',
    `-iTCP:${porta}`,
    '-sTCP:LISTEN',
    '-t',
  ])

  return stdout.trim().split('\n')[0] ?? ''
}

// Quem escuta na porta do servidor, e se é um http.server idêntico ao nosso
// (outra sessão do usuário servindo a mesma raiz, ou um órfão de sessão anterior).
const ocupante = async ($: EngineInterface, s: Servidor) => {
  const pid = await pidNa($, s.porta)

  if (pid === '') {
    return { pid, igual: false }
  }

  const { stdout } = await $.process.run(['ps', '-ww', '-p', pid, '-o', 'command='])

  return { pid, igual: stdout.trim().endsWith(argvDe(s).slice(1).join(' ')) }
}

const portaLivre = async ($: EngineInterface, portas: Record<string, number>) => {
  const reservadas = new Set(Object.values(portas))

  for (let porta = PRIMEIRA_PORTA; porta < PRIMEIRA_PORTA + 100; porta++) {
    if (!reservadas.has(porta) && (await pidNa($, porta)) === '') {
      return porta
    }
  }

  return 0
}

const subir = ($: EngineInterface, s: Servidor) => {
  const filho = $.process.spawn({ argv: argvDe(s) })
  vivos.set(s.raiz, filho)

  void (async () => {
    const inicio = await $.clock.now()
    let erro = ''

    try {
      for await (const { stream, text } of filho) {
        if (stream === 'stderr') {
          erro = text.trim().split('\n').pop() ?? ''
        }
      }
    } catch (falha) {
      erro = String(falha)
    }

    if (vivos.get(s.raiz) !== filho) {
      return
    }

    vivos.delete(s.raiz)

    if ((await $.clock.now()) - inicio < 5000) {
      const vezes = (falhas.get(s.raiz)?.vezes ?? 0) + 1
      falhas.set(s.raiz, { vezes, erro: erro.slice(0, 80) })
    } else {
      falhas.delete(s.raiz)
      caidos.add(s.raiz)
    }
  })()
}

// Deixa um servidor da lista no ar. Devolve o motivo quando ele deve sair dela.
const levantar = async ($: EngineInterface, s: Servidor) => {
  const falha = falhas.get(s.raiz)

  if (falha !== undefined && falha.vezes >= 3) {
    falhas.delete(s.raiz)

    return falha.erro || 'o servidor não subiu'
  }

  const pasta = await $.fs.stat(s.raiz).catch(() => undefined)

  if (pasta?.kind !== 'dir') {
    return 'a pasta não existe mais'
  }

  const portas = ((await $.store.get('portas')) ?? {}) as Record<string, number>
  const preferida = s.porta || portas[s.raiz] || 0
  const dono =
    preferida > 0 ? await ocupante($, { ...s, porta: preferida }) : undefined
  const serve = dono !== undefined && (dono.igual || dono.pid === '')
  const porta = serve ? preferida : await portaLivre($, portas)

  if (porta === 0) {
    return `sem porta livre a partir de ${PRIMEIRA_PORTA}`
  }

  const pronto = { ...s, porta }

  if (porta !== s.porta) {
    await update($, servidores, lista =>
      lista.map(um => (um.raiz === s.raiz ? { ...um, porta } : um)),
    )
  }

  if (portas[s.raiz] !== porta) {
    await $.store.set('portas', comLimite(portas, s.raiz, porta, 60))
  }

  // Porta já atendida por um http.server idêntico: usa esse, sem duplicar.
  if (dono?.igual !== true) {
    subir($, pronto)
  }

  if (caidos.delete(s.raiz)) {
    $.ui.toast(`Prévia de ${nome(s.raiz)} caiu e voltou em ${urlDe(pronto)}`)
  }

  return undefined
}

const reconciliar = async ($: EngineInterface) => {
  const lista = await read($, servidores)

  for (const [raiz, filho] of vivos) {
    if (!lista.some(s => s.raiz === raiz)) {
      vivos.delete(raiz)
      void filho.return(FIM)
    }
  }

  for (const s of lista) {
    if (vivos.has(s.raiz)) {
      continue
    }

    const motivo = await levantar($, s)

    if (motivo !== undefined) {
      await update($, servidores, atual => atual.filter(um => um.raiz !== s.raiz))
      $.ui.toast(`Prévia de ${nome(s.raiz)} saiu: ${motivo}`)
    }
  }

  const final = await read($, servidores)
  const texto = JSON.stringify(final)

  if (texto !== gravado) {
    const sessoes = ((await $.store.get('sessoes')) ?? {}) as Record<string, Servidor[]>
    await $.store.set(
      'sessoes',
      comLimite(sessoes, await $.session.id(), final, 20),
    )
    gravado = texto
  }
}

const rodar = ($: EngineInterface) => {
  fila = fila
    .then(() => reconciliar($))
    .catch(erro => $.ui.log(`previa: ${String(erro)}`, { to: 'debug' }))

  return fila
}

// O spawn sai de um timer, fora do dispatch do hook que pediu: assim o processo
// não fica preso ao sinal de um tool.call ou de um comando.
const acertar = ($: EngineInterface) =>
  new Promise<void>(feito => {
    $.clock.after(0, () => void rodar($).then(feito))
  })

// Raiz a servir: o diretório mais próximo com index.html, sem passar do
// diretório da sessão; fora dele, sem subir até a pasta do usuário.
const raizDe = async ($: EngineInterface, arquivo: string) => {
  const sessao = await $.fs
    .stat(await $.session.cwd(), { resolve: true })
    .catch(() => undefined)
  const cwd = sessao?.realPath
  const dentro = cwd !== undefined && arquivo.startsWith(`${cwd}/`)

  for (
    let dir = pai(arquivo);
    dentro ? dir.length >= cwd.length : dir.split('/').length > 4;
    dir = pai(dir)
  ) {
    if (await $.fs.exists(`${dir}/index.html`)) {
      return dir
    }
  }

  return pai(arquivo)
}

// Põe a pasta (ou a raiz do arquivo) na frente da lista. Devolve a raiz, ou
// undefined quando o caminho não existe.
const servir = async ($: EngineInterface, caminho: string) => {
  const alvo = await $.fs.stat(caminho, { resolve: true }).catch(() => undefined)
  const real = alvo?.realPath

  if (alvo === undefined || real === undefined || alvo.kind === 'other') {
    return undefined
  }

  const raiz = alvo.kind === 'dir' ? real : await raizDe($, real)
  const arquivo = alvo.kind === 'dir' ? '' : real.slice(raiz.length + 1)
  const [primeiro] = await read($, servidores)
  const mudou = primeiro?.raiz !== raiz || (arquivo !== '' && primeiro.arquivo !== arquivo)

  if (mudou) {
    await update($, servidores, lista => {
      const antigo = lista.find(s => s.raiz === raiz)
      const novo = {
        raiz,
        porta: antigo?.porta ?? 0,
        arquivo: arquivo || antigo?.arquivo || '',
      }

      return [novo, ...lista.filter(s => s !== antigo)].slice(0, MAXIMO)
    })
  }

  return raiz
}

// Tira da lista um servidor, ou todos. Devolve quantos saíram.
const desligar = async ($: EngineInterface, raiz?: string) => {
  const lista = await read($, servidores)
  const saem = lista.filter(s => raiz === undefined || s.raiz === raiz)

  await update($, servidores, atual =>
    atual.filter(s => !saem.some(um => um.raiz === s.raiz)),
  )

  // Servidor idêntico que não é filho deste carregamento (órfão de sessão
  // anterior): o stream não existe, então o pedido de parar vai por PID.
  for (const s of saem) {
    const dono = vivos.has(s.raiz) || s.porta === 0 ? undefined : await ocupante($, s)

    if (dono?.igual === true) {
      await $.process.run(['kill', dono.pid])
    }
  }

  await acertar($)

  return saem.length
}

// A lista que o store guarda para a sessão em curso, quando a tela está vazia.
const restaurarSessao = async ($: EngineInterface) => {
  if ((await read($, servidores)).length > 0) {
    return
  }

  const sessoes = ((await $.store.get('sessoes')) ?? {}) as Record<string, Servidor[]>
  const salvos = sessoes[await $.session.id()] ?? []

  if (salvos.length > 0) {
    await update($, servidores, () => salvos)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'previa',
      description: 'Liga, lista ou para o servidor de prévia',
      argumentHint: '[caminho | status | parar]',
      immediate: true,
    })
    const iniciada = await next(e)

    restaurar = false
    await restaurarSessao($)

    batida?.cancel()
    batida = $.clock.every(15000, () => void rodar($))
    void acertar($)

    return iniciada
  })

  // /clear e /resume seguem no mesmo processo com outro id e sem session.start: os
  // servidores da sessão que acabou param (o store fica com a lista dela) e os da
  // seguinte voltam no primeiro envio.
  on('session.end', async ($, e, next) => {
    for (const filho of vivos.values()) {
      void filho.return(FIM)
    }

    vivos.clear()
    gravado = '[]'
    avisado = ''
    restaurar = true
    await update($, servidores, () => [])

    return next(e)
  })

  on('tool.call', { tool: ['Write', 'Edit'] }, async ($, e, next) => {
    const feito = await next(e)
    const gravou = feito.deny === undefined && feito.isError !== true

    // Rascunho em pasta temporária (scratchpad de agente) não vira prévia.
    const temporario = /^\/(private\/)?(tmp|var\/folders)\//.test(e.file_path)

    if (gravou && !temporario && /\.html$/i.test(e.file_path)) {
      ultimoHtml = e.file_path
      await servir($, e.file_path)
        .then(() => void acertar($))
        .catch(erro => $.ui.log(`previa: ${String(erro)}`, { to: 'debug' }))
    }

    return feito
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ativos = (await read($, servidores)).filter(s => s.porta > 0)

    if (ativos.length === 0 || !/\b(pkill|killall|kill)\b/.test(e.command)) {
      return next(e)
    }

    // "pkill -f 'python3 render.py'" mira outro processo e passa.
    const emMassa =
      /\b(pkill|killall)\b[^|;&\n]*(http\.server|\bpython3?["']?\s*(?:$|[|;&\n]))/i
    const mata = async (s: Servidor) => {
      const porPorta = new RegExp(`(lsof\\b[^|;&\\n]*:|kill-port\\s+)${s.porta}\\b`)

      if (porPorta.test(e.command)) {
        return true
      }

      const { pid } = await ocupante($, s)

      return pid !== '' && new RegExp(`\\bkill\\b[^|;&\\n]*\\s${pid}\\b`).test(e.command)
    }
    let alvo = emMassa.test(e.command) ? ativos[0] : undefined

    for (const s of ativos) {
      alvo ??= (await mata(s)) ? s : undefined
    }

    return alvo === undefined
      ? next(e)
      : {
          deny: `previa: esse comando derruba o servidor de prévia do usuário em http://localhost:${alvo.porta}/ (pasta ${alvo.raiz}). Ele não foi aberto pela tarefa. Quem encerra é o usuário, com /previa parar.`,
        }
  })

  on('prompt.submit', async ($, e, next) => {
    if (restaurar) {
      restaurar = false
      await restaurarSessao($)
      // Levanta antes do aviso, para a linha dizer a porta em que o servidor ficou.
      await acertar($)
    }

    const ativos = (await read($, servidores)).filter(s => s.porta > 0)

    const onde = ativos
      .map(s => `http://localhost:${s.porta}/ (pasta ${s.raiz})`)
      .join(', ')

    // A linha entra uma vez por conjunto de servidores, não a cada pedido. No app desktop o envio do
    // usuário chega como `sdk`; no terminal, como `composer`.
    const doUsuario = e.origin.kind === 'composer' || e.origin.kind === 'sdk'
    if (!doUsuario || onde === avisado || onde === '') {
      return next(e)
    }

    avisado = onde
    const linha = `previa: servidor de prévia do usuário ativo em ${onde}. Não iniciar outro servidor para essa pasta nem encerrar este; ele não foi aberto pela tarefa.`

    return next({ ...e, context: [...(e.context ?? []), linha] })
  })

  // O resumo da compactação não guarda a linha: o próximo pedido avisa de novo.
  on('session.compact', ($, e, next) => {
    avisado = ''

    return next(e)
  })

  on('command.run', { command: 'previa' }, async ($, e) => {
    const pedido = e.args.trim().replace(/^(['"])(.*)\1$/, '$2')

    if (pedido === 'parar') {
      const quantos = await desligar($)

      return {
        text:
          quantos === 0
            ? 'Nenhum servidor ativo.'
            : `${quantos} ${quantos === 1 ? 'servidor encerrado' : 'servidores encerrados'}.`,
      }
    }

    if (pedido === 'status') {
      const ativos = (await read($, servidores)).filter(s => s.porta > 0)

      return {
        text:
          ativos.length === 0
            ? 'Nenhum servidor ativo.'
            : ativos.map(s => `${nome(s.raiz)} ${urlDe(s)}`).join(' | '),
      }
    }

    const cwd = await $.session.cwd()
    const home = await $.env.get('HOME')
    const caminho =
      pedido === ''
        ? (ultimoHtml ?? cwd)
        : pedido.startsWith('~/') && home !== undefined
          ? `${home}${pedido.slice(1)}`
          : pedido.startsWith('/')
            ? pedido
            : `${cwd}/${pedido}`
    const raiz = await servir($, caminho)

    if (raiz === undefined) {
      return { text: `Caminho não encontrado: ${caminho}.` }
    }

    await acertar($)
    const servidor = (await read($, servidores)).find(s => s.raiz === raiz)

    return {
      text:
        servidor === undefined || servidor.porta === 0
          ? `O servidor não subiu em ${raiz}.`
          : `No ar: ${urlDe(servidor)}`,
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const ativos = (await read($, servidores)).filter(s => s.porta > 0)

    if (e.props.hasSurvey || ativos.length === 0) {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    // O que os outros mods desenham na faixa continua acima das linhas da prévia.
    const abaixo = await next(e)

    return (
      <Box flexDirection="column">
        {abaixo}
        {ativos.map(s => {
          const url = urlDe(s)

          return (
            <Box gap={2}>
              <Text dimColor>Prévia</Text>
              <Text bold>{nome(s.raiz)}</Text>
              <Text wrap="truncate-middle">{url}</Text>
              <Box gap={1}>
                <Button
                  key={`abrir-${s.porta}`}
                  label="Abrir"
                  onPress={() => void $.process.run(['open', url])}
                />
                <Button
                  key={`copiar-${s.porta}`}
                  label="Copiar"
                  onPress={press => void $.ui.copy({ text: url, surface: press.surface })}
                />
                <Button
                  key={`parar-${s.porta}`}
                  label="Parar"
                  onPress={() => void desligar($, s.raiz)}
                />
              </Box>
            </Box>
          )
        })}
      </Box>
    )
  })
}
