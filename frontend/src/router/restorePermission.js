/**
 * Whether the folder being navigated to may put its reader back where they were,
 * and whose permission that is.
 *
 * A remembered position is worth restoring when somebody walks back *up* out of a
 * folder into the one above it, and is a surprise anywhere else: opening a folder
 * that happened to be visited an hour ago should not jump. That much the router has
 * always decided here.
 *
 * What it had not decided is whose permission it is. The folder's own memory is
 * shared by every tab on that folder, and so was the permission to read it — so one
 * tab walking up left a permission that the *next* tab drawn on that folder
 * consumed, and that tab was put where the first reader had been. With tabs, two
 * readers can be in one folder at once; the permission has to name one of them.
 *
 * Kept beside the router rather than inside it so that it can be asked directly,
 * the way the other rules here are.
 */
export const restorePermission = ({ destination, source, travelling }) => {
  if (!destination) return null;
  const walkedUpInto = Boolean(destination && source && source.startsWith(`${destination}/`));
  return { path: destination, tabId: travelling || '', permitted: walkedUpInto };
};
