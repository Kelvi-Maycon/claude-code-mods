// O painel lateral "Progresso", no formato do painel de agentes: título da tarefa, cartões de custo, tokens e tempo,
// o Recolher, a linha da conversa principal com a prancheta e os passos, e os grupos Rodando, Concluídos, Falharam e
// Planejados, uma linha por agente ou comando com o mascote (ou o ícone) à esquerda. No desktop mascotes, barras e
// divisórias são Svg; no terminal, sprite em meio-bloco, traços e fios de texto.
import type { Elements, RenderElement } from 'claude-code'

import type { Barra, Faixa, Passo } from '../types'
import { desenhoDoTipo, glifoDe, svgDoIcone } from './icones'
import type { Desenho, Variante } from './icones'
import { comMaiuscula, contar, cortar, ferramentaCurta, nivelDe, relogio, tokensCurtos, usdCurto } from './modelo'
import type { Perfil } from './modelo'
import { svgBarraCor, svgBarraIndeterminada, svgDaMetrica, svgDoCartao, svgDoCartaoTempo, svgDoEstado, svgDoFio, svgDoPasso } from './svg'
import type { EstadoDoPasso, NomeDoEstado } from './svg'

type Elementos = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'> & { Svg?: Elements['desktop']['Svg'] }

export type Planejado = { numero: number; titulo: string; tipo: string }

export type DadosDoPainel = {
  agora: number
  colunas: number
  barra: Barra | undefined
  resumo: { tokens: number; usd: number | null; ms: number } | undefined
  agentes: Faixa[]
  comandos: Faixa[]
  planejados: Planejado[]
  /** Modelo e esforço do tipo, para o planejado e o agente que ainda não informou os dele. */
  perfil: (tipo: string) => Perfil | undefined
  concluidosAbertos: boolean
  recolhido: boolean
  passosAbertos: boolean
}

export type AcoesDoPainel = {
  abrirAgente: (id: string, titulo: string) => unknown
  alternarConcluidos: () => unknown
  alternarRecolhido: () => unknown
  alternarPassos: () => unknown
  fechar: () => unknown
}

const LARANJA = '#D97757'
const VERMELHO = '#E5534B'
const CINZA = '#8A857B'
// A casa do ícone no desktop (40 px, ícone de linha de 22 px no centro) e a coluna do glifo no terminal (2 células e o
// vão). O Svg da casa tem 44 px de largura: os 4 px transparentes e a coluna de vão (8 px) dão os 12 px até o texto.
const CASA_PX = 40
const MASCOTE_CAIXA = 44
const MASCOTE_COLUNAS = 3
// Respiro de 16 px acima e abaixo do fio entre duas linhas, e 8 px entre o cabeçalho do grupo e a primeira linha.
const FIO_PX = 33
const VAO_CABECALHO = 8

// O passo no terminal: glifo na cor do tema. O que falhou é ✕ vermelho, nunca ○.
const PASSO: Record<Passo['estado'], { icone: string; cor: string | undefined; apagado: boolean }> = {
  feito: { icone: '✓', cor: 'success', apagado: true },
  ativo: { icone: '✻', cor: 'claude', apagado: false },
  aberto: { icone: '○', cor: undefined, apagado: true },
  falhou: { icone: '✕', cor: 'error', apagado: false },
  pulado: { icone: '↷', cor: 'inactive', apagado: true },
}

