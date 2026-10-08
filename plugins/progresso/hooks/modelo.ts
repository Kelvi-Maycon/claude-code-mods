import type { Barra, Estado, Fala, Faixa, Passo } from '../types'

/** Quanto tempo uma faixa terminada continua na tela. */
export const SOME_MS = 6000
const MAX_PASSOS = 60
/** Barras finalizadas que a sessão guarda: as mais velhas que isso, ou além da conta, saem. */
const MAX_FINALIZADAS = 20
const VIDA_FINALIZADA_MS = 12 * 3_600_000
const ESTADOS: readonly Estado[] = ['andamento', 'esperando', 'erro', 'concluido']
const FINAIS: ReadonlySet<Estado> = new Set(['concluido', 'erro', 'parada'])
const ROTULO: Record<Estado, string> = {
  andamento: 'em andamento',
  esperando: 'esperando você',
  erro: 'erro',
  concluido: 'concluído',
  parada: 'parada',
}

export const finalizada = (barra: Pick<Barra, 'estado'>) => FINAIS.has(barra.estado)

const texto = (valor: unknown, max: number) =>
  typeof valor === 'string' ? valor.replace(/\s+/g, ' ').trim().slice(0, max) : typeof valor === 'number' ? String(valor) : ''
const chave = (titulo: string) => titulo.toLowerCase()
/** Sem acento, caixa, espaço nem pontuação: "Mapear seções." e "mapear secoes" casam. */
const normal = (valor: string) =>
  valor
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

export const cortar = (valor: string, max: number) =>
  valor.length <= max ? valor : `${valor.slice(0, Math.max(1, max - 1)).trimEnd()}…`

/** Relógio de faixa: 0:42, 12:05, 1:02:09. */
export function relogio(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const s = String(total % 60).padStart(2, '0')
  const m = Math.floor(total / 60) % 60
  const h = Math.floor(total / 3600)

  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

/** Duração em frase: 45s, 4min, 1h 12min. */
export function duracao(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000))
  if (total < 60) return `${total}s`
  const min = Math.floor(total / 60)

  return min < 60 ? `${min}min` : `${Math.floor(min / 60)}h ${min % 60}min`
}

/** Tempo no formato do desenho: 42s, 3m 5s, 1h 2m. */
export function decorrido(ms: number) {
  const seg = Math.max(0, Math.round(ms / 1000))
  if (seg < 60) return `${seg}s`

  return seg < 3600 ? `${Math.floor(seg / 60)}m ${seg % 60}s` : `${Math.floor(seg / 3600)}h ${Math.floor((seg % 3600) / 60)}m`
}

/** claude-opus-5-5 vira "opus 5.5"; um alias como "haiku" fica como veio. */
export function modeloCurto(id: string) {
  const partes = id
    .replace(/^.*claude-/, '')
    .replace(/\[.*\]$/, '')
    .replace(/-\d{8}$/, '')
    .split('-')
  const nome = partes.find(parte => /^[a-z]+$/i.test(parte)) ?? id
  const versao = partes.filter(parte => /^\d+$/.test(parte)).join('.')

  return versao ? `${nome} ${versao}` : nome
}

const ESFORCO: Record<string, string> = {
  low: 'baixo',
  medium: 'médio',
  high: 'alto',
  xhigh: 'extra alto',
  max: 'máximo',
}
export const esforcoPt = (esforco: string | number | undefined) =>
  esforco === undefined ? '' : (ESFORCO[String(esforco)] ?? String(esforco))

/** mcp__servidor__ferramenta vira "ferramenta"; o resto fica como veio. */
export const ferramentaCurta = (nome: string) => cortar(nome.split('__').at(-1) ?? nome, 24)

/**
 * "cd /pasta/longa && npm test" vira { titulo: "npm test", pasta: "/pasta/longa" }: o rótulo mostra o comando real e a
 * pasta vai só para o alt. Vários "cd x &&" ou "cd x;" seguidos saem todos; sem prefixo, a pasta fica vazia.
 */
