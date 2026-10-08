import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { ModelUsage, On, PromptOrigin, Register, SessionRateLimit } from 'claude-code'

import { falta, linha, pilulas, texto, tokens } from '../hooks/modelo'
import type { Pilula } from '../hooks/modelo'
import { ALTURA, PALETA, RESPIRO, TRILHA_MAX, VAO, linhaDoUso } from '../hooks/svg'
import type { Uso } from '../types'

const MINUTO = 60_000
const HORA = 60 * MINUTO
const AGORA = Date.UTC(2026, 9, 2, 12)
const COMPOSER: PromptOrigin = { kind: 'composer' }
const SUPERFICIES = ['terminal', 'desktop'] as const
// 5h em 20% zerando em 2h 40m, 7d em 58% zerando em 1d 7h.
const LIMITES: SessionRateLimit[] = [
  { kind: 'five_hour', percentUsed: 20, resetsAt: new Date(AGORA + 2 * HORA + 40 * MINUTO).toISOString() },
  { kind: 'seven_day', percentUsed: 58, resetsAt: new Date(AGORA + 31 * HORA).toISOString() },
]
// 196.000 lidos do cache em 200.000 de entrada: 98% hit.
const TURNO: ModelUsage = {
  input_tokens: 1_000,
  output_tokens: 500,
  cache_read_input_tokens: 196_000,
  cache_creation_input_tokens: 3_000,
}
const BANDA = {
  plugin: 'barra-uso',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 120, scroll: { offset: 0, bodyRows: 4 }, view: {} },
} as const

// O que fica abaixo do mod: relógio e store em memória, e o motor respondendo
// `$.session.usage()` com o que o teste mandar. O ponto de compactação só vem
// quando a chamada pede `breakdown`, como no motor.
function mundo(
  on: On,
  opcoes: {
    limites?: SessionRateLimit[]
    tokens?: number
    compactaEm?: number
    janela?: number
    guardado?: Record<string, unknown>
  } = {},
) {
  const clock = mock.clock(on, { now: AGORA })
  mock.store(on, opcoes.guardado)
  const visto = { tokens: opcoes.tokens, pedidos: [] as (string | undefined)[] }

  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('command.run', () => ({ text: 'sem resposta' }))
  on('session.usage', (_$, e) => {
    visto.pedidos.push(e?.breakdown)
    const breakdown = e?.breakdown && opcoes.compactaEm ? { autoCompactThreshold: opcoes.compactaEm } : undefined

    return {
      value: {
        startedAt: 0,
        context: { window: opcoes.janela ?? 1_000_000, tokens: visto.tokens, breakdown },
        rateLimits: opcoes.limites ?? [],
        cost: { usd: 4.32 },
      } as never,
    }
  })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)

    return <Box />
  })

  return { clock, visto }
}

const inicia = ($: Engine) => $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
const comeca = ($: Engine) => $.turn.start({ text: 'oi', turnId: 't1' })
const termina = ($: Engine, uso?: ModelUsage, agentId?: string) =>
  $.turn.complete({
    answer: 'ok',
    durationMs: 1,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
    ...(agentId && { agentId }),
    ...(uso && { usage: { ...uso, model: 'claude-opus-5-5' } }),
  })
const turno = async ($: Engine, uso?: ModelUsage) => {
  await comeca($)
  await termina($, uso)
}
const comando = ($: Engine, args: string) =>
  $.command.run({ command: 'uso', args, origin: COMPOSER, presentation: { isFullscreen: false, columns: 120 } })

type No = { type: string; props?: Record<string, unknown>; children?: (No | string)[] }

// As folhas da árvore: o texto de cada Text e o `alt` de cada Svg.
const folhas = (no: No | string): string[] => {
  if (typeof no === 'string') {
    return [no]
  }

  if (no.type === 'Svg') {
    return [`svg: ${no.props?.alt}`]
  }

  // A linha de uso do desktop é uma imagem por grupo: lida como uma folha só, na ordem.
  const filhos = (no.children ?? []).filter((filho): filho is No => typeof filho !== 'string')
  if (filhos.length > 0 && filhos.every(filho => filho.type === 'Svg')) {
    return [`svg: ${filhos.map(filho => filho.props?.alt).join(' │ ')}`]
  }

  return no.type === 'Text' ? [(no.children ?? []).join('')] : (no.children ?? []).flatMap(folhas)
}
const svgsDe = (no: No): No[] =>
  no.type === 'Svg' ? [no] : (no.children ?? []).flatMap(filho => (typeof filho === 'string' ? [] : svgsDe(filho)))
