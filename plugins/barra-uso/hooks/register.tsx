import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelUsage, Register } from 'claude-code'

import type { Cache, Limite, Uso } from '../types'
import { extras, linha, partes, pilulas, rotuloDs, semExtra, texto } from './modelo'
import type { Cor } from './modelo'
import { ALTURA, MEDIDOR_MIN_COLUNAS, RESPIRO, linhaDoUso } from './svg'

const VAZIO: Uso = { cincoHoras: null, seteDias: null, ctx: null, cache: null, agora: 0 }
const uso = atom({ plugin: 'barra-uso', key: 'uso' } as const, VAZIO)
const visivel = atom({ plugin: 'barra-uso', key: 'visivel' } as const, true)
const pedidoAnotacoes = atom({ plugin: 'barra-uso', key: 'anotacoes' } as const, 0)

// Ponto de compactação automática da configuração do usuário, para quando a API não informa limite nem janela.
const LIMITE_CTX_PADRAO = 275_000
const COR_TERMINAL: Record<Cor, string | undefined> = { orange: undefined, pos: 'success', warn: 'warning', neg: 'error' }

// A área acima do prompt no app desktop não tem 8 px por coluna (medido de 7,69 a 8,5). A estimativa fica no menor
// valor medido e só decide quando o dado secundário sai; as larguras vêm do flex do app.
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

// O botão "Anotações" é do painel do `progresso`, outro mod. A contagem vem do átomo `anotacoes` dele, lido sem tipo
// como o `ativo` do `ds-primeiro` (o tipo só viria com `dependencies`, que tornaria o progresso obrigatório). Nunca
// escrito quer dizer que o progresso não carregou, e o botão sai.
async function quantasAnotacoes($: EngineInterface) {
  const { value } = await ($.state.get as LeAtomoAlheio)({ plugin: 'progresso', key: 'anotacoes' })

  return Array.isArray(value) ? value.length : undefined
}

// O clique só escreve o contador deste mod: o progresso ouve a escrita (state.set) e abre ou fecha o painel na hora,
// sem passar pela fila de comandos nem deixar linha na conversa, como o `/anotacoes` deixaria.
const pedirAnotacoes = ($: EngineInterface) => update($, pedidoAnotacoes, n => n + 1)

export const rotuloAnotacoes = (n: number) => (n === 0 ? 'Anotações' : `Anotações · ${n}`)

// Caderno (Lucide "notebook-text") na grade de 14 e traço de 1,5 das pílulas, na cor `muted` delas; numa imagem de
// 22 × 28 (8 px de vão antes), centrado na altura da pílula. Svg não clica: o clique é do Button ao lado.
const ICONE_ANOTACOES = 22
const svgDoIconeAnotacoes = (altura: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${ICONE_ANOTACOES}" height="${altura}"><style>.i{fill:none;stroke:#5A5952;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}@media (prefers-color-scheme:dark){.i{stroke:#ABA69B}}</style>` +
  `<g class="i" transform="translate(8 7) scale(${(14 / 24).toFixed(4)})"><path d="M2 6h4M2 10h4M2 14h4M2 18h4"/><rect width="16" height="20" x="4" y="2" rx="2"/><path d="M9.5 8h5M9.5 12H16M9.5 16H14"/></g></svg>`
// Px que o botão toma da linha das pílulas: o ícone e o rótulo a ~7,7 px por letra mais o respiro do Button.
const larguraDoBotao = (rotulo: string) => ICONE_ANOTACOES + Math.ceil([...rotulo].length * 7.7) + 16

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
    const notas = await quantasAnotacoes($)
    const rotuloNotas = notas === undefined ? '' : rotuloAnotacoes(notas)

    if (e.surface === 'desktop') {
      const { Box, Button, Svg } = $.ui.resolve(e)
      // Com algo desenhado abaixo (o progresso), a imagem ganha um respiro transparente embaixo: a margem do Box é
      // em linhas de caracteres, grossa demais para os ~12 px que separam os dois blocos.
      const temAbaixo = abaixo !== null && abaixo !== undefined && abaixo !== false
      const reserva = notas === undefined ? 0 : larguraDoBotao(rotuloNotas)
      const linhaUso = linhaDoUso(lista, larguraUtil(e.props.bodyColumns) - reserva, lista.map(texto), ds, ds === undefined ? '' : rotuloDs(ds), temAbaixo ? RESPIRO : 0)
      const { altura } = linhaUso

      // A linha vai de borda a borda: cada pílula é um Box que cresce, com a cabeça (ícone e rótulo) e a cauda (valor e
      // secundário) na largura natural e o medidor no meio, um Svg sem width num Box de width 0 que estica. A sobra da
      // linha se divide entre os medidores; DS e Anotações ficam na largura natural, e o botão encosta na borda direita.
      return (
        <Box flexDirection="column">
          {/* Topo alinhado: as imagens têm a mesma altura e o botão, numa caixa da altura da pílula (28), fica no meio dela. */}
          <Box width="100%" flexDirection="row" alignItems="flex-start">
            {linhaUso.pilulas.map(p => (
              <Box key={`uso:${p.key}`} flexDirection="row" alignItems="flex-start" flexGrow={1}>
                <Svg key={`uso:${p.key}:cabeca`} source={p.cabeca.source} alt={p.alt} width={p.cabeca.largura} height={altura} />
                <Box key={`uso:${p.key}:medidor`} flexDirection="column" flexGrow={1} width={0} minWidth={MEDIDOR_MIN_COLUNAS}>
                  <Svg key={`uso:${p.key}:barra`} source={p.medidor} alt={`medidor ${p.alt}`} height={altura} />
                </Box>
                <Svg key={`uso:${p.key}:cauda`} source={p.cauda.source} alt={p.alt} width={p.cauda.largura} height={altura} />
              </Box>
            ))}
            {/* No desktop a pílula do DS só mostra o estado (ver `pilulaDs` em svg.ts). */}
            {linhaUso.ds && <Svg key="uso:ds" source={linhaUso.ds.source} alt={linhaUso.ds.alt} width={linhaUso.ds.largura} height={altura} />}
            {notas !== undefined && (
              <Box key="anotacoes" flexDirection="row" alignItems="center" flexShrink={0}>
                <Svg key="anotacoes:icone" source={svgDoIconeAnotacoes(ALTURA)} alt="anotações" width={ICONE_ANOTACOES} height={ALTURA} />
                <Button key="anotacoes:abrir" label={rotuloNotas} plain dimColor hover={{ dimColor: false }} onPress={() => void pedirAnotacoes($)} />
              </Box>
            )}
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
    const botaoNotas = notas !== undefined && (
      <Button key="anotacoes:abrir" label={rotuloNotas} plain onPress={() => void pedirAnotacoes($)} />
    )
    const extraNotas = notas === undefined ? 0 : rotuloNotas.length + 3
    const tentativas = Array.from({ length: extras(lista) + 1 }, (_, sem) => semExtra(lista, sem))
    const grupos = tentativas.find(l => linha(l, ds).length + extraNotas <= e.props.bodyColumns) ?? tentativas[tentativas.length - 1]!

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
          {botaoNotas && <Text dimColor>│</Text>}
          {botaoNotas}
        </Box>
        {abaixo}
      </Box>
    )
  })
}
