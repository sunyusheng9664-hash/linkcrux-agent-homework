import { z } from 'zod'

export const ApiRequestSchema = z.object({
  action: z.string().min(1),
  payload: z.unknown().default({}),
})

export const ApiResponseSchema = z.discriminatedUnion('ok', [
  z
    .object({
      ok: z.literal(true),
      data: z.unknown(),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      error: z.object({
        code: z.string().min(1),
        message: z.string().min(1),
      }),
    })
    .strict(),
])

export type ApiRequest = z.infer<typeof ApiRequestSchema>
export type ApiResponse = z.infer<typeof ApiResponseSchema>