// O ícone de estado no canto direito do título: glifo na cor do tema no terminal; no desktop um Svg de 14 px, com o
// ponto do rodando em 8 px e o relógio do planejado do tamanho do check.
// No desktop o ícone é o Svg de 16 px de svgDoEstado: a estrela do Claude no que roda, o alerta âmbar na espera.
type Icone = { nome: string; glifo: string; cor: string; svg: NomeDoEstado }
const ICONE: Record<NomeDoEstado, Icone> = {
  rodando: { nome: 'rodando', glifo: '✻', cor: 'claude', svg: 'rodando' },
  comando: { nome: 'rodando', glifo: '•', cor: 'subtle', svg: 'comando' },
  aprovacao: { nome: 'aguardando aprovação', glifo: '⚠', cor: 'warning', svg: 'aprovacao' },
  concluida: { nome: 'concluído', glifo: '✓', cor: 'success', svg: 'concluida' },
  falhou: { nome: 'falhou', glifo: '✕', cor: 'error', svg: 'falhou' },
  parada: { nome: 'parado', glifo: '■', cor: 'inactive', svg: 'parada' },
  planejado: { nome: 'planejado', glifo: '◷', cor: 'inactive', svg: 'planejado' },
}
const ICONE_DA_BARRA: Record<Barra['estado'], Icone> = {
  andamento: ICONE.rodando,
  esperando: { ...ICONE.aprovacao, nome: 'esperando você' },
  erro: ICONE.falhou,
  concluido: ICONE.concluida,
  parada: ICONE.parada,
}
const ESTADO_DA_FAIXA: Record<Faixa['estado'], string> = { ativa: 'rodando', concluida: 'concluído', falhou: 'falhou', parada: 'parado' }

/** Px aproximados de uma largura em colunas, a mesma medida da banda (7,69 px por coluna). */
const px = (colunas: number) => Math.max(40, Math.floor(colunas * 7.69) - 4)

type Item = {
  chave: string
  desenho: Desenho
  animado?: boolean
  variante?: Variante
  titulo: string
  icone: Icone
  linha2: RenderElement
  esquerda?: { texto: string; cor?: string; apagado?: boolean }
  /** Os números da direita (ctx, tokens, custo) sem o tempo, que vem de `tempo`. */
  direita?: string
  tempo?: { inicio: number; fim: number | null }
  barra?: { tipo: 'fracao'; fracao: number; cor: string; corTerminal: string; brilho?: boolean } | { tipo: 'indeterminada'; cor: string; corTerminal: string }
  abrir?: () => unknown
}

