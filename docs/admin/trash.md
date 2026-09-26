# Trash

Deleting a file or folder moves it to the trash instead of removing it. It stays there for a retention period (30 days by default), can be restored from the **Trash** page in the sidebar, and is then removed for good.

## How it works

- **No copy, ever.** Each volume keeps its trash in a hidden `.nextexplorer` folder at its root. Deleting is a rename on the same disk: a 40 GB folder goes to the trash as fast as a small file, and needs no free space to do so. Personal folders and volumes assigned to users outside `VOLUME_ROOT` have their own `.nextexplorer` folder the same way.
- **Nobody browses the zone.** The `.nextexplorer` folder never appears in listings or search, whatever the hidden-file settings say, and no path through it can be opened, downloaded or shared. Nothing can be named `.nextexplorer`.
- **Shares go at once.** A share pointing at a deleted item is removed when the item goes to the trash, as before: nothing in the trash stays public. Restoring does not bring shares back.
- **Crash-safe.** Every operation writes what it is about to do before it touches the disk. After a crash or a power cut, the next start finishes or undoes whatever was interrupted. Content found in a zone without a record — a database restored from an older backup — is adopted rather than deleted; each item carries a small description beside it for that purpose.

## Who sees what

- Each person sees what they deleted, and what came from their own personal folder or from shares they own.
- Administrators see everything.
- Share visitors have no trash: what they delete through a share link goes to the share owner's trash.
- Restoring puts an item back where it was. A parent folder that no longer exists is recreated; a name that is now taken gets a suffix, like a copy. Someone who has lost write access to the original location since the deletion cannot restore into it — an administrator can.

## Acting on an item

Right-click an item on the **Trash** page — or hold it on a touch screen, or press the menu key on its checkbox — for what can be done with it: open a deleted folder, preview a file, restore it where it was, open its original location, or delete it for good. With several items selected, the menu acts on all of them. A double click opens a deleted folder, or previews a file.

**Preview** shows a text file — plain text, Markdown, scripts, code: the extensions the editor opens — in the editor, **read only**: nothing can be typed, there is no Save, and Close goes back to the trash. The file is read with the editor's limits, so a file that is too large, or not text, is not shown. Nothing in the trash can be changed this way.

## Restoring part of a deleted folder

A deleted folder is one item in the trash, however much it holds. Click its name on the **Trash** page to open it, go further in if needed, select what you want back, and **Restore**: each selected file or folder goes back to its own place inside the original folder, and the rest stays in the trash. **Restore whole folder** puts back everything that is left.

- Nothing extra is recorded for what is inside a folder. The folder's own record gives its original path, and an entry at `drafts/v2.txt` inside it goes back to `<original path>/drafts/v2.txt`.
- The original folder and the folders on the way are recreated if they are gone. What exists there now is never replaced: a name that is taken gets a suffix, as for a whole item.
- Whoever may restore the folder may restore what is inside it, under the same conditions.
- A symbolic link inside a deleted folder is listed and restored as the link it is; nothing is ever opened through it. A restore is refused when the place it would go back to now leads outside the volume through a link.

## Share links

- When shared content goes to the trash, its share links — and those of anything inside a deleted folder — stop working at once: nothing in the trash stays public. The delete dialog says so beforehand. The links are kept with the item.
- When it is restored, you choose: **Restore the share links** brings them back as they were — same link, password, expiry, permitted people and label — or **Delete the share links** lets them go. Without a choice, they are deleted.
- A share link that expired while in the trash, or whose owner no longer exists, cannot come back.
- Deleted for good — from the trash, by emptying it, at the end of its retention, or straight away — an item takes its share links with it for good.
- Visits opened through a link are not kept: whoever had it open opens it again.

## What a restore keeps

Deleting and restoring on the same disk are renames: a file or folder comes back with its owner, permissions, ACLs, extended attributes and modification times as they were. A copy to another disk goes through the same copy as a transfer: in the container, `rsync` keeps permissions and modification times, and the copied files belong to the user the application runs as.

Some things do not come back:

- a folder recreated on the way back, because it no longer existed, is new, with the permissions the application gives new folders;
- the favorites pointing at an item are forgotten when it goes to the trash, and a restore does not bring them back. Share links are the exception: see [Share links](#share-links).

Access rules and assigned volumes are set on paths, not on items, so they apply again as soon as an item is back under the path they name.

## When an item cannot go to the trash

The delete dialog says, before anyone confirms, which items would be removed for good and why:

- the item is on **another disk** than its volume's trash (a network share or a separate mount inside a volume);
- it is **larger than the whole trash** of its volume;
- it is **a volume itself**, which cannot go into its own trash.

A folder's size is only known once it is measured, during the deletion. If it turns out too large then, it is left where it is and the person is asked again. A deletion is never permanent without the person having been told.

The dialog also offers **Delete permanently** to skip the trash on purpose.

## Space and retention

The trash of each volume may hold at most a share of the volume (10% by default), optionally capped by a size. [File versions](/admin/versions) are kept in the same space, and counted with the trash. A maintenance pass runs at startup, every hour, and shortly after deletions:

1. items past their retention are removed for good, whatever the space;
2. while the space is over its budget, or the volume is below the upload reserve (`UPLOAD_STORAGE_RESERVE`), what matters least goes first: versions that are not the latest of their file, then the oldest items in the trash, then the latest version of each file, and pinned versions last.

Before an upload is refused for lack of space, the destination volume gives back that space in the same order — but only when that is enough for the upload to fit.

Every early removal (before the retention), recovery or failure is recorded in the zone's journal, shown in **Settings → Trash and versions**.

## Settings → Trash and versions

Administrators can:

- switch the trash on or off, and set the retention and the size limits (the defaults come from [environment variables](/configuration/environment#trash)); versions are switched on and off, and thinned, in their own section — see [File versions](/admin/versions#settings-trash-and-versions);
- see, for each volume, what its trash holds, its budget, and what the last maintenance did;
- **Verify** that every zone's records and files agree;
- **Run maintenance now**.

A zone whose disk is not mounted, or has been replaced by another one, is shown as unavailable and left untouched: an unmounted disk and an emptied trash look the same from a path, and nextExplorer never removes records on that basis. An administrator who knows the disk is gone for good can delete those items from the Trash page to forget them.

## Backups

The `.nextexplorer` folder is inside each volume, so a backup of the volume includes the trash. Exclude `.nextexplorer/` from backups if you do not want to back up deleted items.
