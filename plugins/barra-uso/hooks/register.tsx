import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelUsage, Register } from 'claude-code'

import type { Cache, Limite, Uso } from '../types'
import { extras, linha, partes, pilulas, rotuloDs, semExtra, texto } from './modelo'
import type { Cor } from './modelo'
import { RESPIRO, linhaDoUso } from './svg'

const VAZIO: Uso = { cincoHoras: null, seteDias: null, ctx: null, cache: null, agora: 0 }
const uso = atom({ plugin: 'barra-uso', key: 'uso' } as const, VAZIO)
const visivel = atom({ plugin: 'barra-uso', key: 'visivel' } as const, true)

// Ponto de compactação automática presumido quando a API não informa limite nem janela.
const LIMITE_CTX_PADRAO = 275_000
const COR_TERMINAL: Record<Cor, string | undefined> = { orange: undefined, pos: 'success', warn: 'warning', neg: 'error' }

// A área acima do prompt no app desktop não tem 8 px por coluna: medida no app, fica entre 7,69 e 7,8 px por
// coluna, e a conta de 8 px estourava a linha (as imagens encolhiam e uma pílula perdia a borda). A estimativa fica no menor valor medido e só dimensiona os desenhos; a borda direita
// vem do layout, que absorve a folga.
const larguraUtil = (colunas: number) => Math.max(320, Math.floor(colunas * 7.69) - 2)

// Leitura de um átomo de outro mod. O tipo de `ativo` é do contrato do `ds-primeiro`; redeclarar aqui
// conflita com ele quando os dois carregam, então a faixa lê sem o tipo e confere o valor.
type LeAtomoAlheio = (ref: { plugin: string; key: string }) => Promise<{ value: unknown }>

// O `ds-primeiro` publica o DS ligado nesta sessão; nunca escrito (undefined) quer dizer que ele não
// está carregado, e o botão sai. Lido ao desenhar, o `/ds on|off` redesenha a faixa.
async function dsLigado($: EngineInterface) {
  const { value } = await ($.state.get as LeAtomoAlheio)({ plugin: 'ds-primeiro', key: 'ativo' })

  return typeof value === 'boolean' ? value : undefined
}

// O clique roda o próprio `/ds on|off` do `ds-primeiro`: só esta sessão, sem mexer no `/ds sempre`,
// e o `on` rearma o anexo. O comando entra na fila e roda quando a sessão fica ociosa.
async function alternaDs($: EngineInterface, ligado: boolean) {
  try {
    await $.command.run({ command: 'ds', args: ligado ? 'off' : 'on' })
  } catch {
    $.ui.toast('Não deu para trocar o DS agora: use /ds on ou /ds off.')
  }
}

/** O que aconteceu na conversa principal: um turno começou, ou terminou com este `usage`. */
type Marca = { turno: 'inicio' } | { turno: 'fim'; usage?: ModelUsage }

function cacheDepois(antes: Cache | null, marca: Marca, agora: number): Cache {
  if (marca.turno === 'inicio') {
    return { fim: antes?.fim ?? 0, hit: antes?.hit ?? null, rodando: true }
  }

  const lidos = marca.usage?.cache_read_input_tokens ?? 0
  const entrada = lidos + (marca.usage?.cache_creation_input_tokens ?? 0) + (marca.usage?.input_tokens ?? 0)

  return { fim: agora, hit: entrada > 0 ? Math.round((100 * lidos) / entrada) : (antes?.hit ?? null), rodando: false }
}

// Limites e contexto vêm de `$.session.usage()` a cada cálculo. O ponto de compactação só vem no
// `breakdown` (estimado localmente, sem requisição): pedido na largada e nos turnos, não no timer.
async function calcula($: EngineInterface, u: Uso, marca?: Marca, comLimite = marca !== undefined): Promise<Uso> {
  const [agora, sessao] = await Promise.all([
    $.clock.now(),
    $.session.usage(comLimite ? { breakdown: 'summary' } : undefined),
  ])
  const limite = (kind: string): Limite | null => {
    const janela = sessao.rateLimits.find(l => l.kind === kind)
    const zeraEm = janela?.resetsAt ? Date.parse(janela.resetsAt) : NaN

    return janela ? { usado: janela.percentUsed, zeraEm: Number.isNaN(zeraEm) ? null : zeraEm } : null
  }
  const quebra = sessao.context.breakdown

  return {
    cincoHoras: limite('five_hour'),
    seteDias: limite('seven_day'),
    ctx: {
      tokens: sessao.context.tokens ?? null,
      limite:
        quebra?.autoCompactThreshold ??
        quebra?.rawMaxTokens ??
        (comLimite ? undefined : u.ctx?.limite) ??
        (sessao.context.window || LIMITE_CTX_PADRAO),
    },
    cache: marca ? cacheDepois(u.cache, marca, agora) : u.cache,
    agora,
  }
}

