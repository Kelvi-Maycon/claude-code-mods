// O painel lateral "Anotações": um resumo com recolher/expandir tudo, o "+ Nova anotação" que abre o formulário, as
// anotações por grupo (cada grupo um cabeçalho que recolhe) e, separada em âmbar, a seção de pendências, que também
// recolhe. As ações de um item (copiar, editar, apagar) ficam atrás do "⋯" dele. O título do pane já vem do app, com o
// X de fechar: o painel não repete nenhum dos dois.
// Nenhuma medida aqui depende da largura do pane: fios e respiros são Svg sem `width`, que esticam no Box em coluna.
import type { Elements, RenderElement, RenderSurface } from 'claude-code'

import type { Anotacao, JanelaAnotacoes, Pendencia } from '../types'
import { NOTAS_MAX, NOTAS_MIN, NOTAS_PASSO, ehUrl, gruposDe, linhasDe, rowsDasNotas, urlCurta } from './anotacoes'
import { cortar } from './modelo'
import { ehAprovacao, svgDoFioDaSecao, svgDoIconeDaPendencia, svgDoRespiro } from './svg'

type Elementos = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button' | 'Input' | 'Link'> & { Svg?: Elements['desktop']['Svg'] }

export type Campo = 'titulo' | 'valor' | 'grupo'
/** A ordem dos campos: o Enter num campo leva ao seguinte, e no último salva. */
export const CAMPOS: Campo[] = ['titulo', 'valor', 'grupo']
const DICA: Record<Campo, string> = { titulo: 'Título', valor: 'Valor ou URL', grupo: 'Grupo (opcional)' }

export type AcoesDasAnotacoes = {
  abrirFormulario: () => unknown
  cancelarFormulario: () => unknown
  mudarNovo: (campo: Campo, valor: string) => unknown
  adicionar: (campo?: Campo, valor?: string) => unknown
  /** Leva o foco a um campo do painel, pela key ("novo:valor"). */
  focar: (chave: string) => unknown
  alternarGrupo: (grupo: string) => unknown
  alternarPendencias: () => unknown
  /** Recolhe (true) ou expande (false) todos os grupos e as pendências. */
  recolherTudo: (recolher: boolean, grupos: string[]) => unknown
  alternarMenu: (item: Anotacao) => unknown
  copiar: (item: Anotacao, surface: RenderSurface) => unknown
  editar: (item: Anotacao) => unknown
  mudarEdicao: (campo: Campo, valor: string) => unknown
  salvarEdicao: (campo?: Campo, valor?: string) => unknown
  cancelarEdicao: () => unknown
  apagar: (item: Anotacao) => unknown
  confirmarApagar: (item: Anotacao) => unknown
  cancelarApagar: () => unknown
  resolver: (item: Pendencia) => unknown
  alternarNotas: () => unknown
  /** Soma (positivo) ou tira linhas da altura das notas livres. */
  mudarAlturaDasNotas: (passo: number) => unknown
  /** Cada mudança do texto das notas livres, e o Enter: grava sem limpar. */
  mudarNotas: (texto: string) => unknown
}

export type DadosDasAnotacoes = {
  colunas: number
  anotacoes: Anotacao[]
  pendencias: Pendencia[]
  janela: JanelaAnotacoes
  /** O texto das notas livres da conversa. */
  notasLivres: string
}