// As imagens da linha como uma fonte só, para buscar classes e textos; e a soma das larguras.
const svgDe = (no: No) => {
  const todas = svgsDe(no)

  return todas.length === 0
    ? undefined
    : { props: { source: todas.map(svg => String(svg.props?.source)).join(''), width: todas.reduce((soma, svg) => soma + Number(svg.props?.width), 0), height: todas[0]?.props?.height } }
}
const svgDoUso = (lista: Pilula[], largura: number) =>
  linhaDoUso(lista, largura, lista.map(texto)).itens.map(item => item.source).join('')
// Quanto a linha ocupa: a soma das imagens, e cada uma já traz o vão de 8 px até a próxima.
const ocupa = (lista: Pilula[], largura: number) =>
  linhaDoUso(lista, largura, lista.map(texto)).itens.reduce((total, item) => total + item.largura, 0)


const USO: Uso = {
  cincoHoras: { usado: 20, zeraEm: AGORA + 2 * HORA + 40 * MINUTO },
  seteDias: { usado: 58, zeraEm: AGORA + 31 * HORA },
  ctx: { tokens: 145_000, limite: 275_000 },
  cache: { fim: AGORA - 16 * MINUTO, hit: 98, rodando: false },
  agora: AGORA,
}
const TEXTO = '5h ▰▱▱▱▱ 20% · 2h40m │ 7d ▰▰▰▱▱ 58% · 1d7h │ ctx ▰▰▰▱▱ 53% · 145k/275k │ cache ▰▰▰▰▱ 73% · resta 44m · hit 98%'
const ctxDe = (tokensCtx: number) => pilulas({ ...USO, ctx: { tokens: tokensCtx, limite: 275_000 } })[2]
const cacheDe = (paradoMin: number, rodando = false) =>
  pilulas({ ...USO, cache: { fim: AGORA - paradoMin * MINUTO, hit: 98, rodando } })[3]

test('formatos: tokens e tempo até zerar', () => {
  expect([145_000, 275_000, 999, 1_000_000, 1_234_000].map(tokens)).toEqual(['145k', '275k', '999', '1M', '1.2M'])
  expect([2 * HORA + 40 * MINUTO, 31 * HORA, 40 * MINUTO, 0].map(falta)).toEqual(['2h 40m', '1d 7h', '40m', '0m'])
})

test('quatro grupos de um uso conhecido, sem custo e sem tokens somados', () => {
  const lista = pilulas(USO)
  const comum = { tinta: null }

  expect(lista).toEqual([
    // 2h20 corridas de 5 h; 137 h corridas de 168 h.
    { ...comum, tom: 'cinco', rotulo: '5h', cheio: 0.2, cor: 'orange', valor: '20%', ritmo: 140 / 300, extra: ['2h 40m'] },
    { ...comum, tom: 'sete', rotulo: '7d', cheio: 0.58, cor: 'orange', valor: '58%', ritmo: 137 / 168, extra: ['1d 7h'] },
    { ...comum, tom: 'ctx', rotulo: 'ctx', cheio: 145 / 275, cor: 'orange', valor: '53%', ritmo: null, extra: ['145k / 275k'] },
    // Restam 44 dos 60 min do TTL.
    { ...comum, tom: 'cache', rotulo: 'cache', cheio: 44 / 60, cor: 'pos', valor: '73%', ritmo: null, extra: ['resta 44m', 'hit 98%'] },
  ])
  expect(linha(lista)).toBe(TEXTO)
  expect(TEXTO).not.toMatch(/[$↑↓≡]/)
})

test('ctx nos três níveis: laranja até 85%, warn acima, neg a partir de 100%', () => {
  expect(ctxDe(233_750)).toMatchObject({ cor: 'orange', valor: '85%', extra: ['234k / 275k'] })
  expect(ctxDe(240_000)).toMatchObject({ cor: 'warn', valor: '87%', cheio: 240 / 275 })
  expect(ctxDe(275_000)).toMatchObject({ cor: 'neg', valor: '100%', cheio: 1 })
  expect(ctxDe(290_000)).toMatchObject({ cor: 'neg', valor: '105%', cheio: 1, extra: ['290k / 275k'] })
})

