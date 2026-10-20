/** Deterministic external-model fixture; Agent, Session, persistence, and Loader remain real. */
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'

/** Scripted text responses, with an abortable pending response for lifecycle assertions. */
export class QuestionModel extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  hold = false
  failNext = false

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  async *stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(request)
    if (this.failNext) {
      this.failNext = false
      throw new Error('fixture transient failure')
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    if (this.hold) {
      await new Promise<void>((_resolve, reject) => {
        const abort = (): void => { reject(new Error('fixture model aborted')) }
        request.signal?.addEventListener('abort', abort, { once: true })
        if (request.signal?.aborted) abort()
      })
      return
    }
    yield { type: 'text-delta', index: 0, text: 'Answer.' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Answer.' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
