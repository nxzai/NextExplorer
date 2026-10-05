import {
  ArrowsRightLeftIcon,
  StarIcon as StarOutline,
  DocumentTextIcon,
  CommandLineIcon,
  ArrowDownTrayIcon,
  DocumentArrowDownIcon,
  ShareIcon,
  ArchiveBoxArrowDownIcon,
  ArrowUpOnSquareIcon,
  ArrowTopRightOnSquareIcon,
  ClockIcon,
} from '@heroicons/vue/24/outline';
import { StarIcon as StarSolid } from '@heroicons/vue/24/solid';
import {
  CreateNewFolderRound,
  InsertDriveFileRound,
  ContentCutRound,
  ContentCopyRound,
  ContentPasteRound,
  DriveFileRenameOutlineRound,
  DriveFileMoveRound,
  FolderCopyRound,
  InfoRound,
  DeleteRound,
} from '@vicons/material';

/**
 * What the right-click menu offers, decided from what is true where it opened.
 *
 * This is the file that tells somebody what they are allowed to do: an entry
 * shown here that the server then refuses is a promise broken in front of
 * them. It used to be one computed of two hundred lines inside the menu
 * component, reachable only by mounting it; here it is a function of a plain
 * description of the situation, with the menu's own wording and order.
 *
 * Two rules run through it. An entry the location forbids is left out — a
 * read-only folder offers no rename at all. An entry the location allows but
 * the selection cannot use is shown disabled — rename on two files at once —
 * so the reader learns it exists.
 *
 * @typedef {object} MenuSituation
 * @property {'background'|'file'|'directory'} kind  what was right-clicked
 * @property {boolean} hasPrimary       one item to act on
 * @property {boolean} hasSelection
 * @property {boolean} isVolumesView    the list of volumes, where nothing is made
 * @property {boolean} isShareView      inside a share, which is not shared again
 * @property {boolean} locationCanShare
 * @property {boolean} locationCanWrite
 * @property {boolean} locationCanDelete
 * @property {boolean} locationCanCreateFolder
 * @property {boolean} locationCanCreateFile
 * @property {boolean} canShare
 * @property {boolean} canCut
 * @property {boolean} canCopy
 * @property {boolean} canPaste
 * @property {boolean} canRename
 * @property {boolean} canDelete
 * @property {boolean} canShowVersions
 * @property {boolean} canOpenWithTerminal
 * @property {boolean} isArchiveSelected
 * @property {boolean} canExtractArchive
 * @property {boolean} canCompressToZip
 * @property {boolean} isFavorite       the folder the entry is about is a favourite
 * @property {boolean} hasFavoritePath  there is a folder to mark at all
 * @property {boolean} isMutatingFavorite
 */

/** Paste goes wherever something may be made. */
const canAcceptPaste = (situation) =>
  Boolean(situation.locationCanCreateFolder || situation.locationCanCreateFile);

/**
 * The entry builders, bound to the words of this menu.
 */
const entryMaker = (situation, run, { t, modKeyLabel }) => {
  const mk = (id, label, icon, handler, opts = {}) => ({
    id,
    label,
    icon,
    run: handler,
    disabled: Boolean(opts.disabled),
    shortcut: opts.shortcut || '',
    danger: Boolean(opts.danger),
  });

  return {
    mk,
    favorite: (id) =>
      mk(
        id,
        situation.isFavorite ? t('context.removeFromFavorites') : t('context.addToFavorites'),
        situation.isFavorite ? StarSolid : StarOutline,
        run.toggleFavorite,
        { disabled: !situation.hasFavoritePath || situation.isMutatingFavorite }
      ),
    paste: (handler) =>
      mk('paste', t('actions.paste'), ContentPasteRound, handler, {
        disabled: !situation.canPaste,
        shortcut: `${modKeyLabel}V`,
      }),
    getInfo: () =>
      mk('get-info', t('context.getInfo'), InfoRound, run.getInfo, {
        disabled: !situation.hasPrimary,
      }),
  };
};

