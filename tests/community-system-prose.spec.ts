import { describe, expect, it } from 'vitest'
import { prepareChatBody, prepareCnChatBody } from '../src/upstream.ts'

function messagesOf(prepared: string): Record<string, unknown>[] {
  return (JSON.parse(prepared) as { messages: Record<string, unknown>[] }).messages
}

describe('community system prose compatibility', () => {
  it('rewrites only the known path-reference instruction while preserving protected suffixes', () => {
    const original = 'Tokens prefixed with @ are paths the user explicitly referenced. Relative paths resolve from the workspace root; absolute paths identify files or directories on the host.'
    const replacement = 'An @ mention identifies a path explicitly supplied by the user. Resolve relative references from the workspace root and treat absolute references as host file or directory paths.'
    const suffix = ' Preserve "example.txt" and C:\\Apps\\DeepSeek Harness\\src.'
    const source = JSON.stringify({ messages: [{ role: 'system', content: original + suffix }, { role: 'user', content: original }] })
    const prepared = prepareChatBody(source)
    expect(messagesOf(prepared)[0]?.['content']).toBe(replacement + suffix)
    expect(messagesOf(prepared)[1]?.['content']).toBe(original)
    expect(prepareCnChatBody(prepared)).toBe(prepared)
  })

  it('preserves the known path-reference text inside quotes and fenced code', () => {
    const original = 'Tokens prefixed with @ are paths the user explicitly referenced. Relative paths resolve from the workspace root; absolute paths identify files or directories on the host.'
    const content = [`"${original}"`, '```text', original, '```'].join('\n')
    const prepared = prepareChatBody(JSON.stringify({ messages: [{ role: 'system', content }] }))
    expect(messagesOf(prepared)[0]?.['content']).toBe(content)
  })
  it('rewrites generated developer prose after converting its role to system', () => {
    const prepared = prepareChatBody(JSON.stringify({
      messages: [{ role: 'developer', content: 'You are running DeepSeek Harness locally.' }],
    }))

    expect(messagesOf(prepared)).toEqual([
      { role: 'system', content: 'You are running the local agent runtime locally.' },
    ])
  })

  it('rewrites string and text-block prose across multiple system messages', () => {
    const prepared = prepareChatBody(JSON.stringify({ messages: [
      { role: 'system', content: 'DeepSeek Harness instructions.' },
      { role: 'system', content: [
        { type: 'text', text: 'Use DeepSeek Harness.' },
        { type: 'image_url', image_url: { url: 'https://example.test/DeepSeek%20Harness.png' } },
        { type: 'text', text: 'DeepSeek Harness may appear twice: DeepSeek Harness.' },
      ] },
    ] }))

    expect(messagesOf(prepared)).toEqual([
      { role: 'system', content: 'the local agent runtime instructions.' },
      { role: 'system', content: [
        { type: 'text', text: 'Use the local agent runtime.' },
        { type: 'image_url', image_url: { url: 'https://example.test/DeepSeek%20Harness.png' } },
        { type: 'text', text: 'the local agent runtime may appear twice: the local agent runtime.' },
      ] },
    ])
  })

  it('preserves literal paths and product-name lookalikes at path or word boundaries', () => {
    const content = String.raw`DeepSeek Harness is text; C:\Apps\DeepSeek Harness\run.exe, /opt/DeepSeek Harness/bin, x-DeepSeek Harness, DeepSeek Harness-v2, and DeepSeek HarnessX stay intact.`
    const prepared = prepareChatBody(JSON.stringify({ messages: [{ role: 'system', content }] }))

    expect(messagesOf(prepared)[0]?.['content']).toBe(content)
  })

  it('preserves path-bearing lines with spaces and quoted filenames', () => {
    const content = [
      String.raw`Workspace: C:\Projects\My DeepSeek Harness project\src`,
      '/tmp/My DeepSeek Harness project/src',
      'Open "DeepSeek Harness.md" before continuing.',
      'DeepSeek Harness is a local runtime.',
    ].join('\n')
    const prepared = prepareChatBody(JSON.stringify({ messages: [{ role: 'system', content }] }))

    expect(messagesOf(prepared)[0]?.['content']).toBe(content.replace(
      'DeepSeek Harness is a local runtime.',
      'the local agent runtime is a local runtime.',
    ))
  })

  it('preserves a recognizable filename extension anywhere in a line, including text blocks', () => {
    const content = 'Open My DeepSeek Harness project.md before continuing.'
    const prepared = prepareChatBody(JSON.stringify({ messages: [{ role: 'system', content: [
      { type: 'text', text: content },
      { type: 'text', text: 'Open My DeepSeek Harness project.md.' },
      { type: 'text', text: 'The DeepSeek Harness notes.md are nearby.' },
      { type: 'text', text: 'DeepSeek Harness is a local runtime.' },
    ] }] }))

    expect(messagesOf(prepared)[0]?.['content']).toEqual([
      { type: 'text', text: content },
      { type: 'text', text: 'Open My DeepSeek Harness project.md.' },
      { type: 'text', text: 'The DeepSeek Harness notes.md are nearby.' },
      { type: 'text', text: 'the local agent runtime is a local runtime.' },
    ])
  })

  it('preserves inline code and complete fenced code blocks', () => {
    const content = [
      'Run `DeepSeek Harness --version` after setup.',
      '```text',
      'DeepSeek Harness',
      String.raw`C:\Projects\DeepSeek Harness\src`,
      '```',
      'DeepSeek Harness is a local runtime.',
    ].join('\n')
    const prepared = prepareChatBody(JSON.stringify({ messages: [{ role: 'system', content }] }))

    expect(messagesOf(prepared)[0]?.['content']).toBe(content.replace(
      'DeepSeek Harness is a local runtime.',
      'the local agent runtime is a local runtime.',
    ))
  })

  it('rewrites the measured DSH sentence prefix while preserving literals later on its line', () => {
    const prefix = 'You are interacting with the user through the DeepSeek Harness Web GUI whose URL the runtime context names.'
    const suffix = ' Preserve "DeepSeek Harness.md", `DeepSeek Harness`, and C:\\Apps\\DeepSeek Harness\\src verbatim.'
    const content = `${prefix}${suffix}`
    const prepared = prepareChatBody(JSON.stringify({ messages: [{ role: 'system', content }] }))

    expect(messagesOf(prepared)[0]?.['content']).toBe(
      `${prefix.replace('DeepSeek Harness', 'local agent runtime')}${suffix}`,
    )
  })

  it('rewrites the first-party identity when the same line contains protected paths and quotes', () => {
    const prefix = 'You are an AI agent powered by DeepSeek Harness.'
    const suffix = ' Preserve "DeepSeek Harness.md" and C:\\Apps\\DeepSeek Harness\\src verbatim.'
    const prepared = prepareChatBody(JSON.stringify({ messages: [{ role: 'system', content: prefix + suffix }] }))
    expect(messagesOf(prepared)[0]?.['content']).toBe('You are an AI agent powered by the local agent runtime.' + suffix)
  })

  it('does not rewrite the measured DSH sentence when quoted, path-prefixed, or fenced', () => {
    const prefix = 'You are interacting with the user through the DeepSeek Harness Web GUI whose URL the runtime context names.'
    const content = [
      `"${prefix}"`,
      `C:\\Apps\\workspace\\ ${prefix}`,
      '```text',
      prefix,
      '```',
    ].join('\n')
    const prepared = prepareChatBody(JSON.stringify({ messages: [{ role: 'system', content }] }))

    expect(messagesOf(prepared)[0]?.['content']).toBe(content)
  })

  it('keeps the measured-prefix transform idempotent on direct CN preparation', () => {
    const content = 'You are interacting with the user through the DeepSeek Harness Web GUI whose URL the runtime context names. Keep C:\\Apps\\DeepSeek Harness\\src.'
    const source = JSON.stringify({ messages: [{ role: 'system', content }] })
    const prepared = prepareCnChatBody(source)

    expect(messagesOf(prepared)[0]?.['content']).toBe(
      'You are interacting with the user through the local agent runtime Web GUI whose URL the runtime context names. Keep C:\\Apps\\DeepSeek Harness\\src.',
    )
    expect(prepareCnChatBody(prepared)).toBe(prepared)
  })

  it('keeps nested shorter fences inside longer backtick and tilde fences opaque', () => {
    const content = [
      '````text',
      'DeepSeek Harness',
      '```',
      'DeepSeek Harness remains fenced.',
      '````',
      '~~~~text',
      'DeepSeek Harness',
      '~~~',
      'DeepSeek Harness remains fenced.',
      '~~~~',
      'DeepSeek Harness is plain prose.',
    ].join('\n')
    const prepared = prepareChatBody(JSON.stringify({ messages: [{ role: 'system', content }] }))

    expect(messagesOf(prepared)[0]?.['content']).toBe(content.replace(
      'DeepSeek Harness is plain prose.',
      'the local agent runtime is plain prose.',
    ))
  })

  it('carries fenced-code protection across text blocks in one system message', () => {
    const content = [
      { type: 'text', text: '````text\n' },
      { type: 'text', text: 'DeepSeek Harness\n' },
      { type: 'text', text: '````\nDeepSeek Harness is plain prose.' },
    ]
    const prepared = prepareChatBody(JSON.stringify({ messages: [{ role: 'system', content }] }))

    expect(messagesOf(prepared)[0]?.['content']).toEqual([
      content[0], content[1],
      { type: 'text', text: '````\nthe local agent runtime is plain prose.' },
    ])
  })

  it('leaves user, assistant, and tool data, schemas, and metadata untouched', () => {
    const input = {
      messages: [
        { role: 'system', content: 'Hello.' },
        { role: 'user', content: 'DeepSeek Harness' },
        { role: 'assistant', content: 'DeepSeek Harness' },
        { role: 'tool', content: 'DeepSeek Harness' },
      ],
      tools: [{ type: 'function', function: { name: 'DeepSeek Harness', description: 'DeepSeek Harness' } }],
      metadata: { note: 'DeepSeek Harness' },
    }
    const prepared = JSON.parse(prepareChatBody(JSON.stringify(input))) as typeof input & { stream: boolean }

    expect(prepared['messages']).toEqual(input.messages)
    expect(prepared['tools']).toEqual(input.tools)
    expect(prepared['metadata']).toEqual(input.metadata)
    expect(prepared['stream']).toBe(true)
  })

  it('is idempotent in prepareChatBody and direct prepareCnChatBody calls', () => {
    const source = JSON.stringify({ messages: [{ role: 'system', content: 'DeepSeek Harness' }] })
    const prepared = prepareChatBody(source)
    expect(prepareChatBody(prepared)).toBe(prepared)

    const cnPrepared = prepareCnChatBody(source)
    expect(messagesOf(cnPrepared)[0]?.['content']).toBe('the local agent runtime')
    expect(prepareCnChatBody(cnPrepared)).toBe(cnPrepared)
  })

  it('preserves malformed and non-object JSON input', () => {
    for (const source of ['not json', 'null', '[]', '"DeepSeek Harness"']) {
      expect(prepareChatBody(source)).toBe(source)
      expect(prepareCnChatBody(source)).toBe(source)
    }
  })

  it('keeps unsupported-effort handling on the CN helper unchanged', () => {
    const prepared = JSON.parse(prepareCnChatBody(JSON.stringify({
      messages: [{ role: 'system', content: 'DeepSeek Harness' }],
      reasoning_effort: 'off',
    }))) as { messages: { content: string }[]; reasoning_effort?: string }

    expect(prepared['messages'][0]?.['content']).toBe('the local agent runtime')
    expect('reasoning_effort' in prepared).toBe(false)
  })
})
