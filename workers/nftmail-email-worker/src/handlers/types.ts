/**
 * handlers/types.ts — shared HandlerFn type for the dispatch router.
 *
 * Uses `Record<string, unknown>` for env to avoid circular imports with index.ts.
 * Each handler casts env to the minimal shape it requires.
 */

export type HandlerFn = (
  email: Record<string, unknown>,
  env: Record<string, unknown>,
  request: Request,
  corsify: (r: Response, req: Request) => Response,
) => Promise<Response>;
