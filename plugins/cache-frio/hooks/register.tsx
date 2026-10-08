import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Sessao } from '../types'

const NOVA: Sessao = { fim: 0, ctx: 0, hit: null, rodando: false, avisadoEm: 0, liberado: false }
const sessao = atom({ plugin: 'cache-frio', key: 'sessao' } as const, NOVA)

const TTL_PADRAO_MIN = 60
const CTX_MINIMO = 100_000
const JANELA_SEGUNDO_ENVIO_MS = 3 * 60_000
const MINUTO = 60_000
// Fim do último turno, ctx e hit por id de sessão, para a retomada depois de
// relançar o app; `$.clock.now()` é ms desde a época, comparável entre processos.
const CHAVE_SESSAO = 'sessao:'
const MAX_SESSOES = 30

type Guardada = Pick<Sessao, 'fim' | 'ctx' | 'hit'>

const k = (tokens: number) => `${Math.round(tokens / 1000)}k`

const duracao = (ms: number) => {
  const min = Math.floor(ms / MINUTO)

  return min < 60 ? `${min} min` : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`
}

let ttlMin = TTL_PADRAO_MIN
let avisa = true

const cache = (s: Sessao, agora: number) => {
  const resta = s.rodando ? ttlMin * MINUTO : s.fim + ttlMin * MINUTO - agora

  return resta > 0 ? `cache ${Math.ceil(resta / MINUTO)}min` : 'cache frio'
}

async function linha($: EngineInterface) {
  const s = await read($, sessao)

  if (s.fim === 0) {
    return undefined
  }

  const texto = cache(s, await $.clock.now())
  const comCtx = s.ctx > 0 ? `ctx ${k(s.ctx)} · ${texto}` : texto

  return s.hit != null ? `${comCtx} · ${s.hit}% hit` : comCtx
}

async function guarda($: EngineInterface, s: Sessao) {
  const feita: Guardada = { fim: s.fim, ctx: s.ctx, hit: s.hit ?? null }
  await $.store.set(CHAVE_SESSAO + (await $.session.id()), feita)
}

async function restaura($: EngineInterface) {
  const feita = (await $.store.get(CHAVE_SESSAO + (await $.session.id()))) as Guardada | undefined

  if (feita !== undefined) {
    await update($, sessao, s => (feita.fim > s.fim ? { ...NOVA, ...feita } : s))
  }
}

// O contexto encolheu: o ctx conhecido zera até o próximo turno.
async function zeraCtx($: EngineInterface) {
  const s = await read($, sessao)
  const zerada: Sessao = { ...s, ctx: 0 }
  await update($, sessao, () => zerada)

  if (s.fim > 0) {
    await guarda($, zerada)
  }
}

async function poda($: EngineInterface) {
  const chaves = (await $.store.keys()).filter(chave => chave.startsWith(CHAVE_SESSAO))

  if (chaves.length <= MAX_SESSOES) {
    return
  }

  const fins = await Promise.all(
    chaves.map(async chave => ({ chave, fim: ((await $.store.get(chave)) as Guardada).fim })),
  )
  fins.sort((a, b) => b.fim - a.fim)
  await Promise.all(fins.slice(MAX_SESSOES).map(velha => $.store.delete(velha.chave)))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    ttlMin = Number(await $.store.get('ttl')) || TTL_PADRAO_MIN
    avisa = (await $.store.get('aviso')) !== false
    await $.command.register({
      name: 'cache-frio',
      description: 'Aviso de cache frio: estado, ttl em minutos, off e on',
      argumentHint: '[ttl <minutos> | off | on]',
    })
    await restaura($)
    await poda($)

    return next(e)
  })

  on('command.run', { command: 'cache-frio' }, async ($, e) => {
    const [acao, valor] = e.args.trim().toLowerCase().split(/\s+/)

    if (acao === 'ttl') {
      const min = Number(valor)

      if (!Number.isInteger(min) || min < 1) {
        return { text: 'Use /cache-frio ttl <minutos>, com um número inteiro a partir de 1.' }
      }

      ttlMin = min
      await $.store.set('ttl', min)
    } else if (acao === 'off' || acao === 'on') {
      avisa = acao === 'on'
      await $.store.set('aviso', avisa)
    } else if (acao) {
      return { text: 'Use /cache-frio, /cache-frio ttl <minutos>, /cache-frio off ou /cache-frio on.' }
    }

    const estado = (await linha($)) ?? 'sem turno nesta sessão ainda'

    return { text: `${estado} · ttl ${ttlMin} min · aviso ${avisa ? 'ligado' : 'desligado'}` }
  })

  on('turn.start', async ($, e, next) => {
    await update($, sessao, s => ({ ...s, rodando: true }))

    return next(e)
  })

  // O uso de `turn.complete` soma todas as requisições do turno: serve para o
  // hit, não para o ctx, que é o `context.tokens` da sessão (última requisição).
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      const [agora, uso, s] = await Promise.all([$.clock.now(), $.session.usage(), read($, sessao)])
      const lidos = e.usage?.cache_read_input_tokens ?? 0
      const entrada = lidos + (e.usage?.cache_creation_input_tokens ?? 0) + (e.usage?.input_tokens ?? 0)
      const fechada: Sessao = {
        ...NOVA,
        fim: agora,
        ctx: uso.context.tokens ?? s.ctx,
        hit: entrada > 0 ? Math.round((100 * lidos) / entrada) : (s.hit ?? null),
      }
      await update($, sessao, () => fechada)
      await guarda($, fechada)
    }

    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const feito = await next(e)

    if (e.agentId === undefined && e.trigger !== 'precompute' && feito.skip === undefined) {
      await zeraCtx($)
    }

    return feito
  })

  // A sessão que segue (depois de /clear, de uma retomada ou de relançar o app)
  // tem outro histórico: o estado zera e volta do store pelo id dela.
  on('session.end', async ($, e, next) => {
    await update($, sessao, () => NOVA)

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    // Só o Enter do usuário com a sessão ociosa (`composer` no terminal, `sdk` no
    // app desktop); comando de barra passa, para /compact e /clear nunca serem segurados.
    const doUsuario = e.origin.kind === 'composer' || e.origin.kind === 'sdk'

    if (!avisa || !doUsuario || e.turnId !== undefined || e.text.startsWith('/')) {
      return next(e)
    }

    let s = await read($, sessao)

    // Retomada sem `session.start` (troca de sessão no mesmo processo).
    if (s.fim === 0) {
      await restaura($)
      s = await read($, sessao)
    }

    if (s.fim === 0 || s.liberado || s.ctx <= CTX_MINIMO) {
      return next(e)
    }

    const agora = await $.clock.now()
    const parado = agora - s.fim

    if (parado <= ttlMin * MINUTO) {
      return next(e)
    }

    const libera = () => update($, sessao, x => ({ ...x, liberado: true }))

    if (s.avisadoEm > 0 && agora - s.avisadoEm <= JANELA_SEGUNDO_ENVIO_MS) {
      await libera()

      return next(e)
    }

    const custo = `Cache frio: parado há ${duracao(parado)}. Este envio regrava ~${k(s.ctx)} tokens.`
    const temAnexo = (e.attachments?.length ?? 0) > 0
    // Só segura o envio com o texto já de volta no campo: anexo não volta por
    // `prompt.fill`, e um campo que recusa o texto também não (diálogo aberto, ou
    // o app desktop, que não tem campo na engine: no_composer). Aí só avisa.
    const voltou = !temAnexo && (await $.prompt.fill({ text: e.text })).isFilled

    if (!voltou) {
      await libera()
      $.ui.toast(custo, { timeoutMs: 8000 })

      return next(e)
    }

    await update($, sessao, x => ({ ...x, avisadoEm: agora }))

    return { drop: `${custo} Enter de novo envia; ou compacte antes (/compact) ou abra sessão nova.` }
  })
}