test('cache: a barrinha e o valor são o que resta do TTL; cheio, metade, últimos 10 min, frio e rodando', () => {
  expect(cacheDe(0)).toMatchObject({ cor: 'pos', cheio: 1, valor: '100%', tinta: null, extra: ['resta 60m', 'hit 98%'] })
  expect(cacheDe(30)).toMatchObject({ cor: 'pos', cheio: 0.5, valor: '50%', extra: ['resta 30m', 'hit 98%'] })
  expect(cacheDe(49.5)).toMatchObject({ cor: 'pos', extra: ['resta 11m', 'hit 98%'] })
  expect(cacheDe(52)).toMatchObject({ cor: 'warn', cheio: 8 / 60, valor: '13%', tinta: null, extra: ['resta 8m', 'hit 98%'] })
  expect(cacheDe(60)).toMatchObject({ cor: 'neg', cheio: 0, valor: '0%', tinta: 'neg', extra: ['frio'] })
  expect(cacheDe(300)).toMatchObject({ cor: 'neg', cheio: 0, valor: '0%', tinta: 'neg', extra: ['frio'] })
  // Rodando: o cache está sendo renovado, por mais tempo que o último turno tenha.
  expect(cacheDe(300, true)).toMatchObject({ cor: 'pos', cheio: 1, valor: '100%', tinta: null, extra: ['resta 60m', 'hit 98%'] })
})