export function desenharPainel(els: Elementos, dados: DadosDoPainel, acoes: AcoesDoPainel): RenderElement {
  const { Box, Text, Button, Svg } = els
  const { agora, colunas, barra, resumo } = dados
  const larguraTexto = Math.max(16, colunas - MASCOTE_COLUNAS)
  // A coluna de texto começa depois do mascote e do vão de uma coluna (~8 px) e vai até a borda das divisórias.
  // No desktop o painel ganha 8 px de cada lado além do respiro do host (16): 24 px da borda, como na referência.
  const margem = Svg ? 1 : 0
  const util = px(colunas) - margem * 16
  const larguraBarraPx = Math.max(60, util - MASCOTE_CAIXA - 8)

  const fio = (chave: string) =>
    Svg ? (
      <Svg key={chave} source={svgDoFio(util, FIO_PX)} alt="divisória" width={util} height={FIO_PX} />
    ) : (
      <Text key={chave} dimColor>{'─'.repeat(Math.max(8, colunas))}</Text>
    )
  // Vão transparente da grade de 8 px, onde Box não tem medida em px.
  const vao = (chave: string, altura: number) => (Svg ? [<Svg key={chave} source={`<svg xmlns="http://www.w3.org/2000/svg" width="8" height="${altura}"/>`} alt="espaço" width={8} height={altura} />] : [])

  // O ícone de linha do item: no desktop a casa arredondada com o ícone no centro (a antena ou o cursor pisca no que
  // roda, em SMIL num Svg isInteractive); no terminal o glifo do tipo, apagado no planejado.
  const mascote = (item: Item) => {
    if (Svg) {
      return (
        <Svg
          key={`m:${item.chave}`}
          source={svgDoIcone(item.desenho, { variante: item.variante, animado: item.animado, largura: MASCOTE_CAIXA })}
          alt={`ícone ${item.desenho}${item.variante && item.variante !== 'normal' ? ` ${item.variante}` : ''}`}
          width={MASCOTE_CAIXA}
          height={CASA_PX}
          isInteractive={item.animado ? true : undefined}
        />
      )
    }

    return (
      <Box key={`m:${item.chave}`} flexShrink={0} width={2}>
        <Text dimColor={item.variante === 'planejado'} color={item.variante === 'falhou' ? 'error' : undefined}>
          {glifoDe(item.desenho)}
        </Text>
      </Box>
    )
  }

  const barraDoItem = (item: Item) => {
    const b = item.barra
    if (!b) return false
    if (Svg) {
      const brilho = b.tipo === 'fracao' && b.brilho === true
      const source = b.tipo === 'fracao' ? svgBarraCor(b.fracao, b.cor, larguraBarraPx, 4, brilho) : svgBarraIndeterminada(b.cor, larguraBarraPx, 4)
      // O que anda (segmento indeterminado, aceno do mascote) vai num Svg isInteractive: o tipo diz que sem ele o Svg é
      // desenhado "an image", e que o quadro sandboxed é o modo em que a animação roda. A fonte não muda por tique.
      return (
        <Svg
          key={`b:${item.chave}`}
          source={source}
          alt={b.tipo === 'fracao' ? `${Math.round(b.fracao * 100)}%` : 'em andamento'}
          width={larguraBarraPx}
          height={4}
          isInteractive={b.tipo === 'indeterminada' || brilho ? true : undefined}
        />
      )
    }
    const total = Math.max(6, larguraTexto - 1)
    if (b.tipo === 'fracao') {
      const cheio = Math.round(total * Math.max(0, Math.min(1, b.fracao)))
      return (
        <Text key={`b:${item.chave}`}>
          <Text color={b.corTerminal}>{'━'.repeat(cheio)}</Text>
          <Text dimColor>{'─'.repeat(total - cheio)}</Text>
        </Text>
      )
    }
    // Sem fração: um segmento que anda um passo por tique.
    const seg = Math.max(2, Math.round(total * 0.28))
    const inicio = Math.round((((Math.floor(agora / 1000) % 5) + 1) * (total + seg)) / 6) - seg
    const de = Math.max(0, inicio)
    const ate = Math.min(total, inicio + seg)
    return (
      <Text key={`b:${item.chave}`}>
        <Text dimColor>{'─'.repeat(de)}</Text>
        <Text color={b.corTerminal}>{'━'.repeat(Math.max(0, ate - de))}</Text>
        <Text dimColor>{'─'.repeat(total - Math.max(de, ate))}</Text>
      </Text>
    )
  }

  // A situação e os números: no desktop um Svg da largura da barra, com os números tabulares encostados na ponta dela;
  // no terminal, texto nas duas pontas da linha.
  const metricaDoItem = (item: Item) => {
    if (!item.esquerda && !item.direita && !item.tempo) return false
    const tempo = item.tempo ? relogio((item.tempo.fim ?? agora) - item.tempo.inicio) : ''
    if (Svg) {
      const m = svgDaMetrica(item.chave, item.esquerda ?? { texto: '' }, item.direita ?? '', item.tempo ?? { inicio: agora, fim: agora }, larguraBarraPx, agora)
      return <Svg key={`n:${item.chave}`} source={m.source} alt={m.alt} width={larguraBarraPx} height={m.altura} />
    }
    const direita = [item.direita, tempo].filter(Boolean).join(' ')

    return (
      <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
        <Text color={item.esquerda?.cor} dimColor={item.esquerda?.apagado} wrap="truncate-end">
          {item.esquerda?.texto ?? ''}
        </Text>
        {!!direita && <Text dimColor>{direita}</Text>}
      </Box>
    )
  }

  const linhaDoItem = (item: Item) => (
    <Box key={`item:${item.chave}`} flexDirection="row" columnGap={1} alignItems="flex-start">
      {mascote(item)}
      <Box flexDirection="column" flexGrow={1}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={1}>
          {/* O título do agente é o botão que abre a conversa: na API só Button tem onPress (Box e Svg não têm) e
              Button não tem negrito, então ele fica em peso normal; os títulos que não abrem nada vão em negrito. */}
          <Box flexDirection="row" flexGrow={1}>
            {item.abrir ? (
              <Button key={`card:${item.chave}`} label={cortar(item.titulo, Math.max(10, larguraTexto - 3))} plain onPress={() => item.abrir?.()} />
            ) : (
              <Text bold wrap="truncate-end">{cortar(item.titulo, Math.max(10, larguraTexto - 3))}</Text>
            )}
          </Box>
          {Svg ? (
            <Svg
              key={`e:${item.chave}`}
              source={svgDoEstado(item.icone.svg).source}
              alt={item.icone.nome}
              width={16}
              height={16}
              isInteractive={svgDoEstado(item.icone.svg).anima ? true : undefined}
            />
          ) : (
            <Text color={item.icone.cor}>{item.icone.glifo}</Text>
          )}
        </Box>
        {item.linha2}
        {metricaDoItem(item)}
        {barraDoItem(item)}
      </Box>
    </Box>
  )

  const nivelEModelo = (tipo: string, modelo: string, esforco: string, apagado = false) => {
    const nivel = nivelDe(tipo)
    const perfil = dados.perfil(tipo)
    const meta = [modelo || perfil?.modelo || '', esforco || perfil?.esforco || ''].filter(Boolean).join(' · ')

    return (
      <Text>
        <Text color={nivel.cor} dimColor={apagado}>{nivel.rotulo}</Text>
        {!!meta && <Text dimColor>{` ${comMaiuscula(meta)}`}</Text>}
      </Text>
    )
  }

  const numerosDe = (faixa: Faixa) => {
    const pct = faixa.janela > 0 && faixa.ctx > 0 ? Math.max(1, Math.round((faixa.ctx / faixa.janela) * 100)) : null
    const consumo = [pct !== null ? `ctx ${pct}%` : '', faixa.tokens > 0 ? tokensCurtos(faixa.tokens) : ''].filter(Boolean).join(' · ')

    return [consumo, faixa.tokens > 0 && faixa.usd !== null ? usdCurto(faixa.usd) : ''].filter(Boolean).join(' ')
  }

  const itemDoAgente = (faixa: Faixa): Item => {
    const nivel = nivelDe(faixa.tipoAgente)
    const rodando = faixa.fim === null
    const icone = rodando ? (faixa.aprovacao ? ICONE.aprovacao : ICONE.rodando) : ICONE[faixa.estado === 'ativa' ? 'rodando' : faixa.estado]
    const situacao = rodando ? (faixa.aprovacao ? 'aguardando aprovação' : ferramentaCurta(faixa.ferramenta || 'pensando')) : ESTADO_DA_FAIXA[faixa.estado]

    return {
      chave: faixa.id,
      desenho: desenhoDoTipo(faixa.tipoAgente),
      animado: rodando,
      variante: faixa.estado === 'falhou' ? 'falhou' : 'normal',
      titulo: faixa.titulo,
      icone,
      linha2: nivelEModelo(faixa.tipoAgente, faixa.modelo, faixa.esforco),
      esquerda: { texto: situacao, cor: faixa.aprovacao ? 'warning' : faixa.estado === 'falhou' ? 'error' : undefined },
      direita: numerosDe(faixa),
      tempo: { inicio: faixa.inicio, fim: faixa.fim },
      barra: rodando
        ? { tipo: 'indeterminada', cor: nivel.hex, corTerminal: nivel.cor }
        : faixa.estado === 'concluida'
          ? { tipo: 'fracao', fracao: 1, cor: nivel.hex, corTerminal: nivel.cor }
          : faixa.estado === 'falhou'
            ? { tipo: 'fracao', fracao: 1, cor: VERMELHO, corTerminal: 'error' }
            : { tipo: 'fracao', fracao: 0, cor: CINZA, corTerminal: 'inactive' },
      abrir: () => acoes.abrirAgente(faixa.id, faixa.titulo),
    }
  }

  const itemDoComando = (faixa: Faixa): Item => {
    const rodando = faixa.fim === null

    return {
      chave: faixa.id,
      desenho: 'terminal',
      animado: rodando,
      titulo: faixa.titulo,
      icone: rodando ? ICONE.comando : ICONE[faixa.estado === 'ativa' ? 'comando' : faixa.estado],
      linha2: (
        <Text dimColor wrap="truncate-end">
          {cortar(faixa.pasta ? `comando em background · ${cortar(faixa.pasta.split('/').filter(Boolean).at(-1) ?? faixa.pasta, 24)}` : 'comando em background', Math.max(10, larguraTexto))}
        </Text>
      ),
      esquerda: { texto: ESTADO_DA_FAIXA[faixa.estado], cor: faixa.estado === 'falhou' ? 'error' : undefined },
      tempo: { inicio: faixa.inicio, fim: faixa.fim },
      barra: rodando
        ? { tipo: 'indeterminada', cor: '#B8B3A8', corTerminal: 'subtle' }
        : { tipo: 'fracao', fracao: faixa.estado === 'parada' ? 0 : 1, cor: faixa.estado === 'falhou' ? VERMELHO : CINZA, corTerminal: faixa.estado === 'falhou' ? 'error' : 'inactive' },
    }
  }

  const itemDoPlanejado = (plano: Planejado): Item => ({
    chave: `plano:${plano.numero}`,
    desenho: desenhoDoTipo(plano.tipo),
    variante: 'planejado',
    titulo: `${plano.numero}. ${plano.titulo}`,
    icone: ICONE.planejado,
    linha2: nivelEModelo(plano.tipo, '', ''),
  })

  // A conversa principal, no formato de uma linha de agente com a prancheta no lugar do mascote.
  let tarefa: RenderElement[] = []
  if (barra) {
    const { feito, total, faltam } = contar(barra.passos)
    const ativo = barra.passos.find(passo => passo.estado === 'ativo')
    const atual = ativo ?? barra.passos.find(passo => passo.estado === 'falhou') ?? barra.passos.find(passo => passo.estado === 'aberto')
    const etapas: { nome: string; passos: Passo[] }[] = []
    for (const passo of barra.passos) {
      const ultima = etapas.at(-1)
      if (ultima && ultima.nome === passo.etapa) ultima.passos.push(passo)
      else etapas.push({ nome: passo.etapa, passos: [passo] })
    }
    const etapaAtual = etapas.findIndex(etapa => etapa.passos.includes(atual as Passo))
    const fim: Record<Barra['estado'], string> = {
      andamento: `faltam ${faltam}`,
      esperando: 'esperando você',
      erro: 'erro',
      concluido: 'concluído',
      parada: 'parada',
    }
    const passoTexto = barra.nota || atual?.titulo || 'Tudo feito'
    const item: Item = {
      chave: 'tarefa',
      desenho: 'tarefa',
      titulo: barra.titulo,
      icone: ICONE_DA_BARRA[barra.estado],
      linha2: (
        <Text>
          <Text color="claude">{(etapaAtual >= 0 ? etapas[etapaAtual]?.nome : '') || 'Conversa principal'}</Text>
          {etapas.length > 1 && etapaAtual >= 0 && <Text dimColor>{` · etapa ${etapaAtual + 1} de ${etapas.length}`}</Text>}
        </Text>
      ),
      esquerda: { texto: `${feito}/${total} · ${passoTexto}`, cor: barra.estado === 'esperando' ? 'warning' : barra.estado === 'erro' ? 'error' : undefined },
      direita: `${fim[barra.estado]} ·`,
      tempo: { inicio: barra.criadaEm, fim: barra.fechadaEm },
      barra: {
        tipo: 'fracao',
        fracao: total === 0 ? 0 : feito / total,
        cor: barra.estado === 'erro' ? VERMELHO : barra.estado === 'esperando' ? '#F2B53A' : LARANJA,
        corTerminal: barra.estado === 'erro' ? 'error' : barra.estado === 'esperando' ? 'warning' : 'claude',
        brilho: barra.estado === 'andamento',
      },
    }
    // O ícone do passo: no desktop um Svg de 16 px (o ativo vira alerta quando a barra espera o usuário); no terminal o glifo.
    const iconeDoPasso = (passo: Passo, chave: string) => {
      const jeito = PASSO[passo.estado]
      if (!Svg) return <Text color={jeito.cor} dimColor={jeito.cor === undefined}>{jeito.icone}</Text>
      const estado: EstadoDoPasso = passo.estado === 'ativo' && barra.estado === 'esperando' ? 'espera' : passo.estado
      return <Svg key={chave} source={svgDoPasso(estado)} alt={passo.estado} width={16} height={16} />
    }
    const passos = (
      <Box key="passos-lista" flexDirection="column">
        <Button key="passos" label={`${dados.passosAbertos ? '▾' : '▸'} Passos · ${total}`} plain dimColor onPress={() => acoes.alternarPassos()} />
        {dados.passosAbertos &&
          etapas.map((etapa, i) => (
            <Box key={`etapa:${i}`} flexDirection="column">
              {!!etapa.nome && <Text dimColor bold>{etapa.nome}</Text>}
              {etapa.passos.map((passo, j) => {
                const jeito = PASSO[passo.estado]
                return (
                  <Box key={`passo:${i}:${j}`} flexDirection="row" columnGap={1} alignItems="center">
                    {iconeDoPasso(passo, `pi:${i}:${j}`)}
                    <Text color={passo.estado === 'falhou' ? 'error' : undefined} dimColor={jeito.apagado} bold={passo.estado === 'ativo'}>
                      {cortar(passo.titulo, Math.max(10, larguraTexto - 2))}
                    </Text>
                  </Box>
                )
              })}
            </Box>
          ))}
      </Box>
    )
    tarefa = [
      linhaDoItem(item),
      // No desktop a lista de passos começa na coluna do texto: um vão da largura do mascote e o mesmo columnGap.
      Svg ? (
        <Box key="passos" flexDirection="row" columnGap={1}>
          <Svg key="passos-vao" source={`<svg xmlns="http://www.w3.org/2000/svg" width="${MASCOTE_CAIXA}" height="1"/>`} alt="espaço" width={MASCOTE_CAIXA} height={1} />
          {passos}
        </Box>
      ) : (
        <Box key="passos" flexDirection="column" paddingLeft={MASCOTE_COLUNAS}>
          {passos}
        </Box>
      ),
    ]
  }

  const recentes = (lista: Faixa[]) => [...lista].sort((a, b) => b.inicio - a.inicio)
  const todos = [...dados.agentes, ...dados.comandos]
  const comoItem = (faixa: Faixa) => (faixa.tipo === 'comando' ? itemDoComando(faixa) : itemDoAgente(faixa))
  const rodando = recentes(todos.filter(faixa => faixa.fim === null)).map(comoItem)
  const concluidos = recentes(todos.filter(faixa => faixa.fim !== null && faixa.estado === 'concluida')).map(comoItem)
  const falharam = recentes(todos.filter(faixa => faixa.fim !== null && (faixa.estado === 'falhou' || faixa.estado === 'parada'))).map(comoItem)
  const planejados = dados.planejados.map(itemDoPlanejado)
  const vazio = !barra && todos.length === 0 && planejados.length === 0

  // Cada grupo: o título e as linhas separadas por divisória; recolhido, só os títulos com a contagem.
  const grupo = (chave: string, titulo: RenderElement, itens: Item[], aberto = true) => [
    fio(`fio:${chave}`),
    titulo,
    ...(dados.recolhido || !aberto
      ? []
      : [...vao(`vao:${chave}`, VAO_CABECALHO), ...itens.flatMap((item, i) => [...(i > 0 ? [fio(`fio:${chave}:${i}`)] : []), linhaDoItem(item)])]),
  ]

  // No desktop cada cartão é um Svg (o canto arredondado só existe em Svg), um terço da largura menos o vão.
  const larguraCartao = Math.max(60, Math.floor((util - 16) / 3))
  const cartao = (chave: string, rotulo: string, valor: string) =>
    Svg ? (
      <Svg
        key={chave}
        source={chave === 'tempo' && barra ? svgDoCartaoTempo(rotulo, barra.criadaEm, barra.fechadaEm, larguraCartao, 64, agora) : svgDoCartao(rotulo, valor, larguraCartao, 64)} alt={`${rotulo}: ${valor}`} width={larguraCartao} height={64} />
    ) : (
      <Box key={chave} flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1} flexGrow={1}>
        <Text dimColor>{rotulo}</Text>
        <Text bold>{valor}</Text>
      </Box>
    )

  if (vazio) {
    return (
      <Box flexDirection="column" gap={1} paddingX={margem}>
        <Text key="vazio" dimColor>Nenhuma tarefa ainda. A barra de progresso aparece aqui quando o modelo cria uma.</Text>
        <Button key="fechar-painel" role="dismiss" label="Fechar" onPress={() => acoes.fechar()} />
      </Box>
    )
  }

  return (
    <Box flexDirection="column" gap={1} paddingX={margem}>
      {barra ? (
        <Text key="titulo" bold>{cortar(barra.titulo, Math.max(12, colunas - 2))}</Text>
      ) : (
        <Text key="titulo" dimColor>Nenhuma tarefa ainda. A barra de progresso aparece aqui quando o modelo cria uma.</Text>
      )}
      {barra && (
        <Box key="cartoes" flexDirection={colunas < 36 ? 'column' : 'row'} columnGap={1}>
          {cartao('custo', 'Custo', resumo?.usd !== null && resumo?.usd !== undefined ? usdCurto(resumo.usd) : '—')}
          {cartao('tokens', 'Tokens', resumo && resumo.tokens > 0 ? tokensCurtos(resumo.tokens) : '—')}
          {cartao('tempo', 'Tempo', relogio(resumo?.ms ?? 0))}
        </Box>
      )}
      <Button key="recolher" label={dados.recolhido ? 'Expandir' : 'Recolher'} plain dimColor onPress={() => acoes.alternarRecolhido()} />
      <Box key="lista" flexDirection="column">
        {!dados.recolhido && tarefa}
        {rodando.length > 0 && grupo('rodando', <Text key="g-rodando" dimColor>{`Rodando · ${rodando.length}`}</Text>, rodando)}
        {concluidos.length > 0 &&
          grupo(
          'concluidos',
          <Button key="concluidos" label={`${dados.concluidosAbertos ? '▾' : '▸'} Concluídos · ${concluidos.length}`} plain dimColor onPress={() => acoes.alternarConcluidos()} />,
          concluidos,
          dados.concluidosAbertos,
        )}
        {falharam.length > 0 && grupo('falharam', <Text key="g-falharam" color="error">{`Falharam · ${falharam.length}`}</Text>, falharam)}
        {planejados.length > 0 && grupo('planejados', <Text key="g-planejados" dimColor>{`Planejados · ${planejados.length}`}</Text>, planejados)}
        {fio('fio:fim')}
      </Box>
      <Button key="fechar-painel" role="dismiss" label="Fechar" onPress={() => acoes.fechar()} />
    </Box>
  )
}
