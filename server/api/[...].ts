// Unmatched /api/* must 404 as JSON, not fall through to the SPA shell.
// Nuxt in SPA mode would otherwise serve index.html with a 200, which turns
// a typo'd endpoint into an opaque JSON-parse error at the call site.
export default defineEventHandler((event) => {
  throw createError({
    statusCode: 404,
    statusMessage: `No API route matches ${event.path}`,
  })
})