export function comandoLegivel(comando: string) {
  let resto = texto(comando, 400)
  let pasta = ''
  for (let m = PREFIXO_CD.exec(resto); m && m[0].length < resto.length; m = PREFIXO_CD.exec(resto)) {
    pasta = (m[1] ?? '').replace(/^(["'])(.*)\1$/, '$2')
    resto = resto.slice(m[0].length)
  }

  return { titulo: cortar(resto, 50), pasta }
}
const PREFIXO_CD = /^cd\s+("[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*/

/** 950 → "950", 38_400 → "38k", 1_250_000 → "1.3M". */
export function tokensCurtos(n: number) {
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`

  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

export const usdCurto = (usd: number) => (usd < 0.01 ? '≈$<0.01' : `≈$${usd.toFixed(2)}`)

type Plano = Pick<Passo, 'titulo' | 'etapa'>[]

function planoDe(entrada: Record<string, unknown>): Plano | null {
  const plano: Plano = []
  if (Array.isArray(entrada.etapas)) {
    for (const etapa of entrada.etapas as { nome?: unknown; passos?: unknown }[]) {
      const nome = texto(etapa?.nome, 60)
      for (const passo of Array.isArray(etapa?.passos) ? etapa.passos : []) {
        const titulo = texto(passo, 120)
        if (titulo) plano.push({ titulo, etapa: nome })
      }
    }
  } else if (Array.isArray(entrada.passos)) {
    for (const passo of entrada.passos) {
      const titulo = texto(passo, 120)
      if (titulo) plano.push({ titulo, etapa: '' })
    }
  } else {
    return null
  }

  return plano.slice(0, MAX_PASSOS)
}

/**
 * O passo que um valor da chamada nomeia: o título sem acento, caixa, espaço e pontuação; senão o número do passo,
 * a partir de 1; senão o único título que começa pelo valor.
 */
export function acharPasso(passos: Passo[], valor: unknown): Passo | undefined {
  const alvo = normal(texto(valor, 120))
  if (!alvo) return undefined
  const exato = passos.find(passo => normal(passo.titulo) === alvo)
  if (exato) return exato
  if (/^\d+$/.test(alvo)) {
    const passo = passos[Number(alvo) - 1]
    if (passo) return passo
  }
  const prefixo = passos.filter(passo => normal(passo.titulo).startsWith(alvo))

  return prefixo.length === 1 ? prefixo[0] : undefined
}

const listaDePassos = (passos: Passo[]) => passos.map((passo, i) => `${i + 1}. ${passo.titulo}`).join(' | ')

export const contar = (passos: Passo[]) => {
  const feito = passos.filter(passo => passo.estado === 'feito').length
  const pulados = passos.filter(passo => passo.estado === 'pulado').length

  return { feito, pulados, total: passos.length, faltam: passos.length - feito - pulados }
}

export type Resposta =
  | { negar: string }
  | { barras: Barra[]; barra: Barra; texto: string; virou: Estado | null }

/** Barra nova, com todos os campos; também completa uma barra gravada por uma versão anterior do mod. */
export function comoBarra(parcial: Partial<Barra> & Pick<Barra, 'id'>, agora: number): Barra {
  return {
    titulo: parcial.id,
    passos: [],
    estado: 'andamento',
    nota: '',
    criadaEm: agora,
    fechadaEm: null,
    dono: null,
    turno: '',
    atualizadaEm: parcial.criadaEm ?? agora,
    bg: false,
    ...parcial,
  }
}

/** Faixa nova, com todos os campos; também completa uma faixa gravada por uma versão anterior do mod. */
export function comoFaixa(parcial: Partial<Faixa> & Pick<Faixa, 'id' | 'tipo' | 'titulo'>, agora: number): Faixa {
  return {
    barra: null,
    modelo: '',
    esforco: '',
    ferramenta: '',
    trocaEm: agora,
    chamada: '',
    aprovacao: false,
    estado: 'ativa',
    inicio: agora,
    fim: null,
    dono: null,
    tipoAgente: '',
    turno: '',
    modeloId: '',
    tokens: 0,
    ctx: 0,
    janela: 0,
    usd: 0,
    passosTurno: 0,
    ...parcial,
  }
}

/**
 * Tira as finalizadas há mais de 12 h e, passando de 20 finalizadas, as mais velhas. A barra `manter` (a que acabou
 * de mudar) fica sempre; barra aberta nunca sai.
 */
export function podarBarras(barras: Barra[], agora: number, manter?: string) {
  const velha = (barra: Barra) =>
    barra.id !== manter && finalizada(barra) && agora - (barra.fechadaEm ?? barra.atualizadaEm) > VIDA_FINALIZADA_MS
  const lista = barras.filter(barra => !velha(barra))
  const total = lista.filter(finalizada).length
  const finalizadas = lista
    .filter(barra => finalizada(barra) && barra.id !== manter)
    .sort((a, b) => (a.fechadaEm ?? a.atualizadaEm) - (b.fechadaEm ?? b.atualizadaEm))
  const sobra = total - MAX_FINALIZADAS
  if (sobra <= 0) return lista
  const saem = new Set(finalizadas.slice(0, sobra))

  return lista.filter(barra => !saem.has(barra))
}

/**
 * Aplica uma chamada da ferramenta `progresso` à lista de barras. Função pura: devolve a lista nova e a linha de
 * resultado, ou o motivo da recusa. Título de passo que não casa não recusa a chamada: o resto se aplica e o
 * resultado avisa; a recusa fica para a chamada que não teria nada a aplicar.
 */
export function aplicar(
  barras: Barra[],
  entrada: Record<string, unknown>,
  agora: number,
  dono: string | null,
  turno = '',
): Resposta {
  const id = texto(entrada.id, 40)
  if (!id || id.startsWith('auto:')) return { negar: 'Informe `id` (texto curto, sem o prefixo "auto:").' }
  if (entrada.estado !== undefined && !ESTADOS.includes(entrada.estado as Estado)) {
    return { negar: `Estado inválido. Use um de: ${ESTADOS.join(', ')}.` }
  }

  const atual = barras.find(barra => barra.id === id)
  const plano = planoDe(entrada)
  if (plano?.length === 0) return { negar: 'Plano sem passos. Envie `etapas` ou `passos` com ao menos um título.' }
  if (!atual && !plano) {
    const existentes = barras.map(barra => barra.id).join(', ') || 'nenhuma'
    return { negar: `Barra "${id}" não existe (barras: ${existentes}). Crie com id, titulo e etapas ou passos.` }
  }

  const barra: Barra = atual
    ? { ...atual, passos: atual.passos.map(passo => ({ ...passo })) }
    : comoBarra({ id, criadaEm: agora, dono }, agora)
  let aplicou = !atual || plano !== null
  const titulo = texto(entrada.titulo, 80)
  if (titulo) {
    barra.titulo = titulo
    aplicou = true
  }

  if (plano) {
    const feitos = new Set(barra.passos.filter(passo => passo.estado === 'feito').map(passo => chave(passo.titulo)))
    // O passo que falhou continua falho no plano reescrito: virar ○ apagava a falha da lista.
    const falhos = new Set(barra.passos.filter(passo => passo.estado === 'falhou').map(passo => chave(passo.titulo)))
    const ativo = barra.passos.find(passo => passo.estado === 'ativo')
    barra.passos = plano.map(passo => ({
      ...passo,
      estado: feitos.has(chave(passo.titulo))
        ? 'feito'
        : falhos.has(chave(passo.titulo))
          ? 'falhou'
          : ativo && chave(ativo.titulo) === chave(passo.titulo)
          ? 'ativo'
          : 'aberto',
    }))
  }

  const ignorados: string[] = []
  const achar = (valor: unknown) => {
    const passo = acharPasso(barra.passos, valor)
    if (passo) aplicou = true
    else ignorados.push(texto(valor, 120))
    return passo
  }

  for (const feito of Array.isArray(entrada.feitos) ? entrada.feitos : []) {
    const passo = achar(feito)
    if (passo) passo.estado = 'feito'
  }
  if (entrada.proximo === true) {
    aplicou = true
    const ativo = barra.passos.find(passo => passo.estado === 'ativo')
    if (ativo) ativo.estado = 'feito'
  }
  const novoAtivo = entrada.ativo !== undefined ? achar(entrada.ativo) : undefined
  if (novoAtivo) {
    for (const outro of barra.passos) if (outro.estado === 'ativo') outro.estado = 'aberto'
    novoAtivo.estado = 'ativo'
  }
  const falho = entrada.falhou !== undefined ? achar(entrada.falhou) : undefined
  if (falho) falho.estado = 'falhou'
  if (entrada.estado !== undefined || entrada.nota !== undefined) aplicou = true

  if (!aplicou) {
    return { negar: `Nenhum passo encontrado para "${ignorados.join('", "')}" na barra "${id}". Passos: ${listaDePassos(barra.passos)}` }
  }

  const mexeu = plano !== null || entrada.proximo === true || entrada.feitos !== undefined || novoAtivo !== undefined
  if (entrada.estado !== undefined) {
    barra.estado = entrada.estado as Estado
  } else if (falho) {
    barra.estado = 'erro'
  } else if (atual && finalizada(atual)) {
    // Barra finalizada que recebe qualquer atualização volta ao trabalho.
    barra.estado = 'andamento'
  } else if (mexeu) {
    const semFalha = !barra.passos.some(passo => passo.estado === 'falhou')
    if (barra.estado !== 'erro' || semFalha) barra.estado = 'andamento'
  }

  if (barra.estado === 'concluido') {
    // Concluir à mão fecha o ativo; o que ficou aberto vira pulado, para a barra não mostrar 100% que não houve.
    for (const passo of barra.passos) {
      if (passo.estado === 'ativo') passo.estado = 'feito'
      else if (passo.estado === 'aberto') passo.estado = 'pulado'
    }
  } else {
    for (const passo of barra.passos) if (passo.estado === 'pulado') passo.estado = 'aberto'
  }
  if (finalizada(barra)) {
    barra.fechadaEm = atual && finalizada(atual) && atual.estado === barra.estado ? (barra.fechadaEm ?? agora) : agora
  } else {
    barra.fechadaEm = null
    const semAtivo = !barra.passos.some(passo => passo.estado === 'ativo')
    const primeiro = barra.passos.find(passo => passo.estado === 'aberto')
    if (semAtivo && primeiro && !falho) primeiro.estado = 'ativo'
  }

  if (entrada.nota !== undefined) barra.nota = texto(entrada.nota, 140)
  else if (barra.estado === 'andamento') barra.nota = ''
  barra.bg = false
  barra.turno = turno
  barra.atualizadaEm = agora

  const lista = atual ? barras.map(outra => (outra.id === id ? barra : outra)) : [...barras, barra]
  const { feito, pulados, total } = contar(barra.passos)
  const ativo = barra.passos.find(passo => passo.estado === 'ativo')
  const aviso = ignorados.length
    ? `\nAviso: ${ignorados.map(nome => `"${nome}"`).join(', ')} não casou com nenhum passo e foi ignorado. Passos: ${listaDePassos(barra.passos)}`
    : ''

  return {
    barras: podarBarras(lista, agora, id),
    barra,
    texto: `${feito}/${total} · ${ROTULO[barra.estado]}${pulados ? ` · ${pulados} ${pulados === 1 ? 'pulado' : 'pulados'}` : ''} · ${ativo ? `ativo: ${ativo.titulo}` : 'sem passo ativo'}${aviso}`,
    virou: atual?.estado === barra.estado ? null : barra.estado,
  }
}

/** Barras da conversa principal em andamento com passo aberto ou ativo: o fim do turno não as fecha sozinho. */
export const pendentes = (barras: Barra[]) =>
  barras.filter(
    barra => barra.dono === null && barra.estado === 'andamento' && barra.passos.some(passo => passo.estado === 'aberto' || passo.estado === 'ativo'),
  )

/** O pedido do Stop: nomeia cada barra, mostra X/Y e os passos abertos e diz como fechar. */
export function textoDoBloqueio(lista: Barra[], ferramenta: string) {
  const linhas = lista.map(barra => {
    const { feito, total } = contar(barra.passos)
    const abertos = barra.passos.filter(passo => passo.estado === 'aberto' || passo.estado === 'ativo').map(passo => passo.titulo)
    return `"${barra.titulo}" (id ${barra.id}) está em ${feito}/${total}; abertos: ${cortar(abertos.join(' | '), 300)}.`
  })

  return `Barra de progresso aberta. ${linhas.join(' ')} Antes de encerrar, feche com ${ferramenta}: estado "concluido" (abertos viram pulados), "esperando" se depende do usuário, ou falhou com o passo.`
}

const NOTA_DO_FIM = { aborted: 'interrompida', error: 'erro de API', refusal: 'recusa do modelo' } as const

/**
 * O fim de um turno da conversa principal. Barra aberta com tudo feito fecha como concluída. Turno interrompido ou
 * morto por erro para a barra em andamento. Turno respondido com passo aberto: com trabalho em background a barra
 * espera por ele; sem nada rodando, para em X/Y. Esperando fica como está.
 */
export function fimDoTurno(
  barras: Barra[],
  motivo: 'answer' | 'aborted' | 'refusal' | 'error',
  agora: number,
  turno: string,
  emBackground: number,
) {
  const mudadas: { barra: Barra; virou: Estado | null }[] = []
  const lista = barras.map(barra => {
    if (barra.dono !== null || finalizada(barra) || barra.id.startsWith('demo-')) return barra
    const { feito, total } = contar(barra.passos)
    let nova: Barra
    if (total > 0 && feito === total) {
      nova = { ...barra, estado: 'concluido', fechadaEm: agora, nota: '', bg: false }
    } else if (barra.estado !== 'andamento') {
      return barra
    } else if (motivo !== 'answer') {
      nova = { ...barra, estado: 'parada', fechadaEm: agora, nota: NOTA_DO_FIM[motivo], bg: false }
    } else if (emBackground > 0) {
      nova = { ...barra, nota: `aguardando ${emBackground} em background`, bg: true }
    } else {
      nova = { ...barra, estado: 'parada', fechadaEm: agora, nota: `parou em ${feito}/${total}`, bg: false }
    }
    nova = { ...nova, turno, atualizadaEm: agora }
    mudadas.push({ barra: nova, virou: nova.estado === barra.estado ? null : nova.estado })

    return nova
  })

  return { lista: podarBarras(lista, agora), mudadas }
}

/** Estado lido do store num processo novo: o que estava aberto parou com a sessão anterior. */
export function restaurada(barras: Partial<Barra>[], faixas: Partial<Faixa>[], agora: number) {
  return {
    barras: barras
      .filter((barra): barra is Partial<Barra> & Pick<Barra, 'id'> => typeof barra?.id === 'string')
      .map(barra => comoBarra(barra, agora))
      .map(barra => (finalizada(barra) ? barra : { ...barra, estado: 'parada' as const, nota: 'sessão anterior', fechadaEm: agora, bg: false })),
    faixas: faixas
      .filter((faixa): faixa is Partial<Faixa> & Pick<Faixa, 'id' | 'tipo' | 'titulo'> => typeof faixa?.id === 'string' && !!faixa.tipo)
      .map(faixa => comoFaixa(faixa, agora))
      .map(faixa => (faixa.fim === null ? { ...faixa, estado: 'parada' as const, fim: agora, ferramenta: '', aprovacao: false } : faixa)),
  }
}

/**
 * A barra onde uma faixa nova se pendura: a aberta (andamento ou esperando) do mesmo dono, mudada no turno em curso,
 * a mais recente. Barra parada, finalizada ou de turno antigo não recebe faixa: ela vai ao grupo automático.
 */
export function barraParaFaixa(barras: Barra[], dono: string | null, turno: string) {
  const candidatas = barras.filter(
    barra => barra.dono === dono && (barra.estado === 'andamento' || barra.estado === 'esperando') && barra.turno === turno,
  )

  return candidatas.sort((a, b) => b.atualizadaEm - a.atualizadaEm)[0]?.id ?? null
}

/** Faixas ativas sem barra, da conversa principal e do mesmo turno, entram na barra que acabou de nascer ou mudar. */
export const adotar = (faixas: Faixa[], barra: Barra) =>
  faixas.map(faixa =>
    faixa.barra === null && faixa.fim === null && faixa.dono === barra.dono && faixa.turno === barra.turno && !finalizada(barra)
      ? { ...faixa, barra: barra.id }
      : faixa,
  )

const grupoDe = (ids: Set<string>) => (faixa: Faixa) =>
  faixa.barra !== null && ids.has(faixa.barra) ? faixa.barra : `auto:${faixa.tipo}`

/**
 * As faixas que a banda mostra: as ativas, as terminadas há menos de SOME_MS e, num grupo que ainda tem faixa ativa,
 * as terminadas do turno em curso.
 */
export function faixasDaBanda(faixas: Faixa[], barras: Barra[], agora: number, turno: string) {
  const grupo = grupoDe(new Set(barras.map(barra => barra.id)))
  const vivos = new Set(faixas.filter(faixa => faixa.fim === null).map(grupo))

  return faixas.filter(
    faixa => faixa.fim === null || agora - faixa.fim < SOME_MS || (vivos.has(grupo(faixa)) && faixa.turno === turno),
  )
}

/** Há o que redesenhar a cada segundo: faixa ativa, ou uma que acabou de terminar e ainda vai sumir. */
export const relogioPreciso = (faixas: Faixa[], agora: number) =>
  faixas.some(faixa => faixa.fim === null || agora - faixa.fim < SOME_MS + 1500)

export type Tom = Estado | 'neutro'

export type LinhaVista = {
  id: string
  tom: Tom
  titulo: string
  comando: boolean
  /** subagentType do agente ('' em comando): escolhe o mascote. */
  tipo: string
  /** Modelo e esforço do agente. */
  meta: string
  /** Ferramenta em uso, "aguardando aprovação" ou o estado final. */
  selo: string
  relogio: string
  /** Posição da faixa no grupo, a partir de 1. */
  numero: number
  /** Pasta do comando (o "cd" tirado do rótulo), só para o alt; vazia no agente. */
  pasta: string
  inicio: number
  fim: number | null
}

export type Vista = {
  id: string
  tom: Estado
  titulo: string
  /** Etapa e passo ativo, ou o estado com a nota. */
  rotulo: string
  /** O que vai depois do título na pílula do desktop: a etapa atual (vazia em plano sem etapas) ou o tempo total da barra concluída. */
  pilula: string
  /** O estado escrito dentro da trilha, à direita da pílula: passo ativo, "Esperando você · nota", "Parou em 3/7"... */
  situacao: string
  /** "3/9 · faltam 6", ou "5/9 · 4 pulados" na barra concluída com pulados. */
  contagem: string
  feito: number
  pulados: number
  faltam: number
  total: number
  segmentos: Passo['estado'][]
  /** Índices dos segmentos que abrem uma etapa nova. */
  cortes: number[]
  linhas: LinhaVista[]
  resumo: string
  /** Quantas faixas o resumo esconde. */
  ocultas: number
}

const FIM: Record<Faixa['estado'], { selo: string; tom: Tom }> = {
  ativa: { selo: '', tom: 'andamento' },
  concluida: { selo: 'concluído', tom: 'concluido' },
  falhou: { selo: 'falhou', tom: 'erro' },
  parada: { selo: 'parado', tom: 'neutro' },
}

function linha(faixa: Faixa, agora: number, numero: number): LinhaVista {
  const fim = FIM[faixa.estado]

  return {
    id: faixa.id,
    tom: faixa.aprovacao ? 'esperando' : fim.tom,
    titulo: faixa.titulo,
    comando: faixa.tipo === 'comando',
    tipo: faixa.tipoAgente,
    meta: [faixa.modelo, faixa.esforco].filter(Boolean).join(' · '),
    selo: faixa.aprovacao ? 'aguardando aprovação' : fim.selo || faixa.ferramenta,
    relogio: relogio((faixa.fim ?? agora) - faixa.inicio),
    numero,
    pasta: faixa.pasta ?? '',
    inicio: faixa.inicio,
    fim: faixa.fim,
  }
}

function linhasDe(faixas: Faixa[], agora: number): Pick<Vista, 'linhas' | 'resumo' | 'ocultas'> {
  const visiveis = faixas.filter(faixa => faixa.fim === null || agora - faixa.fim < SOME_MS)
  const desenhar = (faixa: Faixa) => linha(faixa, agora, faixas.indexOf(faixa) + 1)
  if (visiveis.length <= 4) return { linhas: visiveis.map(desenhar), resumo: '', ocultas: 0 }

  const mostradas = [...visiveis]
    .sort((a, b) => Number(b.fim === null) - Number(a.fim === null) || b.inicio - a.inicio)
    .slice(0, 3)
    .sort((a, b) => a.inicio - b.inicio)
  const resto = faixas.filter(faixa => !mostradas.includes(faixa))
  const nome = resto.every(faixa => faixa.tipo === 'agente')
    ? 'agente'
    : resto.every(faixa => faixa.tipo === 'comando')
      ? 'comando'
      : 'tarefa'
  const concluidos = faixas.filter(faixa => faixa.estado === 'concluida').length
  const plural = (total: number, palavra: string) => `${total} ${palavra}${total === 1 ? '' : 's'}`

  return {
    linhas: mostradas.map(desenhar),
    resumo: `+${plural(resto.length, nome)} · ${plural(concluidos, 'concluído')}`,
    ocultas: resto.length,
  }
}

export function contagemDe(passos: Passo[], estado: Estado) {
  const { feito, pulados, total, faltam } = contar(passos)
  if (estado === 'concluido') return pulados ? `${feito}/${total} · ${pulados} ${pulados === 1 ? 'pulado' : 'pulados'}` : `${feito}/${total}`

  return `${feito}/${total} · faltam ${faltam}`
}

function vistaDaBarra(barra: Barra, faixas: Faixa[], agora: number, emBackground: number): Vista {
  const ativo = barra.passos.find(passo => passo.estado === 'ativo')
  const falhou = barra.passos.find(passo => passo.estado === 'falhou')
  const passo = ativo ? [ativo.etapa, ativo.titulo].filter(Boolean).join(' · ') : 'Tudo feito'
  const espera = barra.bg ? (emBackground > 0 ? `aguardando ${emBackground} em background` : barra.nota || 'aguardando background') : ''
  const rotulo: Record<Estado, string> = {
    andamento: [passo, espera].filter(Boolean).join(' · '),
    esperando: ['Esperando você', barra.nota].filter(Boolean).join(' · '),
    erro: ['Erro', barra.nota || falhou?.titulo].filter(Boolean).join(' · '),
    concluido: `Concluído em ${duracao((barra.fechadaEm ?? agora) - barra.criadaEm)}`,
    parada: ['Parada', barra.nota].filter(Boolean).join(' · '),
  }
  const atual = ativo ?? falhou ?? barra.passos.find(item => item.estado === 'aberto') ?? barra.passos.at(-1)
  const { feito, pulados, faltam, total } = contar(barra.passos)
  const situacao: Record<Estado, string> = {
    andamento: [ativo?.titulo ?? 'Tudo feito', espera].filter(Boolean).join(' · '),
    esperando: barra.nota ? `Esperando você · ${barra.nota}` : 'Aguardando informação',
    erro: `Falhou: ${falhou?.titulo || barra.nota || 'erro'}`,
    concluido: `Concluído em ${duracao((barra.fechadaEm ?? agora) - barra.criadaEm)}`,
    parada: `Parou em ${feito}/${total}`,
  }

  return {
    id: barra.id,
    tom: barra.estado,
    titulo: barra.titulo,
    rotulo: rotulo[barra.estado],
    // Concluída, a pílula leva o tempo total, como na v1, menos quando ele é 0s; aí fica a etapa.
    pilula: barra.estado === 'concluido' && decorrido((barra.fechadaEm ?? agora) - barra.criadaEm) !== '0s' ? decorrido((barra.fechadaEm ?? agora) - barra.criadaEm) : (atual?.etapa ?? ''),
    situacao: situacao[barra.estado],
    contagem: contagemDe(barra.passos, barra.estado),
    feito,
    pulados,
    faltam,
    total,
    segmentos: barra.passos.map(item => item.estado),
    cortes: barra.passos.flatMap((item, i) => (i > 0 && item.etapa !== barra.passos[i - 1]?.etapa ? [i] : [])),
    ...linhasDe(faixas, agora),
  }
}

function vistaAutomatica(tipo: Faixa['tipo'], faixas: Faixa[], agora: number): Vista {
  const ativas = faixas.filter(faixa => faixa.fim === null).length
  const falhas = faixas.filter(faixa => faixa.estado === 'falhou').length
  const esperando = faixas.some(faixa => faixa.aprovacao)
  const tom: Estado = esperando ? 'esperando' : falhas > 0 ? 'erro' : ativas === 0 ? 'concluido' : 'andamento'
  const rotulo: Record<Estado, string> = {
    andamento: `${ativas} em execução`,
    esperando: 'Aguardando aprovação',
    erro: `${falhas} com falha`,
    concluido: 'Concluído',
    parada: 'Parado',
  }
  const inicio = Math.min(...faixas.map(faixa => faixa.inicio))
  const fim = Math.max(...faixas.map(faixa => faixa.fim ?? agora))

  return {
    id: `auto:${tipo}`,
    tom,
    titulo: tipo === 'agente' ? 'Agentes' : 'Em background',
    rotulo: rotulo[tom],
    pilula: tom === 'concluido' ? decorrido(fim - inicio) : rotulo[tom],
    situacao: rotulo[tom],
    contagem: `${faixas.length - ativas}/${faixas.length}`,
    feito: faixas.length - ativas,
    pulados: 0,
    faltam: ativas,
    total: faixas.length,
    segmentos: faixas.map(faixa => (faixa.fim === null ? 'ativo' : faixa.estado === 'falhou' ? 'falhou' : 'feito')),
    cortes: [],
    ...linhasDe(faixas, agora),
  }
}

/**
 * O que a banda acima do prompt mostra: as barras abertas, as finalizadas no turno em curso e a que ainda tem faixa
 * rodando, cada uma com as faixas dela; depois um grupo automático por tipo com as faixas sem barra.
 */
export function vistas(barras: Barra[], faixas: Faixa[], agora: number, turno = ''): Vista[] {
  const daBanda = faixasDaBanda(faixas, barras, agora, turno)
  const grupo = grupoDe(new Set(barras.map(barra => barra.id)))
  const doGrupo = (id: string) => daBanda.filter(faixa => grupo(faixa) === id)
  const emBackground = faixas.filter(faixa => faixa.fim === null).length
  const saida = barras
    .filter(barra => !finalizada(barra) || barra.turno === turno || faixas.some(faixa => faixa.barra === barra.id && faixa.fim === null))
    .map(barra => vistaDaBarra(barra, doGrupo(barra.id), agora, emBackground))
  for (const tipo of ['agente', 'comando'] as const) {
    const lista = doGrupo(`auto:${tipo}`)
    if (lista.length > 0) saida.push(vistaAutomatica(tipo, lista, agora))
  }

  return saida
}

/** Grupo automático: só as faixas e um rótulo, sem trilha. */
export const automatica = (vista: Pick<Vista, 'id'>) => vista.id.startsWith('auto:')

export const percentual = (vista: Pick<Vista, 'feito' | 'total'>) => (vista.total === 0 ? 0 : Math.round((vista.feito / vista.total) * 100))

/** A tarefa do painel: a barra aberta mudada por último; sem ela, a do turno em curso; sem ela, a mais recente. */
export function barraEmFoco(barras: Barra[], turno: string) {
  const recentes = [...barras].sort((a, b) => b.atualizadaEm - a.atualizadaEm)

  return recentes.find(barra => !finalizada(barra)) ?? recentes.find(barra => barra.turno === turno) ?? recentes[0]
}

/** Custo, tokens e tempo de uma barra: os agentes pendurados nela e o tempo de criada até fechada (ou agora). */
export function resumoDaBarra(barra: Barra, faixas: Faixa[], agora: number) {
  const agentes = faixas.filter(faixa => faixa.barra === barra.id && faixa.tipo === 'agente')
  const comCusto = agentes.filter(faixa => faixa.tokens > 0)
  const usd = comCusto.length === 0 ? null : comCusto.reduce<number | null>((soma, faixa) => (soma === null || faixa.usd === null ? null : soma + faixa.usd), 0)

  return {
    tokens: agentes.reduce((soma, faixa) => soma + faixa.tokens, 0),
    usd,
    ms: (barra.fechadaEm ?? agora) - barra.criadaEm,
  }
}

export type Nivel = { rotulo: string; cor: string; hex: string }

/** A cor de cada nível, uma só para o texto do nível, a barra do agente e o acessório do mascote. */
export const NIVEL_HEX = {
  'executor-leve': '#4CB782',
  executor: '#4B8FE8',
  'executor-pesado': '#E5533A',
  'executor-design': '#E46FA0',
  investigador: '#D9A033',
  leitor: '#3CC4D8',
} as const satisfies Record<string, string>
const ROTULO_DO_NIVEL: Record<string, string> = {
  'executor-leve': 'leve',
  executor: 'médio',
  'executor-pesado': 'pesado',
  'executor-design': 'design',
  investigador: 'investigador',
  leitor: 'leitor',
}

/** O nível do agente pelo tipo: os executores pela carga, os outros pelo nome do tipo, em cinza. */
export function nivelDe(tipo: string): Nivel {
  const nome = tipo.replace(/^.*:/, '')
  const hex = (NIVEL_HEX as Record<string, string>)[nome]
  if (!hex) return { rotulo: nome || 'agente', cor: '#8A857B', hex: '#8A857B' }

  return { rotulo: ROTULO_DO_NIVEL[nome] ?? nome, cor: hex, hex }
}

export type Perfil = { modelo: string; esforco: string }

/** Modelo e esforço de cada tipo quando o frontmatter de ~/.claude/agents não pôde ser lido. */
export const PERFIS: Record<string, Perfil> = {
  leitor: { modelo: 'sonnet 5.5', esforco: 'médio' },
  investigador: { modelo: 'opus 5.5', esforco: 'médio' },
  'executor-leve': { modelo: 'sonnet 5.5', esforco: 'médio' },
  executor: { modelo: 'opus 5.5', esforco: 'médio' },
  'executor-design': { modelo: 'opus 5.5', esforco: 'médio' },
  'executor-pesado': { modelo: 'opus 5.5', esforco: 'alto' },
}

/** name, model e effort do frontmatter de um arquivo de agente; undefined sem os três. */
export function perfilDoArquivo(texto: string): { nome: string; perfil: Perfil } | undefined {
  const bloco = /^---\r?\n([\s\S]*?)\r?\n---/.exec(texto)?.[1]
  if (!bloco) return undefined
  const campo = (nome: string) => new RegExp(`^${nome}:\\s*["']?([^"'\\r\\n]+?)["']?\\s*$`, 'm').exec(bloco)?.[1] ?? ''
  const nome = campo('name')
  const modelo = campo('model')
  if (!nome || !modelo) return undefined

  return { nome, perfil: { modelo: modeloCurto(modelo), esforco: esforcoPt(campo('effort') || undefined) } }
}

/** "opus 5.5 · médio" vira "Opus 5.5 · médio", como o painel mostra. */
export const comMaiuscula = (texto: string) => texto.charAt(0).toUpperCase() + texto.slice(1)

/** O tipo de agente no fim do título de um passo ("Revisar a release (executor-pesado)"), e o título sem ele. */
export function tipoDoPasso(titulo: string, tipos: readonly string[]) {
  const achado = /^(.*?)\s*\(([\w:-]+)\)\s*$/.exec(titulo)
  if (!achado) return undefined
  const tipo = achado[2] ?? ''
  if (!tipos.includes(tipo.replace(/^.*:/, ''))) return undefined

  return { titulo: achado[1] ?? titulo, tipo }
}

/** Quantas linhas da conversa de um agente o painel guarda. */
export const MAX_FALAS = 200
const MAX_FALA = 4000
const ARGUMENTO = ['description', 'file_path', 'command', 'pattern', 'query', 'url', 'prompt'] as const

const fala = (quem: Fala['quem'], valor: unknown): Fala[] => {
  const limpo = typeof valor === 'string' ? valor.trim() : ''
  return limpo ? [{ quem, texto: cortar(limpo, MAX_FALA) }] : []
}

/** "Read · /caminho/do/arquivo": a ferramenta e o argumento que diz o que ela foi fazer. */
function chamada(ferramenta: unknown, entrada: unknown): Fala[] {
  const campos = (entrada ?? {}) as Record<string, unknown>
  const argumento = ARGUMENTO.map(nome => campos[nome]).find(valor => typeof valor === 'string' && valor !== '')
  const nome = ferramentaCurta(typeof ferramenta === 'string' ? ferramenta : 'ferramenta')

  return fala('ferramenta', argumento ? `${nome} · ${cortar(texto(argumento, 200), 90)}` : nome)
}

/** A conversa lida por $.session.messages({ agentId }), em linhas do painel. */
export function falasDaConversa(mensagens: { role: 'user' | 'assistant'; text: string; toolUses: { tool: string; input: Record<string, unknown> }[] }[]) {
  return mensagens
    .flatMap(mensagem => [
      ...fala(mensagem.role === 'assistant' ? 'agente' : 'entrada', mensagem.text),
      ...mensagem.toolUses.flatMap(uso => chamada(uso.tool, uso.input)),
    ])
    .slice(-MAX_FALAS)
}

/** Uma linha nova da conversa, como session.append a entrega: texto e chamadas de ferramenta; resultado e raciocínio ficam fora. */
export function falasDaLinha(mensagem: { type: string; content: string | { type: string; [campo: string]: unknown }[] }) {
  if (mensagem.type !== 'user' && mensagem.type !== 'assistant') return []
  const quem = mensagem.type === 'assistant' ? 'agente' : 'entrada'
  if (typeof mensagem.content === 'string') return fala(quem, mensagem.content)

  return mensagem.content.flatMap(bloco =>
    bloco.type === 'text' ? fala(quem, bloco.text) : bloco.type === 'tool_use' ? chamada(bloco.name, bloco.input) : [],
  )
}

/** O texto de uma linha, com `content` em string ou em blocos. */
export const textoDaLinha = (content: string | readonly { type: string; text?: string }[]) =>
  typeof content === 'string' ? content : content.map(bloco => (bloco.type === 'text' ? (bloco.text ?? '') : '')).join('\n')