/** The folder's own menu: what it is, whether it is a favourite, what may be made in it. */
const backgroundSections = (situation, run, entries, t) => {
  const { mk } = entries;
  const sections = [[entries.getInfo()], [entries.favorite('fav-current')]];

  const createItems = [];
  if (situation.locationCanCreateFolder) {
    createItems.push(mk('new-folder', t('actions.newFolder'), CreateNewFolderRound, run.newFolder));
  }
  if (situation.locationCanCreateFile) {
    createItems.push(mk('new-file', t('actions.newFile'), InsertDriveFileRound, run.newFile));
  }
  if (createItems.length > 0) sections.push(createItems);

  if (canAcceptPaste(situation)) sections.push([entries.paste(run.pasteIntoCurrent)]);

  return sections;
};

/** Extracting an archive, and making one of the selection. Nothing on the volumes. */
const archiveSection = (situation, run, { mk }, t) => {
  const section = [];
  if (situation.isVolumesView) return section;

  // Formats come from the server probe (zip, 7z, iso, rar, tar.gz…).
  if (situation.hasPrimary && situation.kind === 'file' && situation.isArchiveSelected) {
    section.push(
      mk('extract-archive', t('actions.extractArchive'), ArrowUpOnSquareIcon, run.extract, {
        disabled: !situation.canExtractArchive,
      }),
      mk(
        'extract-archive-current-folder',
        t('actions.extractArchiveIntoCurrentFolder'),
        ArrowUpOnSquareIcon,
        run.extractHere,
        { disabled: !situation.canExtractArchive }
      )
    );
  }

  if (situation.hasSelection) {
    section.push(
      mk('compress-zip', t('actions.compressToZip'), ArchiveBoxArrowDownIcon, run.compress, {
        disabled: !situation.canCompressToZip,
      })
    );
  }
  return section;
};

/**
 * Cut, copy, move to, copy to, and paste into a folder. A move takes the item
 * away from here, so it needs both halves allowed; a copy only reads.
 */
const clipboardSection = (situation, run, entries, { t, modKeyLabel }) => {
  const { mk } = entries;
  const canMoveOut = situation.locationCanWrite && situation.locationCanDelete;
  const section = [];
  if (canMoveOut) {
    section.push(
      mk('cut', t('actions.cut'), ContentCutRound, run.cut, {
        disabled: !situation.canCut,
        shortcut: `${modKeyLabel}X`,
      })
    );
  }
  section.push(
    mk('copy', t('actions.copy'), ContentCopyRound, run.copy, {
      disabled: !situation.canCopy,
      shortcut: `${modKeyLabel}C`,
    })
  );
  if (canMoveOut) {
    section.push(
      mk('moveTo', t('destinationPicker.moveTitle'), DriveFileMoveRound, run.moveTo, {
        disabled: !situation.canCut,
      })
    );
  }
  section.push(
    mk('copyTo', t('destinationPicker.copyTitle'), FolderCopyRound, run.copyTo, {
      disabled: !situation.canCopy,
    })
  );
  if (situation.kind === 'directory' && canAcceptPaste(situation)) {
    section.push(entries.paste(run.pasteIntoDirectory));
  }
  return section;
};

