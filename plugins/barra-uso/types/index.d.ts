export type Limite = {
  /** Percentual usado da janela, de 0 a 100. */
  usado: number
  /** Quando a janela zera, em ms desde a época; null se a API não informou. */
  zeraEm: number | null
}

export type Contexto = {
  /** Tokens de entrada da última resposta; null antes de a sessão ter uma. */
  tokens: number | null
  /** Tokens em que a compactação automática roda; sem ela, a janela do modelo. */
  limite: number
}

export type Cache = {
  /** Fim do último turno da conversa principal, em ms; 0 se o primeiro ainda roda. */
  fim: number
  /** Parte da entrada do último turno principal lida do cache, de 0 a 100; null sem dado. */
  hit: number | null
  rodando: boolean
}

export type Uso = {
  cincoHoras: Limite | null
  seteDias: Limite | null
  ctx: Contexto | null
  /** null enquanto este mod não viu turno nesta carga. */
  cache: Cache | null
  /** Instante do cálculo, em ms desde a época; 0 antes do primeiro. */
  agora: number
}

declare module 'claude-code' {
  interface PluginState {
    'barra-uso': { uso: Uso; visivel: boolean }
  }
}