// O recuo dos itens sob o cabeçalho do grupo, em colunas: o título do item começa onde começa o nome do grupo, depois
// do chevron. É também a calha de 24 px do ícone das pendências (3 colunas de 7,7 a 8,5 px).
const RECUO = 3
// Respiros verticais do desktop, em px (Svg): entre itens, sob o cabeçalho do grupo, entre grupos e antes das seções.
const ENTRE_ITENS = 10
const SOB_CABECALHO = 6
const ENTRE_GRUPOS = 16
const FIO_SECAO = 25
// A linha do ícone da pendência, da altura de uma linha de texto: o ícone fica no meio do título.
const ALT_LINHA = 20
// O ícone da pendência a 2 px da borda, sob o chevron do cabeçalho; os 6 px que sobram na calha separam do título.
const ICONE_X = 2

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`
const mesmoGrupo = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

export function desenharAnotacoes(els: Elementos, dados: DadosDasAnotacoes, acoes: AcoesDasAnotacoes): RenderElement {
  const { Box, Text, Button, Input, Link, Svg } = els
  const { colunas, anotacoes, pendencias, janela, notasLivres } = dados
  const largura = Math.max(16, colunas - RECUO - 2)

  // Respiro vertical: Svg transparente no desktop; no terminal só o vão entre grupos e seções vira uma linha.
  const vao = (chave: string, altura: number) =>
    Svg ? <Svg key={chave} source={svgDoRespiro(altura)} alt="espaço" height={altura} /> : altura >= ENTRE_GRUPOS && <Text key={chave}> </Text>

  const fio = (chave: string, tom: 'line' | 'warn') =>
    Svg ? (
      <Svg key={chave} source={svgDoFioDaSecao(FIO_SECAO, tom)} alt="divisória" height={FIO_SECAO} />
    ) : (
      <Text key={chave} color={tom === 'warn' ? 'warning' : undefined} dimColor={tom === 'line'}>
        {(tom === 'warn' ? '╌' : '─').repeat(Math.max(8, colunas - 2))}
      </Text>
    )

  // Ação de texto discreta: apagada, acende no hover.
  const acao = (chave: string, rotulo: string, onPress: () => unknown) => (
    <Button key={chave} label={rotulo} plain dimColor hover={{ dimColor: false }} onPress={() => void onPress()} />
  )

  // Cabeçalho que recolhe: chevron e nome num Button (o app desenha o label dele num peso e numa cor só), a contagem
  // fora, num Text apagado: a diferença de tom é a hierarquia que sobra no app.
  const cabecalho = (chave: string, aberto: boolean, nome: string, n: number, onPress: () => unknown) => (
    <Box key={chave} flexDirection="row" alignItems="center">
      <Button key={`${chave}:alternar`} label={`${aberto ? '⏷' : '⏵'} ${nome}`} plain onPress={() => void onPress()} />
      <Text key={`${chave}:n`} dimColor>{String(n)}</Text>
    </Box>
  )

  // Os campos numa coluna, todos da mesma largura. Enter num campo leva ao seguinte; no último, envia.
  const campos = (prefixo: 'novo' | 'editar', valores: JanelaAnotacoes['novo'], mudar: (campo: Campo, valor: string) => unknown, enviar: (campo: Campo, valor: string) => unknown) =>
    CAMPOS.map((campo, i) => {
      const seguinte = CAMPOS[i + 1]

      return (
        <Input
          key={`${prefixo}:${campo}`}
          placeholder={DICA[campo]}
          value={valores[campo]}
          submitLabel={seguinte ? 'próximo' : 'salvar'}
          {...(i === 0 ? { autoFocus: true as const } : {})}
          onInput={valor => void mudar(campo, valor)}
          onSubmit={valor => {
            if (!seguinte) return void enviar(campo, valor)
            void Promise.resolve(mudar(campo, valor)).then(() => acoes.focar(`${prefixo}:${seguinte}`))
          }}
        />
      )
    })

  const formulario = (prefixo: 'novo' | 'editar', valores: JanelaAnotacoes['novo'], mudar: (campo: Campo, valor: string) => unknown, enviar: (campo: Campo, valor: string) => unknown, salvar: () => unknown, cancelar: () => unknown) => (
    <Box key={prefixo} flexDirection="column" rowGap="xs">
      {campos(prefixo, valores, mudar, enviar)}
      <Box key={`${prefixo}:acoes`} flexDirection="row" columnGap={1} alignItems="center">
        <Button key={prefixo === 'novo' ? 'novo:adicionar' : 'editar:salvar'} variant="primary" label="Salvar" onPress={() => void salvar()} />
        {acao(`${prefixo}:cancelar`, 'Cancelar', cancelar)}
      </Box>
    </Box>
  )

  const valorDe = (item: Anotacao, i: number) => {
    if (!item.valor) return false
    if (ehUrl(item.valor)) {
      return (
        <Box key={`nota:${i}:valor`} flexDirection="row" overflow="hidden">
          <Link key={`nota:${i}:link`} href={item.valor.trim()} label={cortar(urlCurta(item.valor), largura)} />
        </Box>
      )
    }

    return (
      <Text key={`nota:${i}:valor`} dimColor wrap="wrap">
        {item.valor}
      </Text>
    )
  }

  // As ações do item, abertas pelo "⋯": logo abaixo do conteúdo, no mesmo recuo. Apagar troca a linha pela confirmação.
  const acoesDoItem = (item: Anotacao, i: number) =>
    janela.apagando === item.titulo ? (
      <Box key={`nota:${i}:acoes`} flexDirection="row" alignItems="center" columnGap={1}>
        <Text key={`nota:${i}:pergunta`} color="error">Apagar?</Text>
        <Button key={`nota:${i}:sim`} label="Apagar" onPress={() => void acoes.confirmarApagar(item)} />
        {acao(`nota:${i}:nao`, 'Cancelar', acoes.cancelarApagar)}
      </Box>
    ) : (
      <Box key={`nota:${i}:acoes`} flexDirection="row" alignItems="center" columnGap={1}>
        <Button key={`nota:${i}:copiar`} label="Copiar" plain dimColor hover={{ dimColor: false }} onPress={press => void acoes.copiar(item, press.surface)} />
        {acao(`nota:${i}:editar`, 'Editar', () => acoes.editar(item))}
        {acao(`nota:${i}:apagar`, 'Apagar', () => acoes.apagar(item))}
      </Box>
    )

  const linhaDaNota = (item: Anotacao, i: number) => {
    if (janela.editando === item.titulo) {
      return (
        <Box key={`nota:${i}`} flexDirection="column" paddingLeft={RECUO}>
          {formulario('editar', janela.edicao, acoes.mudarEdicao, acoes.salvarEdicao, () => acoes.salvarEdicao(), acoes.cancelarEdicao)}
        </Box>
      )
    }
    const comMenu = janela.menu === item.titulo || janela.apagando === item.titulo

    return (
      <Box key={`nota:${i}`} flexDirection="column" paddingLeft={RECUO}>
        <Box key={`nota:${i}:topo`} flexDirection="row" alignItems="center" columnGap={1}>
          <Box key={`nota:${i}:titulo`} flexGrow={1} flexShrink={1} overflow="hidden">
            <Text wrap="truncate-end">{item.titulo}</Text>
          </Box>
          <Button key={`nota:${i}:mais`} label="⋯" plain dimColor={!comMenu} hover={{ dimColor: false }} onPress={() => void acoes.alternarMenu(item)} />
        </Box>
        {valorDe(item, i)}
        {comMenu && acoesDoItem(item, i)}
      </Box>
    )
  }

  const grupos = gruposDe(anotacoes)
  // Anotação sem grupo só ganha cabeçalho ("Sem grupo") quando há outros grupos; sozinha, a lista vai sem cabeçalho.
  const comCabecalho = grupos.some(g => g.grupo)
  const recolhido = (grupo: string) => janela.recolhidos.some(outro => mesmoGrupo(outro, grupo))
  const nomesRecolhiveis = comCabecalho ? grupos.map(g => g.grupo) : []
  // As notas livres contam sempre: a seção existe mesmo vazia.
  const recolhiveis = 1 + nomesRecolhiveis.length + (pendencias.length > 0 ? 1 : 0)
  const tudoRecolhido =
    janela.notasRecolhidas && nomesRecolhiveis.every(recolhido) && (pendencias.length === 0 || janela.pendenciasRecolhidas)

  const notas: (RenderElement | false)[] = grupos.flatMap((g, gi) => {
    const aberto = !comCabecalho || !recolhido(g.grupo)

    return [
      ...(gi > 0 ? [vao(`vao:grupo:${gi}`, ENTRE_GRUPOS)] : []),
      ...(comCabecalho
        ? [cabecalho(`grupo:${gi}`, aberto, g.grupo || 'Sem grupo', g.itens.length, () => acoes.alternarGrupo(g.grupo)), ...(aberto ? [vao(`vao:topo:${gi}`, SOB_CABECALHO)] : [])]
        : []),
      ...(aberto ? g.itens.flatMap(({ item, indice }, j) => [...(j > 0 ? [vao(`vao:nota:${indice}`, ENTRE_ITENS)] : []), linhaDaNota(item, indice)]) : []),
    ]
  })

  const linhaDaPendencia = (item: Pendencia, i: number) => {
    const aprovacao = ehAprovacao(item.quem)

    return (
      <Box key={`pend:${i}`} flexDirection="row" alignItems="flex-start" columnGap={Svg ? 0 : 1}>
        {Svg ? (
          <Svg key={`pend:${i}:icone`} source={svgDoIconeDaPendencia(item.icone, ALT_LINHA, ICONE_X)} alt={`ícone ${item.icone}`} width={24} height={ALT_LINHA} />
        ) : (
          <Text dimColor>{i === pendencias.length - 1 ? '└' : '├'}</Text>
        )}
        <Box key={`pend:${i}:corpo`} flexDirection="column" flexGrow={1} flexShrink={1} {...(Svg ? { width: 0 } : {})}>
          <Text wrap="wrap">{item.titulo}</Text>
          <Box key={`pend:${i}:linha`} flexDirection="row" alignItems="center" columnGap={1}>
            {item.quem && (
              <Text key={`pend:${i}:quem`} color={aprovacao ? 'warning' : undefined} dimColor={!aprovacao}>
                {item.quem}
              </Text>
            )}
            {acao(`pend:${i}:resolver`, 'Resolver', () => acoes.resolver(item))}
          </Box>
        </Box>
      </Box>
    )
  }

  // Notas livres: cabeçalho com o ícone, o nome e quantas linhas tem; aberto, o campo de várias linhas e o menor/maior.
  const notasAbertas = !janela.notasRecolhidas
  const linhasLivres = linhasDe(notasLivres)
  const secaoDasNotas = (
    <Box key="secao:notas" flexDirection="column">
      <Box key="notas:topo" flexDirection="row" alignItems="center" columnGap={Svg ? 0 : 1}>
        {Svg ? (
          <Svg key="notas:icone" source={svgDoIconeDaPendencia('nota', ALT_LINHA, ICONE_X)} alt="notas livres" width={24} height={ALT_LINHA} />
        ) : (
          <Text dimColor>▤</Text>
        )}
        <Button key="notas:alternar" label="Notas livres" plain onPress={() => void acoes.alternarNotas()} />
        <Box key="notas:info" flexGrow={1} flexShrink={1} overflow="hidden">
          {linhasLivres > 0 && <Text dimColor wrap="truncate-end">{plural(linhasLivres, 'linha', 'linhas')}</Text>}
        </Box>
        {notasAbertas && janela.notasAltura > NOTAS_MIN && acao('notas:menor', 'Menor', () => acoes.mudarAlturaDasNotas(-NOTAS_PASSO))}
        {notasAbertas && janela.notasAltura < NOTAS_MAX && acao('notas:maior', 'Maior', () => acoes.mudarAlturaDasNotas(NOTAS_PASSO))}
        <Button key="notas:seta" label={notasAbertas ? '⏷' : '⏵'} plain dimColor hover={{ dimColor: false }} onPress={() => void acoes.alternarNotas()} />
      </Box>
      {notasAbertas && vao('vao:notas', SOB_CABECALHO)}
      {notasAbertas && (
        <Input
          key="notas:texto"
          placeholder="O que você está fazendo nesta conversa, o que falta, o que não pode esquecer"
          value={notasLivres}
          rows={rowsDasNotas(janela.notasAltura, notasLivres)}
          submitLabel="salvar"
          onInput={texto => void acoes.mudarNotas(texto)}
          onSubmit={texto => void acoes.mudarNotas(texto)}
        />
      )}
    </Box>
  )

  const resumo = [plural(anotacoes.length, 'anotação', 'anotações'), ...(pendencias.length > 0 ? [plural(pendencias.length, 'pendência', 'pendências')] : [])].join(' · ')
  const pendAbertas = !janela.pendenciasRecolhidas

  return (
    <Box flexDirection="column" paddingX={Svg ? 1 : 0}>
      <Box key="topo" flexDirection="row" alignItems="center" columnGap={1}>
        <Box key="topo:resumo" flexGrow={1} flexShrink={1} overflow="hidden">
          <Text dimColor wrap="truncate-end">{resumo}</Text>
        </Box>
        {recolhiveis > 0 && acao('recolher-tudo', tudoRecolhido ? 'Expandir tudo' : 'Recolher tudo', () => acoes.recolherTudo(!tudoRecolhido, nomesRecolhiveis))}
      </Box>
      {vao('vao:topo', 8)}
      {secaoDasNotas}
      {vao('vao:notas:fim', ENTRE_GRUPOS)}
      <Box key="secao:anotacoes" flexDirection="column">
        {janela.formulario ? (
          formulario('novo', janela.novo, acoes.mudarNovo, acoes.adicionar, () => acoes.adicionar(), acoes.cancelarFormulario)
        ) : (
          <Box key="novo:abrir-linha" flexDirection="row">
            <Button key="novo:abrir" label="+ Nova anotação" onPress={() => void acoes.abrirFormulario()} />
          </Box>
        )}
        {fio('fio:anotacoes', 'line')}
        {anotacoes.length === 0 ? (
          <Text key="anotacoes:vazio" dimColor wrap="wrap">
            Nada anotado nesta conversa. URLs publicadas, IDs e decisões que o Claude guardar aparecem aqui.
          </Text>
        ) : (
          <Box key="anotacoes:lista" flexDirection="column">
            {notas}
          </Box>
        )}
      </Box>
      <Box key="secao:pendencias" flexDirection="column">
        {fio('fio:pendencias', 'warn')}
        {pendencias.length === 0 ? (
          <Text key="pendencias:vazio" dimColor>Nenhuma pendência nesta conversa.</Text>
        ) : (
          [
            cabecalho('pendencias:topo', pendAbertas, 'Pendências', pendencias.length, acoes.alternarPendencias),
            ...(pendAbertas
              ? [vao('vao:pend:topo', SOB_CABECALHO), ...pendencias.flatMap((item, i) => [...(i > 0 ? [vao(`vao:pend:${i}`, ENTRE_ITENS)] : []), linhaDaPendencia(item, i)])]
              : []),
          ]
        )}
      </Box>
    </Box>
  )
}