/** What a file or a folder offers. */
const itemSections = (situation, run, entries, words) => {
  const { mk } = entries;
  const { t, deleteKeyLabel } = words;
  const sections = [];

  const infoSection = [entries.getInfo()];
  if (situation.canShowVersions) {
    infoSection.push(mk('versions', t('versions.menu'), ClockIcon, run.showVersions));
  }
  sections.push(infoSection);

  // Where a browser puts it, and for the same reason: it is about *this* entry, and
  // it is the first thing somebody with tabs open reaches for. Offered only where
  // it would do something — tabs on, and an entry that has an address of its own.
  // Comparing two or three files, beside opening one: both are about what has been
  // chosen rather than about where it is, and this is the one that needs more than one.
  if (situation.canCompare) {
    sections.push([
      mk(
        'compare',
        t('compare.compareCount', { count: situation.comparedCount || 2 }),
        ArrowsRightLeftIcon,
        run.compare
      ),
    ]);
  }

  if (situation.canOpenInTab) {
    // Named for what it will do: four chosen entries become four tabs, and a
    // label that said "a new tab" would be describing something else. Two keys
    // rather than a plural rule — the catalogues here carry no ICU plurals.
    const many = (situation.openInTabCount || 1) > 1;
    sections.push([
      mk(
        'open-in-tab',
        many
          ? t('tabs.openInNewTabs', { count: situation.openInTabCount })
          : t('tabs.openInNewTab'),
        ArrowTopRightOnSquareIcon,
        run.openInTab
      ),
    ]);
  }

  if (situation.kind === 'file') {
    const openSection = [
      mk('open-with-editor', t('context.openWithEditor'), DocumentTextIcon, run.openWithEditor, {
        disabled: !situation.hasPrimary,
      }),
    ];
    if (situation.canOpenWithTerminal) {
      openSection.push(
        mk(
          'open-with-terminal',
          t('context.openWithTerminal'),
          CommandLineIcon,
          run.openWithTerminal,
          { disabled: !situation.hasPrimary }
        )
      );
    }
    sections.push(openSection);
  }

  // Two entries only where they do two different things: several items, at
  // least one of them a file. The account's own choice is offered first, so the
  // habit stays in the same place and the other way is one line below it.
  if (situation.canDownloadSeparately) {
    const asZip = mk('download-zip', t('download.asZip'), ArrowDownTrayIcon, run.downloadAsZip);
    const asFiles = mk(
      'download-separate',
      t('download.asSeparateFiles'),
      DocumentArrowDownIcon,
      run.downloadSeparately
    );
    sections.push(situation.downloadMode === 'separate' ? [asFiles, asZip] : [asZip, asFiles]);
  } else {
    sections.push([
      mk('download', t('actions.download'), ArrowDownTrayIcon, run.download, {
        disabled: !situation.hasSelection,
      }),
    ]);
  }

  const archives = archiveSection(situation, run, entries, t);
  if (archives.length) sections.push(archives);

  // Same availability rules as the toolbar.
  if (!situation.isVolumesView && !situation.isShareView && situation.locationCanShare) {
    sections.push([
      mk('share', t('share.shareSelectedItem'), ShareIcon, run.share, {
        disabled: !situation.canShare,
      }),
    ]);
  }

  sections.push(clipboardSection(situation, run, entries, words));

  if (situation.locationCanWrite) {
    sections.push([
      mk('rename', t('actions.rename'), DriveFileRenameOutlineRound, run.rename, {
        disabled: !situation.canRename,
        shortcut: 'F2',
      }),
    ]);
  }

  if (situation.kind === 'directory') sections.push([entries.favorite('fav')]);

  if (situation.locationCanDelete) {
    sections.push([
      mk('delete', t('common.delete'), DeleteRound, run.delete, {
        disabled: !situation.canDelete,
        danger: true,
        shortcut: deleteKeyLabel,
      }),
    ]);
  }

  return sections;
};

/**
 * @param {MenuSituation} situation
 * @param {Record<string, Function>} run  what each entry does, by name
 * @param {object} words
 * @param {(key: string) => string} words.t
 * @param {string} words.modKeyLabel     ⌘ or Ctrl+
 * @param {string} words.deleteKeyLabel
 * @returns {Array<Array<{id, label, icon, run, disabled, shortcut, danger}>>}
 */
export const buildMenuSections = (situation, run, words) => {
  const entries = entryMaker(situation, run, words);
  return situation.kind === 'background'
    ? backgroundSections(situation, run, entries, words.t)
    : itemSections(situation, run, entries, words);
};

/**
 * Whether the inline quick-actions menu offers `id` on `item`, from the same
 * rules as the right-click menu.
 *
 * @param {object|null} item
 * @param {string} id
 * @param {{ locationCanWrite: boolean, locationCanDelete: boolean, canShareHere: boolean }} location
 */
export const quickActionAvailable = (item, id, location) => {
  if (!item) return false;
  if (item.kind === 'volume') return id === 'info' || id === 'copyName';
  switch (id) {
    case 'info':
    case 'copyName':
    case 'copyPath':
    case 'copy':
    case 'download':
      return true;
    case 'cut':
      return location.locationCanWrite && location.locationCanDelete;
    case 'rename':
    case 'compress':
      return location.locationCanWrite;
    case 'share':
      return location.canShareHere;
    case 'favorite':
      return item.kind === 'directory';
    case 'delete':
      return location.locationCanDelete;
    default:
      return false;
  }
};