test('sem dado ainda: ctx e cache aparecem com traço, sem barrinha cheia nem secundário; 5h e 7d ausentes saem', () => {
  const lista = pilulas({ cincoHoras: { usado: 20, zeraEm: null }, seteDias: null, ctx: null, cache: null, agora: AGORA })
  const comum = { tinta: null, ritmo: null, extra: [] }

  expect(lista).toEqual([
    { ...comum, tom: 'cinco', rotulo: '5h', cheio: 0.2, cor: 'orange', valor: '20%' },
    { ...comum, tom: 'ctx', rotulo: 'ctx', cheio: null, cor: 'orange', valor: '–' },
    { ...comum, tom: 'cache', rotulo: 'cache', cheio: null, cor: 'pos', valor: '–' },
  ])
  expect(linha(lista)).toBe('5h ▰▱▱▱▱ 20% │ ctx ▱▱▱▱▱ – │ cache ▱▱▱▱▱ –')
  expect(pilulas({ ...USO, ctx: { tokens: null, limite: 275_000 } })[2]).toMatchObject({ valor: '–', cheio: null, extra: [] })
  // Turno em andamento sem nenhum terminado: hit desconhecido, só o tempo.
  expect(pilulas({ ...USO, cache: { fim: 0, hit: null, rodando: true } })[3]).toMatchObject({ valor: '100%', cheio: 1, extra: ['resta 60m'] })

  const svg = svgDoUso(lista, 1264)
  expect(svg).not.toContain('class="mk"')
  expect(svg.match(/class="tr"/g)).toHaveLength(3)
  // Só a barrinha do 5h tem cheio.
  expect(svg.match(/class="tf/g)).toHaveLength(1)
  expect(svg.match(/>–<\/text>/g)).toHaveLength(2)
})

const QUANTOS = [5, 5, 5, 3, 2]
const ESTREITA = ['20% · 1h38m', '58% · 1d5h', '102%', '0%']
const tons = (svg: string) => [...svg.matchAll(/data-tom="(\w+)"/g)].map(m => m[1])
const cheios = (svg: string) => [...svg.matchAll(/<rect class="(tf[ \w]*)"/g)].map(m => m[1])

test('SVG: grupos com barrinha e valor em toda largura; o secundário sai parte a parte da direita para a esquerda', () => {
  const lista = pilulas(USO)
  const SECUNDARIOS = ['2h 40m', '1d 7h', '145k / 275k', 'resta 44m', 'hit 98%']
  // O texto do desenho, sem o `aria-label`, que traz a linha inteira.
  const presentes = (svg: string) => SECUNDARIOS.filter(dado => new RegExp(`>[^<]*${dado}[^<]*</text>`).test(svg))

  for (const largura of [1264, 844, 704, 560, 400]) {
    const svg = svgDoUso(lista, largura)
    expect(tons(svg)).toEqual(['cinco', 'sete', 'ctx', 'cache'])
    expect(svg.match(/class="tr"/g)).toHaveLength(4)
    expect(cheios(svg)).toEqual(['tf', 'tf', 'tf', 'tf'])
    expect(svg).toContain('style="fill:url(#dg)"')
    expect(svg.match(/class="mk"/g)).toHaveLength(2)

    for (const valor of ['20%', '58%', '53%', '73%']) {
      expect(svg).toContain(`class="v b">${valor}</text>`)
    }

    expect(svg).not.toContain('$')
  }

  const larga = linhaDoUso(lista, 1264, lista.map(texto))
  const fonteLarga = larga.itens.map(item => item.source).join('')
  expect(presentes(fonteLarga)).toEqual(SECUNDARIOS)
  expect(fonteLarga).toContain('>resta 44m · hit 98%</text>')
  // 1264 px: o medidor cresce até o teto e a sobra vira vão; acima do vão máximo, a linha fica à esquerda.
  expect(larga.trilha).toBe(TRILHA_MAX)
  // 5 h: medidor começando em x=48; o marcador (2 px de largura) centrado a 140/300 dele.
  const marca = Math.round((48 + TRILHA_MAX * (140 / 300) - 1) * 10) / 10
  expect(fonteLarga).toContain(`<rect class="tr" x="48" y="11" width="${TRILHA_MAX}"`)
  expect(fonteLarga).toContain(`<rect class="mk" x="${marca}" y="8" width="2" height="12" rx="1"/>`)
  expect(larga.itens[0]?.alt).toBe(texto(lista[0]!))

  // Vão fixo de 8 px entre as pílulas em qualquer largura: cada imagem, menos a última, leva 8 px a mais que o
  // desenho (a caixa passa de 8 em 8 pela grade), e a sobra fica à direita da última.
  for (const largura of [704, 844, 960, 1100, 1264]) {
    const r = linhaDoUso(lista, largura, lista.map(texto))
    expect(r.vao).toBe(VAO)
    expect(VAO).toBe(8)
    expect(ocupa(lista, largura)).toBeLessThanOrEqual(largura + 0.5)
    const sol = linhaDoUso(lista, largura, lista.map(texto), true, 'DS')
    const caixas = sol.itens.map(item => Number(/viewBox="0 0 ([\d.]+) /.exec(item.source)?.[1]))
    expect(sol.itens.at(-1)?.largura).toBe(caixas.at(-1))
    expect(caixas.slice(0, -1).every(c => (c - VAO) % 8 === 0)).toBe(true)
  }

  // Respiro: só com algo abaixo, a imagem ganha 12 px transparentes embaixo, sem mudar a pílula (28 px).
  const sem = linhaDoUso(lista, 1264, lista.map(texto))
  const com = linhaDoUso(lista, 1264, lista.map(texto), undefined, '', RESPIRO)
  expect(sem.altura).toBe(ALTURA)
  expect(com.altura).toBe(ALTURA + 12)
  expect(com.itens[0]?.source).toContain(`viewBox="0 0 ${/viewBox="0 0 (\d+) /.exec(sem.itens[0]!.source)![1]} ${ALTURA + 12}"`)
  expect(com.itens.map(i => i.largura)).toEqual(sem.itens.map(i => i.largura))

  // O secundário sai da última parte para a primeira, nunca pulando uma; nada passa da largura.
  const quantos = [1264, 1100, 960, 844, 704].map(largura => {
    const svg = svgDoUso(lista, largura)
    expect(presentes(svg)).toEqual(SECUNDARIOS.slice(0, presentes(svg).length))
    expect(ocupa(lista, largura)).toBeLessThanOrEqual(largura + 0.5)

    return presentes(svg).length
  })
  expect(quantos).toEqual(QUANTOS)

  // Abaixo do mínimo dos grupos as imagens encolhem juntas, sem cortar.
  const minimo = linhaDoUso(lista, 400, lista.map(texto))
  expect(presentes(minimo.itens.map(item => item.source).join(''))).toEqual([])
  expect(minimo.itens.reduce((soma, item) => soma + item.largura, 0)).toBeLessThanOrEqual(400)
  expect(minimo.itens[0]?.source).toMatch(/width="[\d.]+" height="(?!28")[\d.]+" viewBox="0 0 \d+ 28"/)
})

test('SVG: a cor do cheio segue o nível do ctx; o cache leva o degradê neg, warn e pos do DS', () => {
  const ctxCor = (tokensCtx: number) => cheios(svgDoUso([ctxDe(tokensCtx)!], 1264))

  expect(ctxCor(145_000)).toEqual(['tf'])
  expect(ctxCor(240_000)).toEqual(['tf warn'])
  expect(ctxCor(280_000)).toEqual(['tf neg'])

  // O degradê ocupa a trilha inteira; o cheio vai até a fração que resta.
  const meio = svgDoUso([cacheDe(30)!], 1264)
  const trilha = /<rect class="tr" x="([\d.]+)" y="\d+" width="(\d+)"/.exec(meio)!
  const inicio = Number(trilha[1])
  const largo = Number(trilha[2])
  expect(meio).toContain(`<linearGradient id="dg" gradientUnits="userSpaceOnUse" x1="${inicio}" x2="${inicio + largo}"`)
  expect(meio).toContain('<stop offset="0" class="g0"/><stop offset=".5" class="g1"/><stop offset="1" class="g2"/>')
  expect(meio).toContain(`<rect class="tf" style="fill:url(#dg)" x="${inicio}" y="11" width="${largo / 2}"`)
  // Frio: barrinha vazia e 0% em neg.
  const frio = svgDoUso([cacheDe(75)!], 1264)
  expect(frio).not.toContain('url(#dg)" x=')
  expect(frio).toContain('class="v b neg">0%</text>')

  const svg = svgDoUso(pilulas(USO), 1264)
  expect(svg).toContain('.pos{fill:#2F7A36}.warn{fill:#946200}.neg{fill:#C42B3E}.off{fill:#5A5952}.g0{stop-color:#FF7A6B}.g1{stop-color:#F2B53A}.g2{stop-color:#2F7A36}')
  expect(svg).toContain('.pos{fill:#D8F35A}.warn{fill:#F2B53A}.neg{fill:#FF7A6B}.off{fill:#ABA69B}.g0{stop-color:#FF7A6B}.g1{stop-color:#F2B53A}.g2{stop-color:#D8F35A}')
})

test('contraste: número e rótulo (ink) e secundário (muted) ficam acima de 4,5:1 sobre o fundo da pílula (soft), nos dois temas', () => {
  const lum = (hex: string) => {
    const [r = 0, g = 0, b = 0] = [1, 3, 5]
      .map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))

    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const razao = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05)

  for (const tema of Object.values(PALETA)) {
    expect(razao(tema.ink, tema.soft)).toBeGreaterThanOrEqual(4.5)
    expect(razao(tema.muted, tema.soft)).toBeGreaterThanOrEqual(4.5)
  }
})

// Cada grupo do terminal: rótulo, barrinha com a cor do estado e o resto.
const grupo = (rotulo: string, barra: string, resto: string) => [rotulo, barra, resto]

test('faixa: depois do turno, os quatro grupos em terminal e desktop, com o limite de compactação da API', async ($, on) => {
  const { clock } = mundo(on, { limites: LIMITES, tokens: 145_000, compactaEm: 275_000 })

  for (const surface of SUPERFICIES) {
    await inicia($)
    const faixa = await $.ui.mount({ ...BANDA, surface })
    await turno($, TURNO)
    await clock.advance(16 * MINUTO)
    const desenho = (await faixa.drawn()) as No

    if (surface === 'terminal') {
      expect(folhas(desenho)).toEqual([
        ...grupo('5h', '▰▱▱▱▱', '20% · 2h24m'),
        '│',
        ...grupo('7d', '▰▰▰▱▱', '58% · 1d6h'),
        '│',
        ...grupo('ctx', '▰▰▰▱▱', '53% · 145k/275k'),
        '│',
        ...grupo('cache', '▰▰▰▰▱', '73% · resta 44m · hit 98%'),
      ])
    } else {
      const svg = svgDe(desenho)
      expect(folhas(desenho)).toHaveLength(1)
      expect(folhas(desenho)[0]).toEndWith('ctx ▰▰▰▱▱ 53% · 145k/275k │ cache ▰▰▰▰▱ 73% · resta 44m · hit 98%')
      // Quatro imagens que somam no máximo a área estimada (120 colunas a 7,69 px, menos 2), na altura da linha.
      expect(svgsDe(desenho)).toHaveLength(4)
      expect(svg?.props?.width).toBeLessThanOrEqual(920)
      // Com algo desenhado abaixo, a imagem leva o respiro de 12 px embaixo da pílula de 28.
      expect(svg?.props?.height).toBe(ALTURA + RESPIRO)
      expect(svg?.props?.source).toContain('>145k / 275k</text>')
    }

    await faixa.unmount()
    await $.session.end({ reason: 'clear', sessionId: 's', resume: { id: 's' } })
  }
})

test('faixa no terminal: a cor da barrinha segue o estado; estreito, o secundário sai da direita', async ($, on) => {
  const { clock, visto } = mundo(on, { limites: LIMITES, tokens: 240_000, compactaEm: 275_000 })
  await inicia($)
  await turno($, TURNO)
  await clock.advance(52 * MINUTO)

  const cores = (no: No | string): unknown[] =>
    typeof no === 'string' ? [] : no.type === 'Text' && /[▰▱]/.test(String(no.children?.[0])) ? [no.props?.color] : (no.children ?? []).flatMap(cores)
  const faixa = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  expect(cores((await faixa.drawn()) as No)).toEqual([undefined, undefined, 'warning', 'warning'])

  visto.tokens = 280_000
  await clock.advance(10 * MINUTO)
  expect(cores((await faixa.drawn()) as No)).toEqual([undefined, undefined, 'error', 'error'])
  await faixa.unmount()

  // 80 colunas: o secundário sai da direita para a esquerda.
  const estreita = await $.ui.mount({ ...BANDA, surface: 'terminal', props: { ...BANDA.props, bodyColumns: 80 } })
  expect(folhas((await estreita.drawn()) as No).filter(f => f.includes('%'))).toEqual(ESTREITA)
  await estreita.unmount()
})

test('sem turno nesta carga: os grupos aparecem com traço; ctx sem limite da API usa a janela, e 275k sem janela', async ($, on) => {
  mundo(on, { tokens: 145_000, janela: 200_000 })
  await inicia($)

  for (const surface of SUPERFICIES) {
    const faixa = await $.ui.mount({ ...BANDA, surface })
    expect(folhas((await faixa.drawn()) as No)).toEqual(
      surface === 'terminal'
        ? [...grupo('ctx', '▰▰▰▰▱', '73% · 145k/200k'), '│', ...grupo('cache', '▱▱▱▱▱', '–')]
        : ['svg: ctx ▰▰▰▰▱ 73% · 145k/200k │ cache ▱▱▱▱▱ –'],
    )
    await faixa.unmount()
  }
})

test('sem limite e sem janela na API: 275k', async ($, on) => {
  mundo(on, { tokens: 145_000, janela: 0 })
  await inicia($)

  expect((await comando($, 'on')).text).toBe('barra de uso ligada · ctx ▰▰▰▱▱ 53% · 145k/275k │ cache ▱▱▱▱▱ –')
})

test('cache: turno rodando zera a barrinha; turno de subagente não renova; turno sem usage mantém o hit', async ($, on) => {
  const { clock } = mundo(on, { tokens: 145_000, compactaEm: 275_000 })
  await inicia($)
  const cache = async () => (await comando($, 'on')).text?.split(' │ ')[1]

  await comeca($)
  expect(await cache()).toBe('cache ▰▰▰▰▰ 100% · resta 60m')
  await termina($, TURNO)
  await clock.advance(30 * MINUTO)
  expect(await cache()).toBe('cache ▰▰▰▱▱ 50% · resta 30m · hit 98%')

  await termina($, { ...TURNO, cache_read_input_tokens: 0 }, 'agente-1')
  expect(await cache()).toBe('cache ▰▰▰▱▱ 50% · resta 30m · hit 98%')

  await clock.advance(31 * MINUTO)
  expect(await cache()).toBe('cache ▱▱▱▱▱ 0% · frio')
  await comeca($)
  expect(await cache()).toBe('cache ▰▰▰▰▰ 100% · resta 60m · hit 98%')
  await termina($)
  expect(await cache()).toBe('cache ▰▰▰▰▰ 100% · resta 60m · hit 98%')
})

test('timer de 60 s: os contadores andam sem turno e sem pedir o breakdown', async ($, on) => {
  const { clock, visto } = mundo(on, { limites: LIMITES, tokens: 145_000, compactaEm: 275_000 })
  await inicia($)
  await turno($, TURNO)
  const faixa = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  const tempos = async () => folhas((await faixa.drawn()) as No).filter(f => f.includes('%'))
  expect(await tempos()).toEqual(['20% · 2h40m', '58% · 1d7h', '53% · 145k/275k', '100% · resta 60m · hit 98%'])

  visto.pedidos.length = 0
  await clock.advance(25 * MINUTO)
  expect(await tempos()).toEqual(['20% · 2h15m', '58% · 1d6h', '53% · 145k/275k', '58% · resta 35m · hit 98%'])
  expect(visto.pedidos).toHaveLength(25)
  expect(visto.pedidos.every(pedido => pedido === undefined)).toBe(true)
  await faixa.unmount()
})

test('/clear: sem session.start, o primeiro desenho recalcula e a linha volta sem esperar o timer', async ($, on) => {
  const { visto } = mundo(on, { limites: LIMITES, tokens: 145_000, compactaEm: 275_000 })
  await inicia($)
  await turno($, TURNO)

  for (const surface of SUPERFICIES) {
    const faixa = await $.ui.mount({ ...BANDA, surface })
    visto.tokens = undefined
    await $.session.end({ reason: 'clear', sessionId: 's', resume: { id: 's' } })

    const depois = folhas((await faixa.drawn()) as No).join(' ')
    expect(depois).toContain('20% · 2h40m')
    expect(depois).toContain(surface === 'terminal' ? 'ctx ▱▱▱▱▱ – │ cache ▱▱▱▱▱ –' : 'ctx ▱▱▱▱▱ – │ cache ▱▱▱▱▱ –')
    await faixa.unmount()
    visto.tokens = 145_000
    await turno($, TURNO)
  }
})

// Outro mod que desenha em AbovePrompt, como o `progresso`.
const vizinho: Register = on => {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const abaixo = await next(e)
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        <Text>faixa do vizinho</Text>
        {abaixo}
      </Box>
    )
  })
}

