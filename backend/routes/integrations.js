// Thin re-export shim. The real route registration lives in
// `routes/integrations/` split by concern:
//   - public.js              public (unauthenticated) routes
//   - admin.js               authenticated admin routes
//   - categories-store.js    preference-center Setting helpers
//   - unsubscribe-page.js    HTML renderers for /unsubscribe
//
// Keeping this file as the public surface means server.js (and any other
// import sites) keep working unchanged. New consumers should import the
// specific files directly.

export { registerPublicIntegrationRoutes } from './integrations/public.js';
export { registerIntegrationRoutes } from './integrations/admin.js';
export {
  readUnsubscribeCategories,
  writeUnsubscribeCategories,
} from './integrations/categories-store.js';
