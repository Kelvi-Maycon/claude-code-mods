export type Sessao = {
  /** Fim do último turno da conversa principal, em ms; 0 antes do primeiro. */
  fim: number
  /** Tokens de entrada da última requisição principal; 0 quando desconhecido. */
  ctx: number
  /** Parte da entrada do último turno principal lida do cache, de 0 a 100; null sem dado. */
  hit: number | null
  rodando: boolean
  /** Quando o envio frio foi segurado, em ms; 0 se ainda não foi. */
  avisadoEm: number
  /** O período frio atual já foi avisado e liberado. */
  liberado: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'cache-frio': {
      sessao: Sessao
    }
  }
}