test('posição: a linha do uso fica acima do que o vizinho desenha', { plugins: [{ name: 'vizinho', register: vizinho }] }, async ($, on) => {
  mundo(on)
  await inicia($)

  for (const surface of SUPERFICIES) {
    const faixa = await $.ui.mount({ ...BANDA, surface })
    const lidas = folhas((await faixa.drawn()) as No)
    expect(lidas[0]).toStartWith(surface === 'terminal' ? 'ctx' : 'svg: ctx')
    expect(lidas[lidas.length - 1]).toBe('faixa do vizinho')
    await faixa.unmount()
  }
})

// Ordem inversa: um mod carregado antes fica por fora e a linha do uso desce
// para onde ele puser o que vem de dentro.
test('ordem inversa: com o vizinho por fora, a linha do uso fica embaixo da dele', { plugins: [{ name: 'vizinho', tier: 'prepend', register: vizinho }] }, async ($, on) => {
  mundo(on)
  await inicia($)

  for (const surface of SUPERFICIES) {
    const faixa = await $.ui.mount({ ...BANDA, surface })
    const lidas = folhas((await faixa.drawn()) as No)
    expect(lidas[0]).toBe('faixa do vizinho')
    expect(lidas[1]).toStartWith(surface === 'terminal' ? 'ctx' : 'svg: ctx')
    await faixa.unmount()
  }
})

