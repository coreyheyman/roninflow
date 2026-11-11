export async function resolve(spec, ctx, next) {
  try { return await next(spec, ctx); } catch (e) {
    if (/^\.{1,2}\//.test(spec) && !/\.[cm]?jsx?$/.test(spec)) {
      for (const ext of ['.js', '.jsx']) { try { return await next(spec + ext, ctx); } catch { /* next */ } }
    }
    throw e;
  }
}
