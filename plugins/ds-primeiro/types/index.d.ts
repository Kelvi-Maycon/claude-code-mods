declare module 'claude-code' {
  interface PluginState {
    'ds-primeiro': {
      /** A linha do DS já entrou nesta sessão. */
      anexado: boolean
      /** `/ds on` ou `/ds off` nesta sessão; null segue o padrão guardado. */
      ligado: boolean | null
      /** "Tirar deste envio" foi pressionado para o rascunho atual. */
      pular: boolean
      /** O rascunho no campo casa a detecção. */
      rascunho: boolean
      /** Ligado nesta sessão (`/ds on|off`, ou o padrão de `/ds sempre`); a `barra-uso` lê. */
      ativo: boolean
    }
  }
}
