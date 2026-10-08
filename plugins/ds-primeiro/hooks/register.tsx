import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { pedeDs } from './detecta'

const anexado = atom({ plugin: 'ds-primeiro', key: 'anexado' } as const, false)
const ligado = atom({ plugin: 'ds-primeiro', key: 'ligado' } as const, null)
const pular = atom({ plugin: 'ds-primeiro', key: 'pular' } as const, false)
const rascunho = atom({ plugin: 'ds-primeiro', key: 'rascunho' } as const, false)
// O estado efetivo (`ligado ?? padrao`), publicado para outros mods lerem: `padrao` vive só neste módulo.
const publicado = atom({ plugin: 'ds-primeiro', key: 'ativo' } as const, true)

const USO = 'Use /ds, /ds on, /ds off, /ds sempre on ou /ds sempre off.'

// Padrão guardado no store (`/ds sempre`) e o último resultado da detecção no
// rascunho, para só gravar estado quando ele muda.
let padrao = true
let casa = false

async function ativo($: EngineInterface) {
  return (await read($, ligado)) ?? padrao
}

async function publica($: EngineInterface) {
  const agora = await ativo($)
  await update($, publicado, () => agora)
}

const texto = (valor: unknown) => (typeof valor === 'string' ? valor.trim() : '')

export const register: Register = (on, options) => {
  // Sem a skill do design system configurada o mod não faz nada: não anexa,
  // não registra /ds, não desenha faixa e não publica `ativo` (a barra-uso
  // esconde a pílula DS).
  const skill = texto(options.skill)

  if (skill === '') {
    return
  }

  const rotulo = texto(options.rotulo) || skill
  const termos = [skill, rotulo, ...texto(options.ignorar).split(',')]
  const linha = `ds-primeiro: em peça visual o usuário usa por padrão o design system ${rotulo}. Carregue a skill ${skill} antes de criar, a menos que o pedido defina outra identidade. Se o pedido não for visual, ignore esta linha.`

  on('session.start', async ($, e, next) => {
    padrao = (await $.store.get('sempre')) !== false
    await $.command.register({
      name: 'ds',
      description: `${rotulo} anexado ao primeiro pedido visual da sessão`,
      argumentHint: '[on | off | sempre on | sempre off]',
    })
    await publica($)

    return next(e)
  })

  on('command.run', { command: 'ds' }, async ($, e) => {
    const args = e.args.trim().toLowerCase().split(/\s+/).join(' ')

    if (args === 'on' || args === 'off' || args === 'sempre on' || args === 'sempre off') {
      const liga = args.endsWith('on')

      if (args.startsWith('sempre')) {
        padrao = liga
        await $.store.set('sempre', liga)
      }

      await update($, ligado, () => liga)
      await publica($)

      if (liga) {
        await update($, anexado, () => false)
      }
    } else if (args !== '') {
      return { text: USO }
    }

    const sessao = (await ativo($)) ? 'ligado nesta sessão' : 'desligado nesta sessão'
    const linha = (await read($, anexado)) ? 'DS já anexado (/ds on anexa de novo)' : 'DS ainda não anexado'

    return { text: `${sessao} · ${linha} · padrão ${padrao ? 'ligado' : 'desligado'}` }
  })

  on('prompt.edit', async ($, e, next) => {
    const campo = await next(e)
    const casaAgora = pedeDs(campo.text, termos)

    if (casaAgora !== casa) {
      casa = casaAgora
      await update($, rascunho, () => casaAgora)
    }

    return campo
  })

  // O Enter do usuário: `composer` no terminal, `sdk` no app desktop.
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind !== 'composer' && e.origin.kind !== 'sdk') {
      return next(e)
    }

    const pulou = await read($, pular)
    const anexa = !pulou && pedeDs(e.text, termos) && (await ativo($)) && !(await read($, anexado))
    const entrou = await next(anexa ? { ...e, context: [...(e.context ?? []), linha] } : e)

    // Um envio segurado por outro hook volta ao campo: nada muda até ele entrar.
    if (entrou.drop !== undefined) {
      return entrou
    }

    if (anexa) {
      await update($, anexado, () => true)
      $.ui.toast(`DS ${rotulo} anexado a este pedido · /ds off desliga`)
    }

    if (pulou) {
      await update($, pular, () => false)
    }

    if (casa) {
      casa = false
      await update($, rascunho, () => false)
    }

    return entrou
  })

  // O DS carregado sai do contexto na compactação: rearma.
  on('session.compact', async ($, e, next) => {
    const feito = await next(e)

    if (e.agentId === undefined && e.trigger !== 'precompute' && feito.skip === undefined) {
      await update($, anexado, () => false)
    }

    return feito
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') {
      casa = false
      await update($, anexado, () => false)
      await update($, ligado, () => null)
      await update($, pular, () => false)
      await update($, rascunho, () => false)
      await publica($)
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const mostra =
      !e.props.hasSurvey &&
      (await read($, rascunho)) &&
      !(await read($, anexado)) &&
      !(await read($, pular)) &&
      (await ativo($))

    const abaixo = await next(e)

    if (!mostra) {
      return abaixo
    }

    const { Box, Button, Text } = $.ui.resolve(e)

    // Empilha sobre as faixas dos outros mods; a deste fica junto do campo.
    return (
      <Box flexDirection="column">
        {abaixo}
        <Box>
          <Text dimColor>{`DS ${rotulo} será anexado a este pedido `}</Text>
          <Button key="tirar" label="Tirar deste envio" onPress={() => update($, pular, () => true)} />
        </Box>
      </Box>
    )
  })
}
