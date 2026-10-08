export type Servidor = {
  /** Pasta servida, caminho absoluto resolvido. */
  raiz: string
  /** Porta em 127.0.0.1; 0 enquanto o servidor ainda não foi levantado. */
  porta: number
  /** Último arquivo editado, relativo à raiz; vazio quando a pasta foi ligada sem arquivo. */
  arquivo: string
}

declare module 'claude-code' {
  interface PluginState {
    /** Servidores desta sessão, do mais recente para o mais antigo. */
    previa: { servidores: Servidor[] }
  }
}
