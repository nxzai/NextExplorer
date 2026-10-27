import { normalizePath } from '@/api';
import { MAX_COMPARED, MIN_COMPARED } from '@/config/compare';

/**
 * Where a comparison is, as an address of its own.
 *
 * Two or three paths in the query rather than in the path itself, because a
 * comparison is not *at* a place — it is about several of them, and none of them is
 * the one it belongs to. A query also survives paths with slashes in them without
 * anybody having to invent a separator that a file name cannot contain, which is a
 * thing no separator is.
 *
 * An address, like everything else here: it can be kept in a tab, linked to and
 * come back to, which is what makes a comparison something the reader leaves and
 * returns to rather than a dialog they must finish.
 */
/**
 * A side, as a path and — for an earlier version of a file — which version.
 *
 * Two parallel lists in the query rather than one clever string, because the obvious
 * clever string needs a separator a file name cannot contain, and there is no such
 * character. Position is the join: `versions[i]` belongs to `paths[i]`, and an empty
 * one means the file as it is now.
 */
const asSide = (one) =>
  typeof one === 'string'
    ? { path: normalizePath(one), versionId: '' }
    : { path: normalizePath(one?.path || ''), versionId: String(one?.versionId || '') };

export const compareRoute = (sides) => {
  const wanted = (Array.isArray(sides) ? sides : [sides]).map(asSide).filter((one) => one.path);

  // The same file against itself is not a comparison — but a file against one of its
  // own earlier versions is, which is why the version is part of what makes a side
  // distinct rather than the path alone.
  const seen = new Set();
  const unique = wanted.filter((one) => {
    const signature = `${one.path}\u0000${one.versionId}`;
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
  if (unique.length < MIN_COMPARED || unique.length > MAX_COMPARED) return null;

  return {
    path: '/compare',
    query: {
      paths: unique.map((one) => one.path),
      // Left off entirely when no side is a version, so the everyday address stays
      // the short one it was.
      ...(unique.some((one) => one.versionId)
        ? { versions: unique.map((one) => one.versionId) }
        : {}),
    },
  };
};

/** A repeated query parameter, which arrives as one value or as many. */
const listOf = (raw) => (Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw]);

/** Just the paths, for anything that has no business with versions — a tab's name. */
export const comparedPaths = (query) => comparedSides(query).map((side) => side.path);

/**
 * The sides a comparison address names, in the order they were given.
 *
 * One value arrives as a string and several as an array, which is what a router does
 * with a repeated parameter — so both are read the same way here rather than at every
 * caller. A version id with no path beside it is nothing: the position is the join,
 * and a join with one half missing joins nothing.
 */
export const comparedSides = (query) => {
  const paths = listOf(query?.paths);
  const versions = listOf(query?.versions);
  const seen = new Set();

  return paths
    .map((path, index) => ({
      path: normalizePath(typeof path === 'string' ? path : ''),
      versionId: typeof versions[index] === 'string' ? versions[index] : '',
    }))
    .filter((side) => {
      if (!side.path) return false;
      const signature = `${side.path}\u0000${side.versionId}`;
      if (seen.has(signature)) return false;
      seen.add(signature);
      return true;
    })
    .slice(0, MAX_COMPARED);
};

/**
 * The same address as a string, spelled the way the router spells it.
 *
 * A tab holds an address as a string and a screen is handed `route.fullPath`, so the
 * two have to be the same string — and the obvious hand-rolled spelling is not it.
 * `URLSearchParams` writes a slash in a query value as `%2F`; the router leaves it
 * alone. So a comparison of two files in a folder was stored under one spelling and
 * arrived under another, and everything that matches an address by name then missed:
 * the landing dropped the flag a screen's own cross closes a tab by, as if the reader
 * had walked somewhere, and what the tab was holding was looked for under a name
 * nothing had kept it under.
 *
 * Asked of the router rather than spelled out again here, because the only spelling
 * that can be relied on to match `route.fullPath` is the router's own.
 */
export const compareAddress = (router, sides) => {
  const target = compareRoute(sides);
  return target ? router.resolve(target).fullPath : '';
};
