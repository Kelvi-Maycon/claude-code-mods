const VERBO =
  /\b(?:cria|crie|criar|faz|faca|fazer|refaz|refaca|recria|monta|monte|constroi|construa|desenha|redesenha|melhora|melhore)\b/

const ALVO =
  /\b(?:relatorio visual|(?:pagina|landing|lp|site|html|dashboard|painel|visualizacao|slide|deck|layout|tela|hero|componente|blog|video|motion|ui|interface)s?|paineis|visualizacoes)\b/

// O pedido já cita um design system, dispensa skill ou nomeia a identidade de outra marca.
const FORA =
  /design system|identidade visual|\bsem ds\b|nao use skill|\b(?:design|identidade|marca) d[ao] /

// Caminho de arquivo com duas partes ou mais, entre aspas ou solto: uma pasta
// com o nome do DS no meio de um caminho não é o usuário citando o DS. A skill
// citada como /nome-da-skill tem uma parte só e fica.
const CAMINHO = /(['"])~?\/[^'"]*\/[^'"]*\1|(?:^|\s)~?\/[^\s/]+\/\S*/g

/** Minúsculas, sem acento: a forma em que o texto e os termos são comparados. */
export function normaliza(texto: string): string {
  return texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/**
 * Diz se o texto pede uma peça visual sem definir a identidade. `termos` são
 * os nomes que, citados no pedido, dispensam a linha: a skill, o rótulo e os
 * termos extras da configuração.
 */
export function pedeDs(texto: string, termos: readonly string[] = []): boolean {
  const t = normaliza(texto).replace(CAMINHO, ' ')
  const citaTermo = termos.some(termo => {
    const n = normaliza(termo).trim()

    return n !== '' && t.includes(n)
  })

  return VERBO.test(t) && ALVO.test(t) && !FORA.test(t) && !citaTermo
}
