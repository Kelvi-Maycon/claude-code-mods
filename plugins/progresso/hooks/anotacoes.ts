// Anotações da conversa: o que o usuário precisaria procurar depois (URL publicada, ID, recurso criado, decisão
// fechada). Ficam no store por conversa, junto das pendências; a ferramenta e o painel mexem na mesma lista.
import type { Anotacao } from '../types'
import { acharPasso, normal, texto } from './modelo'

export const MAX_ANOTACOES = 100
const MAX_VALOR = 2000

/** Valor livre: só as pontas aparadas, quebras de linha mantidas. */
const valorLivre = (valor: unknown) => (typeof valor === 'string' ? valor.trim().slice(0, MAX_VALOR) : typeof valor === 'number' ? String(valor) : '')

/** Anotação gravada por uma versão anterior, ou pela metade, completa; sem título, null. */
export function comoAnotacao(parcial: Partial<Anotacao> | undefined, agora: number): Anotacao | null {
  const titulo = texto(parcial?.titulo, 120)
  if (!titulo) return null

  return { titulo, valor: valorLivre(parcial?.valor), grupo: texto(parcial?.grupo, 60), criadaEm: parcial?.criadaEm ?? agora }
}

/** Uma URL só, sem espaço: vira link no painel. */
export const ehUrl = (valor: string) => /^https?:\/\/[^\s]+$/i.test(valor.trim())

