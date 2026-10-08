/** Finais: concluido, erro e parada. Uma atualização qualquer reabre a barra em andamento. */
export type Estado = 'andamento' | 'esperando' | 'erro' | 'concluido' | 'parada'

export type Passo = {
  titulo: string
  etapa: string
  /** pulado: estava aberto quando a barra foi concluída à mão. */
  estado: 'aberto' | 'ativo' | 'feito' | 'falhou' | 'pulado'
}

export type Barra = {
  id: string
  titulo: string
  passos: Passo[]
  estado: Estado
  nota: string
  criadaEm: number
  fechadaEm: number | null
  /** O agente que criou a barra; null no loop principal. */
  dono: string | null
  /** turnId do último turno da conversa principal em que a barra mudou ('' antes do primeiro). */
  turno: string
  atualizadaEm: number
  /** Fim de turno com trabalho em background rodando: a barra espera por ele em andamento. */
  bg: boolean
}

export type Faixa = {
  /** agentId do subagente ou id da tarefa em background. */
  id: string
  /** A barra em que a faixa se pendurou; null fica no grupo automático. */
  barra: string | null
  tipo: 'agente' | 'comando'
  titulo: string
  modelo: string
  esforco: string
  ferramenta: string
  /** Quando o nome em `ferramenta` entrou: o seguinte espera 1 s desde aí. */
  trocaEm: number
  /** tool_use_id da chamada em curso (agente) ou da que abriu a tarefa (comando). */
  chamada: string
  aprovacao: boolean
  estado: 'ativa' | 'concluida' | 'falhou' | 'parada'
  inicio: number
  fim: number | null
  /** O loop que despachou: null na conversa principal, o agentId do pai num subagente. */
  dono: string | null
  /** subagentType do despacho ('' em comando). */
  tipoAgente: string
  /** turnId do turno principal em que a faixa nasceu. */
  turno: string
  /** Id do modelo que respondeu por último, como a API informa. */
  modeloId: string
  /** Contexto do último passo (entrada, cache lido e cache escrito) mais a saída dele. */
  tokens: number
  /** Contexto do último passo, sem a saída. */
  ctx: number
  /** Janela de contexto do modelo; 0 quando desconhecida. */
  janela: number
  /** Custo estimado em US$; null quando algum passo veio de um modelo sem preço conhecido. */
  usd: number | null
  /** Passos contados no turno em curso do agente. */
  passosTurno: number
  /** Pasta do "cd <pasta> &&" tirado do rótulo do comando; ausente no agente e nas faixas antigas. */
  pasta?: string
  /** O command inteiro (até 1000 caracteres) do comando em background, para casar com `background_tasks` no Stop. */
  comando?: string
}

/** Uma linha da conversa de um agente no painel lateral. */
export type Fala = {
  /** agente: o que ele escreveu; entrada: o que ele recebeu; voce: o que o usuário mandou pelo painel; ferramenta: uma chamada dele. */
  quem: 'agente' | 'entrada' | 'voce' | 'ferramenta'
  texto: string
}

export type Painel = {
  /** agentId do agente aberto no painel; null mostra a visão geral. */
  agente: string | null
  titulo: string
  /** Cauda da conversa, no máximo 200 linhas. */
  falas: Fala[]
  /** Carga em curso ou o motivo de a conversa não poder ser lida. */
  aviso: string
}

/** O painel "Progresso" na sessão: se está aberto, se o usuário o fechou e se já abriu sozinho. */
export type Janela = {
  aberto: boolean
  fechadoPeloUsuario: boolean
  abriuSozinho: boolean
  /** O grupo "Concluídos" dos agentes aberto. */
  concluidos: boolean
  /** O Recolher do painel: só os títulos dos grupos. */
  recolhido: boolean
  /** A lista "Passos" da tarefa principal aberta. */
  passosAbertos: boolean
}

declare module 'claude-code' {
  interface PluginState {
    progresso: {
      barras: Barra[]
      faixas: Faixa[]
      oculto: boolean
      painel: Painel
      janela: Janela
      /** turnId do turno da conversa principal em curso. */
      turno: string
      /** A sessão a que o estado pertence: outra (ou vazia) pede a restauração do store. */
      sessao: string
    }
  }
}
