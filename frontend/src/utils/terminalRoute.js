import { encodeFolderPath } from '@/utils/folderRoute';

/**
 * Where a terminal is, written the way a folder is.
 *
 * A terminal is a place: the folder its shell starts in is its address, so two
 * folders can each have one and a tab can hold either. Each segment is encoded on
 * its own, for the same reason a folder's is — a single parameter comes back with
 * every slash in it as `%2F`, and a reverse proxy may refuse that.
 */
export const terminalRoute = (path) => {
  const encoded = encodeFolderPath(path);
  return { path: encoded ? `/terminal/${encoded}` : '/terminal' };
};
