/**
 * Process-lifetime memo for content loaders, keyed by the content root (the
 * website package directory, `process.cwd()` by default).
 *
 * Every route renders per request (the root layout's `generateMetadata` reads
 * `headers()`), and content only changes on deploy, so in production each file
 * is read and parsed once per server process. Under `next dev` the cache is
 * bypassed so markdown edits still show up on reload.
 */
export function cachedByRoot<T>(load: (root: string) => T): (root?: string) => T {
  const cache = new Map<string, T>();
  return (root = process.cwd()) => {
    if (process.env.NODE_ENV === "development") return load(root);
    if (!cache.has(root)) cache.set(root, load(root));
    return cache.get(root) as T;
  };
}