/** A URL sem o esquema e sem a barra final, para caber na linha. */
export const urlCurta = (valor: string) => valor.trim().replace(/^https?:\/\//i, '').replace(/\/$/, '')

// Formatos de chave conhecidos e títulos que dizem senha: o modelo não guarda segredo, nem a pedido.
const SEGREDO_NO_VALOR = /\b(sk-[a-z0-9_-]{16,}|sk_(live|test)_[a-z0-9]{16,}|gh[pousr]_[a-z0-9]{20,}|xox[abpr]-[a-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[a-z0-9_-]{20,}\.[a-z0-9_-]{10,})/i
const SEGREDO_NO_TITULO = /\b(senha|password|passwd|secret|segredo)\b/i
export const pareceSegredo = (titulo: string, valor: string) => SEGREDO_NO_TITULO.test(titulo) || SEGREDO_NO_VALOR.test(valor)

/** "1. Aula 1: exemplo.com/curso/... [Curso · páginas] | ..." ou "nenhuma". */
export const listaDeAnotacoes = (lista: Anotacao[]) =>
  lista.length === 0
    ? 'nenhuma'
    : lista.map((item, i) => `${i + 1}. ${item.titulo}${item.valor ? `: ${item.valor.replace(/\s+/g, ' ')}` : ''}${item.grupo ? ` [${item.grupo}]` : ''}`).join(' | ')

/** A chamada mexe em anotações: adicionar, esquecer ou listar. */
export const pedeAnotacoes = (entrada: Record<string, unknown>) =>
  entrada.anotacoes !== undefined || entrada.esquecer !== undefined || entrada.listarAnotacoes === true

/** Grava uma anotação: o título que já existe (sem acento nem caixa) troca valor e grupo no lugar. */
export function gravarAnotacao(lista: Anotacao[], nova: Anotacao): Anotacao[] {
  const igual = lista.find(item => normal(item.titulo) === normal(nova.titulo))
  const saida = igual ? lista.map(item => (item === igual ? { ...nova, criadaEm: igual.criadaEm } : item)) : [...lista, nova]

  return saida.slice(-MAX_ANOTACOES)
}

/**
 * Aplica a parte de anotações de uma chamada: esquece pelo título (como os passos casam) ou número, contados na lista
 * de antes da chamada, e depois adiciona ou atualiza. Valor com cara de segredo é recusado item a item.
 */
export function aplicarAnotacoes(
  lista: Anotacao[],
  entrada: Record<string, unknown>,
  agora: number,
): { negar: string } | { anotacoes: Anotacao[]; texto: string } {
  const esquecer = entrada.esquecer === undefined ? [] : Array.isArray(entrada.esquecer) ? entrada.esquecer : [entrada.esquecer]
  const novas = entrada.anotacoes === undefined ? [] : Array.isArray(entrada.anotacoes) ? entrada.anotacoes : [entrada.anotacoes]
  const saem = new Set<Anotacao>()
  const ignorados: string[] = []
  for (const valor of esquecer) {
    const achada = acharPasso(lista, valor)
    if (achada) saem.add(achada)
    else ignorados.push(texto(valor, 120))
  }
  let saida = lista.filter(item => !saem.has(item))
  let gravadas = 0
  const recusadas: string[] = []
  for (const bruta of novas) {
    const nova = comoAnotacao((bruta ?? {}) as Partial<Anotacao>, agora)
    if (!nova) continue
    if (pareceSegredo(nova.titulo, nova.valor)) {
      recusadas.push(nova.titulo)
      continue
    }
    saida = gravarAnotacao(saida, nova)
    gravadas += 1
  }

  if (ignorados.length > 0 && saem.size === 0 && gravadas === 0 && recusadas.length === 0 && entrada.listarAnotacoes !== true) {
    return { negar: `Nenhuma anotação casou com "${ignorados.join('", "')}". Anotações: ${listaDeAnotacoes(lista)}` }
  }
  if (recusadas.length > 0 && gravadas === 0 && saem.size === 0) {
    return { negar: `Senha e segredo não entram em anotação: "${recusadas.join('", "')}" ficou fora.` }
  }
  if (novas.length > 0 && gravadas === 0 && saem.size === 0 && entrada.listarAnotacoes !== true) {
    return { negar: 'Anotação sem título. Envie anotacoes:[{titulo, valor, grupo?}].' }
  }
  const feito = [
    gravadas ? `${gravadas} ${gravadas === 1 ? 'anotada' : 'anotadas'}` : '',
    saem.size ? `${saem.size} ${saem.size === 1 ? 'esquecida' : 'esquecidas'}` : '',
  ].filter(Boolean)
  const avisos = [
    ignorados.length ? ` Aviso: ${ignorados.map(nome => `"${nome}"`).join(', ')} não casou com nenhuma anotação.` : '',
    recusadas.length ? ` Segredo fora: ${recusadas.map(nome => `"${nome}"`).join(', ')}.` : '',
  ].join('')

  return {
    anotacoes: saida,
    texto: `${feito.length ? `${feito.join(', ')} · ` : ''}Anotações (${saida.length}): ${listaDeAnotacoes(saida)}.${avisos}`,
  }
}

/** Os grupos na ordem em que apareceram, os itens sem grupo primeiro; `indice` é a posição na lista. */
export function gruposDe(lista: Anotacao[]): { grupo: string; itens: { item: Anotacao; indice: number }[] }[] {
  const grupos: { grupo: string; itens: { item: Anotacao; indice: number }[] }[] = []
  lista.forEach((item, indice) => {
    const achado = grupos.find(g => normal(g.grupo) === normal(item.grupo))
    if (achado) achado.itens.push({ item, indice })
    else grupos.push({ grupo: item.grupo, itens: [{ item, indice }] })
  })

  return [...grupos.filter(g => !g.grupo), ...grupos.filter(g => g.grupo)]
}

/**
 * A edição do painel: troca o item de título `original` pelo novo. Se o título novo já é de outro item, o outro sai
 * (título é único). Sem título, nada muda.
 */
export function editarAnotacao(lista: Anotacao[], original: string, campos: { titulo: string; valor: string; grupo: string }, agora: number): Anotacao[] {
  const alvo = lista.find(item => item.titulo === original)
  const nova = comoAnotacao({ ...campos, criadaEm: alvo?.criadaEm ?? agora }, agora)
  if (!alvo || !nova) return lista
  const semColisao = lista.filter(item => item === alvo || normal(item.titulo) !== normal(nova.titulo))

  return semColisao.map(item => (item === alvo ? nova : item))
}

export const contagemDeAnotacoes = (n: number) => (n === 0 ? 'Anotações' : `Anotações · ${n}`)

// Notas livres: um bloco de texto do usuário por conversa, no topo do painel. A altura é escolhida em linhas, de 4 em 4,
// e o campo cresce com o texto até o teto.
export const NOTAS_INICIAL = 8
export const NOTAS_MIN = 4
export const NOTAS_MAX = 40
export const NOTAS_PASSO = 4
/** Quanto das notas livres a listagem devolve ao modelo. */
export const NOTAS_TRECHO = 1500

/** Linhas do texto, contando as vazias do meio; texto vazio tem 0. */
export const linhasDe = (texto: string) => (texto ? texto.split('\n').length : 0)

/** A altura do campo: a escolhida ou, maior que ela, o texto mais uma linha livre; nunca além do teto. */
export const rowsDasNotas = (altura: number, texto: string) => Math.min(NOTAS_MAX, Math.max(altura, linhasDe(texto) + 1))

/** A altura escolhida mais `passo` linhas, dentro dos limites. */
export const alturaDasNotas = (altura: number, passo: number) => Math.min(NOTAS_MAX, Math.max(NOTAS_MIN, altura + passo))

const SEGREDO_NO_TEXTO = new RegExp(SEGREDO_NO_VALOR.source, 'gi')
const SEGREDO_ROTULADO = /\b(senha|password|passwd|secret|segredo|token)(\s*[:=]\s*)\S+/gi

/** O texto com chave e senha rotulada trocadas por "[oculto]": o texto livre é do usuário e entra inteiro, mas o
 * modelo só lê a versão mascarada. */
export const mascararSegredos = (texto: string) => texto.replace(SEGREDO_NO_TEXTO, '[oculto]').replace(SEGREDO_ROTULADO, '$1$2[oculto]')

/** A linha das notas livres na listagem: contagem total e um trecho mascarado; null sem texto. */
export function listaDasNotas(texto: string): string | null {
  if (!texto.trim()) return null
  const limpo = mascararSegredos(texto)
  const trecho = limpo.length > NOTAS_TRECHO ? `${limpo.slice(0, NOTAS_TRECHO)}… (+${limpo.length - NOTAS_TRECHO} caracteres)` : limpo

  return `Notas livres (${linhasDe(texto)} linhas, ${texto.length} caracteres):\n${trecho}`
}