async function recalcula($: EngineInterface, marca?: Marca, comLimite = marca !== undefined) {
  const novo = await calcula($, await read($, uso), marca, comLimite)
  await update($, uso, () => novo)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const ligado = (await $.store.get('ligado')) !== false
    await update($, visivel, () => ligado)
    await $.command.register({
      name: 'uso',
      description: 'Barra de uso: limites de 5 h e 7 dias, contexto e cache',
      argumentHint: '[on | off]',
    })
    await recalcula($, undefined, true)
    // Os contadores até o reset e o tempo do cache andam mesmo sem turno.
    $.clock.every(60_000, () => void recalcula($))

    return next(e)
  })

  on('command.run', { command: 'uso' }, async ($, e) => {
    const acao = e.args.trim().toLowerCase()

    if (acao !== '' && acao !== 'on' && acao !== 'off') {
      return { text: 'use /uso, /uso on ou /uso off.' }
    }

    const liga = acao === '' ? !(await read($, visivel)) : acao === 'on'
    await $.store.set('ligado', liga)
    await update($, visivel, () => liga)
    await recalcula($, undefined, true)

    return { text: `barra de uso ${liga ? 'ligada' : 'oculta'} · ${linha(pilulas(await read($, uso)), await dsLigado($))}` }
  })

  on('turn.start', async ($, e, next) => {
    await recalcula($, { turno: 'inicio' }, false)

    return next(e)
  })

  // Só o turno da conversa principal renova o cache dela; o de subagente atualiza os limites.
  on('turn.complete', async ($, e, next) => {
    await recalcula($, e.agentId === undefined ? { turno: 'fim', usage: e.usage } : undefined)

    return next(e)
  })

  // Outra conversa: contexto e cache recomeçam; o próximo desenho recalcula.
  on('session.end', async ($, e, next) => {
    await update($, uso, () => VAZIO)

    return next(e)
  })

  // A linha do uso é a primeira da faixa, na largura inteira, por cima do que
  // os outros mods desenham. Vale enquanto este hook for o de fora da cadeia:
  // a ordem entre mods é a de carga, e numa pasta de mods é a dos nomes.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const abaixo = await next(e)

    if (e.props.hasSurvey || !(await read($, visivel))) {
      return abaixo
    }

    // Depois de `/clear` não há `session.start`: até o timer gravar, o desenho calcula na hora
    // (desenhar não pode gravar estado).
    const atual = await read($, uso)
    const lista = pilulas(atual.agora === 0 ? await calcula($, atual, undefined, true) : atual)
    const ds = await dsLigado($)

    if (e.surface === 'desktop') {
      const { Box, Svg } = $.ui.resolve(e)
      // Com algo desenhado abaixo (o progresso), a imagem ganha um respiro transparente embaixo: a margem do Box é
      // em linhas de caracteres, grossa demais para os ~12 px que separam os dois blocos.
      const temAbaixo = abaixo !== null && abaixo !== undefined && abaixo !== false
      const { itens, altura } = linhaDoUso(lista, larguraUtil(e.props.bodyColumns), lista.map(texto), ds, ds === undefined ? '' : rotuloDs(ds), temAbaixo ? RESPIRO : 0)

      // Uma imagem por grupo, alinhadas à esquerda (cada imagem já traz o vão de 8 px até a próxima); a sobra fica à direita.
      // No desktop a pílula do DS só mostra o estado (ver `pilulaDs` em svg.ts).
      return (
        <Box flexDirection="column">
          <Box width="100%" flexDirection="row" alignItems="center" justifyContent="flex-start">
            {itens.map(item => (
              <Svg key={`uso:${item.key}`} source={item.source} alt={item.alt} width={item.largura} height={altura} />
            ))}
          </Box>
          {abaixo}
        </Box>
      )
    }

    // No terminal o DS é um Button no fim da linha, logo depois do cache.
    const { Box, Button, Text } = $.ui.resolve(e)
    const botaoDs = ds !== undefined && (
      <Button key="ds" label={rotuloDs(ds)} plain onPress={() => void alternaDs($, ds)} />
    )

    // Faltando colunas, sai o dado secundário, do último grupo para o primeiro.
    const tentativas = Array.from({ length: extras(lista) + 1 }, (_, sem) => semExtra(lista, sem))
    const grupos = tentativas.find(l => linha(l, ds).length <= e.props.bodyColumns) ?? tentativas[tentativas.length - 1]!

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          {grupos.map((p, i) => [
            i > 0 && <Text dimColor>│</Text>,
            <Text>{p.rotulo}</Text>,
            <Text color={COR_TERMINAL[p.cor]}>{partes(p).barra}</Text>,
            <Text color={p.tinta ? COR_TERMINAL[p.tinta] : undefined}>{partes(p).resto}</Text>,
          ])}
          {botaoDs && <Text dimColor>│</Text>}
          {botaoDs}
        </Box>
        {abaixo}
      </Box>
    )
  })
}
