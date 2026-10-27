/**
 * The order a folder's entries are shown in: folders first, then by the
 * chosen key and direction — or, when asked to, one list ordered purely by
 * the chosen key and direction (#495).
 *
 * When sorting by size, directories must be ranked by their pre-computed
 * recursive size (from the folder size index), not by the near-zero directory
 * inode size on `item.size` — otherwise the sort order does not match the
 * sizes shown in the UI.
 *
 * @param {Array} items
 * @param {{ by: string, order: 'asc'|'desc' }} sortBy
 * @param {(fullPath: string) => ({ sizeBytes?: number|null }|null|undefined)} folderSizeFor
 * @param {{ foldersFirst?: boolean }} [options] folders-first unless told otherwise
 * @returns {Array} a new array; `items` is left as it was
 */
export const sortItems = (items, sortBy, folderSizeFor, { foldersFirst = true } = {}) => {
  const direction = sortBy?.order === 'asc' ? 1 : -1;
  const sortKey = sortBy?.by;

  const sortValue = (item, key) => {
    if (key === 'size') {
      if (item.kind === 'directory') {
        const full = item.path ? `${item.path}/${item.name}` : item.name;
        const entry = folderSizeFor(full);
        if (entry && entry.sizeBytes != null) return entry.sizeBytes;
      }
      return Number(item.size) || 0;
    }
    return item[key];
  };

  return [...items].sort((a, b) => {
    // keep directories first, unless the person asked for one list
    if (foldersFirst) {
      const isDirDiff = (b.kind === 'directory') - (a.kind === 'directory');
      if (isDirDiff) return isDirDiff; // returns -1 or 1
    }

    const aValue = sortValue(a, sortKey);
    const bValue = sortValue(b, sortKey);
    if (aValue === bValue) return 0;

    if (typeof aValue === 'string' && typeof bValue === 'string') {
      return aValue.localeCompare(bValue, undefined, { sensitivity: 'base' }) * direction;
    }
    return (aValue > bValue ? 1 : -1) * direction;
  });
};
