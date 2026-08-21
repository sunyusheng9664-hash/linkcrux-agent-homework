import { z } from 'zod'

export type ModelMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

type ModelConfiguration = {
  baseUrl: string
  apiKey: string
  model: string
}

type ModelResponse = {
  choices?: Array<{ message?: { content?: unknown } }>
}

export class ModelClient {
  private readonly configuration: ModelConfiguration

  constructor(configuration = readModelConfiguration()) {
    this.configuration = configuration
  }

  async generateStructured<T>(schema: z.ZodType<T>, messages: ModelMessage[]): Promise<T> {
    let responseContent = await this.request(messages)
    let parsed = parseStructuredResponse(schema, responseContent)

    if (parsed.success) {
      return parsed.data
    }

    responseContent = await this.request([
      ...messages,
      { role: 'assistant', content: responseContent },
      {
        role: 'user',
        content:
          '上一份输出不符合要求的 JSON 结构。请只返回符合原任务要求的 JSON，不要 Markdown、解释或额外字段。',
      },
    ])
    parsed = parseStructuredResponse(schema, responseContent)

    if (parsed.success) {
      return parsed.data
    }

    throw new Error('MODEL_SCHEMA_INVALID')
  }

  private async request(messages: ModelMessage[]): Promise<string> {
    const response = await fetch(`${this.configuration.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.configuration.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.configuration.model,
        messages,
        response_format: { type: 'json_object' },
      }),
    })

    if (!response.ok) {
      throw new Error('MODEL_REQUEST_FAILED')
    }

    const payload = (await response.json()) as ModelResponse
    const content = payload.choices?.[0]?.message?.content

    if (typeof content !== 'string') {
      throw new Error('MODEL_RESPONSE_INVALID')
    }

    return content
  }
}

function readModelConfiguration(): ModelConfiguration {
  const baseUrl = process.env.LLM_BASE_URL?.replace(/\/+$/, '')
  const apiKey = process.env.LLM_API_KEY
  const model = process.env.LLM_MODEL

  if (!baseUrl || !apiKey || !model) {
    throw new Error('MODEL_CONFIG_MISSING')
  }

  return { baseUrl, apiKey, model }
}

function parseStructuredResponse<T>(schema: z.ZodType<T>, content: string) {
  try {
    return schema.safeParse(JSON.parse(stripCodeFence(content)))
  } catch {
    return { success: false as const }
  }
}

function stripCodeFence(content: string): string {
  const fenced = content.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)

  return fenced ? fenced[1] : content
}
