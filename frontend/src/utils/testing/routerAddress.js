/**
 * How the router spells an address, for a suite that has mocked the router away.
 *
 * Every one of these suites replaces `vue-router` with a stand-in, so the stand-in has
 * to answer `resolve` the way the real one does — and what matters about the real one
 * here is the one thing that was wrong in the application: a slash inside a query value
 * stays a slash. `URLSearchParams` writes it `%2F`, which is how a comparison came to be
 * stored under one spelling of its address and handed back under another.
 *
 * A stand-in, so it proves nothing about the router itself: that the two spellings
 * really do meet is proved in a browser, by a comparison whose tab still closes from
 * its own cross after its sides have been swapped over.
 */
export const resolveAddress = (target) => {
  const query = target?.query || {};
  const parts = Object.entries(query).flatMap(([key, value]) =>
    (Array.isArray(value) ? value : [value])
      .filter((one) => one !== undefined && one !== null)
      .map((one) => `${key}=${encodeURIComponent(one).replace(/%2F/g, '/')}`)
  );
  const path = target?.path || '';
  return { fullPath: parts.length ? `${path}?${parts.join('&')}` : path };
};