test('/uso: off esconde e guarda no store, sem argumento alterna, e a resposta traz os números', async ($, on) => {
  const { clock } = mundo(on, { limites: LIMITES, tokens: 145_000, compactaEm: 275_000 })
  await inicia($)
  await turno($, TURNO)
  await clock.advance(16 * MINUTO)

  for (const surface of SUPERFICIES) {
    const faixa = await $.ui.mount({ ...BANDA, surface })
    const resposta = (await comando($, 'off')).text
    expect(resposta).toStartWith('barra de uso oculta · 5h ▰▱▱▱▱ 20% · ')
    expect(resposta).toEndWith(' │ ctx ▰▰▰▱▱ 53% · 145k/275k │ cache ▰▰▰▰▱ 73% · resta 44m · hit 98%')
    expect(folhas((await faixa.drawn()) as No)).toEqual([])

    // Relançado: a escolha volta do store.
    await $.session.end({ reason: 'prompt_input_exit', sessionId: 's', resume: { id: 's' } })
    await inicia($)
    expect(folhas((await faixa.drawn()) as No)).toEqual([])

    expect((await comando($, '')).text).toStartWith('barra de uso ligada · 5h')
    expect(folhas((await faixa.drawn()) as No)).not.toEqual([])
    expect((await comando($, '')).text).toStartWith('barra de uso oculta')
    expect((await comando($, 'on')).text).toStartWith('barra de uso ligada')
    expect((await comando($, 'x')).text).toBe('use /uso, /uso on ou /uso off.')
    await faixa.unmount()
    await turno($, TURNO)
    await clock.advance(16 * MINUTO)
  }
})

