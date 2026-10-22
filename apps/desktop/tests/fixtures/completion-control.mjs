/** Test-only access to the Loader-composed profile's task services. */
export const ready = Promise.withResolvers()
export const inject = ['agents', 'llm', 'agentPresets']
export function apply(ctx) { ready.resolve(ctx) }
