import { expect, mock, test } from 'claude-code/testing'

const BANT = {
  plugin: 'token-analizi',
  component: 'AbovePrompt',
  requestId: 'bant',
  props: {
    bodyColumns: 160,
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 3,
    scroll: { offset: 0, bodyRows: 1 },
    view: {},
  },
} as const

const PANEL = {
  plugin: 'token-analizi',
  component: 'Pane',
  requestId: 'token-analizi',
  props: {
    title: 'Token analizi',
    isFocused: true,
    bodyColumns: 90,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

function kullanim(giris: number, okunan: number, yazilan: number, cikti: number) {
  return {
    model: 'claude-opus-5-5',
    input_tokens: giris,
    cache_read_input_tokens: okunan,
    cache_creation_input_tokens: yazilan,
    output_tokens: cikti,
  }
}

test('gerçek usage, MCP çıktısı ve /context dökümünden analiz üretir', async ($, on) => {
  const saat = mock.clock(on, { now: 1_800_000_000_000 })
  mock.store(on)
  on('session.id', () => ({ value: 'oturum-1' }))
  on('command.register', () => ({ value: { command: 'tokenlar' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.list', () => ({
    value: [{ id: 'ag1', type: 'Explore', description: 'ara', status: 'running' }],
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: { ok: true } }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      rateLimits: [],
      cost: { usd: 1.23 },
      context: {
        tokens: 60_000,
        window: 1_000_000,
        percent: 6,
        breakdown: {
          categories: [
            { name: 'System prompt', tokens: 8000, color: 'x', isDeferred: false, kind: 'used' },
            { name: 'System tools', tokens: 12000, color: 'x', isDeferred: false, kind: 'used' },
            { name: 'MCP tools', tokens: 6000, color: 'x', isDeferred: false, kind: 'used' },
            { name: 'Skills', tokens: 2000, color: 'x', isDeferred: false, kind: 'used' },
            { name: 'Messages', tokens: 30000, color: 'x', isDeferred: false, kind: 'used' },
            { name: 'Free space', tokens: 900000, color: 'x', isDeferred: false, kind: 'free' },
          ],
          totalTokens: 58000,
          maxTokens: 1_000_000,
          rawMaxTokens: 1_000_000,
          autocompactSource: 'model-default',
          percentage: 6,
          gridRows: [],
          model: 'claude-opus-5-5',
          memoryFiles: [],
          mcpTools: [
            { name: 'mcp__dosya__oku', serverName: 'dosya', tokens: 1000, isLoaded: true },
            { name: 'mcp__veritabani__sorgu', serverName: 'veritabani', tokens: 5000, isLoaded: true },
          ],
          agents: [],
          skills: {
            totalSkills: 2,
            includedSkills: 2,
            tokens: 2000,
            skillFrontmatter: [
              { name: 'frontend-design', source: 'plugin', tokens: 1500 },
              { name: 'kisa', source: 'plugin', tokens: 500 },
            ],
          },
          isAutoCompactEnabled: true,
          apiUsage: null,
        },
      },
    },
  }))
  on('turn.step', async function* (_, e) {
    const u = e.agentId ? kullanim(5, 20_000, 2_000, 800) : kullanim(10, 50_000, 8_000, 1_200)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: u }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await saat.advance(3000)

  // Ana konuşmada üç istek; MCP "dosya" aracı büyük bir çıktı döndürüyor.
  for (let i = 0; i < 3; i++) {
    await $.tool.call({ tool: 'mcp__dosya__oku', tool_use_id: `t${i}`, yol: '/a' })
    await $.session.append({
      message: {
        type: 'user',
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: `t${i}`, content: 'x'.repeat(60_000) }],
      },
      door: 'tool-result',
      origin: { kind: 'tool', tool: 'mcp__dosya__oku' },
      uuid: `u${i}`,
    })
    for await (const _ of $.turn.step({ turnId: 'a', index: i, model: 'claude-opus-5-5', messageCount: 3 })) {
      // tüket
    }
  }
  // Bir alt agent isteği.
  for await (const _ of $.turn.step({
    turnId: 'b',
    index: 0,
    model: 'claude-opus-5-5',
    messageCount: 1,
    agentId: 'ag1',
  })) {
    // tüket
  }
  await saat.advance(3000)

  for (const surface of ['terminal', 'desktop'] as const) {
    const bant = await $.ui.mount({ ...BANT, surface })
    const ust = await bant.find({ type: 'Text', text: /token/ })
    // 3 × (10+50000+8000+1200) + (5+20000+2000+800) = 200 430
    expect(ust?.text).toContain('200k token')
    const ek = await bant.find({ type: 'Text', text: /araç/ })
    expect(ek?.text).toContain('2 araç · 2 beceri')
    expect(ek?.text).toContain('$1.23')
    expect(ek?.text).toContain('hafıza %6 dolu')
    await bant.unmount()
  }

  const panel = await $.ui.mount({ ...PANEL, surface: 'desktop' })
  expect((await panel.find({ type: 'Text', text: /kez cevap/ }))?.text).toContain('3 kez')
  await panel.press({ key: 's-oneri' })
  const oneri = await panel.find({ type: 'Text', text: /veritabani/ })
  expect(oneri?.text).toContain('hiç kullanılmadı')
  const cikti = await panel.find({ type: 'Text', text: /uzun sonuç/ })
  expect(cikti?.text).toContain('dosya')
  const tekrar = await panel.find({ type: 'Text', text: /tekrar okundu/ })
  expect(tekrar?.text).toContain('2 kez')
  await panel.press({ key: 's-bilesen' })
  expect(await panel.find({ type: 'Text', text: /Yardımcı Claude: Explore 23k/ })).toBeDefined()
  expect(await panel.find({ type: 'Text', text: /Bağlı araç: dosya ~/ })).toBeDefined()
  await panel.unmount()
})