test('padrão guardado desligado e survey: nada desenhado', async ($, on) => {
  mundo(on, { guardado: { ligado: false } })
  await inicia($)

  const oculta = await $.ui.mount({ ...BANDA, surface: 'desktop' })
  expect(folhas((await oculta.drawn()) as No)).toEqual([])
  await oculta.unmount()

  await comando($, 'on')
  const comSurvey = await $.ui.mount({ ...BANDA, surface: 'desktop', props: { ...BANDA.props, hasSurvey: true } })
  expect(folhas((await comSurvey.drawn()) as No)).toEqual([])
  await comSurvey.unmount()
})

// O `ds-primeiro` como ele se mostra a outros mods: publica `ativo` na largada e a cada `/ds on|off`,
// e guarda os comandos que recebeu. O tipo do átomo é do contrato dele, que esta pasta não carrega.
type GravaAtomoAlheio = (ref: { plugin: string; key: string }, value: unknown) => Promise<unknown>
const dsPrimeiro: Register = on => {
  on('session.start', async ($, e, next) => {
    await ($.state.set as GravaAtomoAlheio)({ plugin: 'ds-primeiro', key: 'ativo' }, true)

    return next(e)
  })
  on('command.run', { command: 'ds' }, async ($, e, next) => {
    await ($.state.set as GravaAtomoAlheio)({ plugin: 'ds-primeiro', key: 'ativo' }, e.args === 'on')

    return next(e)
  })
}
const ds = ($: Engine, args: string) =>
  $.command.run({ command: 'ds', args, origin: COMPOSER, presentation: { isFullscreen: false, columns: 120 } })

