const cache = new Map<string, { value: any; expires: number }>();

function set(key: string, value: any, ttlSeconds = 60) {
  const expires = Date.now() + ttlSeconds * 1000;
  cache.set(key, { value, expires });
}

function get(key: string) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function del(key: string) {
  cache.delete(key);
}

export default { set, get, del };