// Um elemento da árvore desenhada, pelo tipo e, querendo, pela chave.
const acha = (no: No | string, tipo: string, chave?: string): No | undefined =>
  typeof no === 'string'
    ? undefined
    : no.type === tipo && (chave === undefined || no.props?.key === chave)
      ? no
      : (no.children ?? []).map(filho => acha(filho, tipo, chave)).find(Boolean)

test('ds no desktop: pílula só de estado depois do cache, sem camada clicável; o /ds digitado muda o desenho', { plugins: [{ name: 'ds-primeiro', register: dsPrimeiro }] }, async ($, on) => {
  mundo(on, { limites: LIMITES, tokens: 145_000, compactaEm: 275_000 })
  await inicia($)
  await turno($, TURNO)

  const faixa = await $.ui.mount({ ...BANDA, surface: 'desktop' })
  const desenho = async () => (await faixa.drawn()) as No
  const fonte = async () => String(svgDe(await desenho())?.props?.source)

  // Pílula do DS logo depois da do cache, com luz cheia e o valor em pos; o desenho ocupa a largura inteira.
  expect(tons(await fonte())).toEqual(['cinco', 'sete', 'ctx', 'cache', 'ds'])
  expect(await fonte()).toContain('class="v b pos">on</text>')
  expect(await fonte()).toContain('<circle class="lg"')
  expect(svgsDe(await desenho())).toHaveLength(5)
  expect(svgDe(await desenho())?.props.width).toBeLessThanOrEqual(920)
  expect(folhas(await desenho())[0]).toEndWith('│ ds on')
  // A camada Client não carregava no app e deixava texto sobre as pílulas: não há mais nenhuma.
  expect(acha(await desenho(), 'Client')).toBeUndefined()

  await ds($, 'off')
  expect(await fonte()).toContain('class="v b off">off</text>')
  expect(await fonte()).toContain('<circle class="dl"')
  expect(folhas(await desenho())[0]).toEndWith('│ ds off')
  await faixa.unmount()
})

test('ds no terminal: botão logo depois do cache; o clique alterna pelo /ds do ds-primeiro, e o /ds digitado muda o rótulo', { plugins: [{ name: 'ds-primeiro', register: dsPrimeiro }] }, async ($, on) => {
  const rodados: string[] = []
  on('command.run', { command: 'ds' }, (_$, e) => {
    rodados.push(`${e.origin.kind}: /ds ${e.args}`)

    return { text: '' }
  })
  mundo(on, { limites: LIMITES, tokens: 145_000, compactaEm: 275_000 })
  await inicia($)
  await turno($, TURNO)

  const faixa = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  const linhaDoUso = async () => ((await faixa.drawn()) as No).children?.[0] as No
  const rotulo = async () => acha(await linhaDoUso(), 'Button', 'ds')?.props?.label

  expect(acha(await linhaDoUso(), 'Button', 'ds')?.props).toMatchObject({ label: 'ds on', plain: true })
  // Último da linha, logo depois do cache.
  const tipos = (await linhaDoUso()).children?.map(filho => (filho as No).type)
  expect(tipos?.slice(-3)).toEqual(['Text', 'Text', 'Button'])

  await faixa.press({ key: 'ds' })
  expect(await rotulo()).toBe('ds off')
  await faixa.press({ key: 'ds' })
  expect(await rotulo()).toBe('ds on')
  expect(rodados).toEqual(['plugin: /ds off', 'plugin: /ds on'])

  await ds($, 'off')
  expect(await rotulo()).toBe('ds off')
  expect((await comando($, 'on')).text).toEndWith('│ ds off')
  await faixa.unmount()
})

test('ds-primeiro ausente: sem pílula, camada nem botão do DS', async ($, on) => {
  mundo(on, { limites: LIMITES, tokens: 145_000, compactaEm: 275_000 })
  await inicia($)
  await turno($, TURNO)

  for (const surface of SUPERFICIES) {
    const faixa = await $.ui.mount({ ...BANDA, surface })
    const desenho = (await faixa.drawn()) as No
    expect(acha(desenho, 'Button', 'ds')).toBeUndefined()
    expect(acha(desenho, 'Client')).toBeUndefined()

    if (surface === 'desktop') {
      expect(svgDe(desenho)?.props?.source).not.toContain('data-tom="ds"')
    }

    await faixa.unmount()
  }

  expect((await comando($, 'on')).text).toEndWith('hit 98%')
})
