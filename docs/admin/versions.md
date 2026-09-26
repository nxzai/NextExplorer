# File versions

Saving over a file keeps what the save replaces as a version. Earlier versions can be listed, opened, downloaded, restored, taken out as a copy or put over another file, named, pinned and deleted from the **Versions** panel — right-click a file, or open its details.

A file that has versions carries a small mark in the folder listing, with how many; clicking it opens the panel. It is on by default and each person can turn it off under **Settings → Preferences → Mark files that have versions**. It appears only where its file's history would be shown anyway, so a share that does not hand out histories does not hand out the mark either.

## What is kept

- **Every save through NextExplorer.** The text editor, the editor opened through a share link, ONLYOFFICE and Collabora all keep the content they replace. A file changed outside NextExplorer — over SMB, by a script — keeps its history, but those changes leave no version: nothing saw them happen.
- **No copy, ever.** The content a save replaces is moved into the volume's hidden `.nextexplorer` folder, the same zone the [trash](/admin/trash) uses, and the new content takes its place in one rename. Saving a 2 GB file does not need 2 GB of free space for its version.
- **The same content once.** A save that changes nothing keeps nothing, and content identical to the latest version is not kept twice.
- **One version per office editing session.** ONLYOFFICE and Collabora save on their own every few seconds while someone types; kept one by one, those saves would fill a volume with near copies of the same document. What is kept is the document as it was before the session, a save someone asked for (the editor's Save, closing the document), and, in a long session, a checkpoint at most every 10 minutes.
- **Crash-safe.** A save writes what it is about to do before it touches the disk. After a crash or a power cut, the next start either finishes the save or puts the file back as it was.

## Thinning

Versions are thinned out as they age, so a file edited every day keeps a useful history without keeping every save:

| Age            | Kept                    |
| -------------- | ----------------------- |
| up to 24 hours | every version           |
| up to 7 days   | the newest of each hour |
| up to 30 days  | the newest of each day  |
| older          | the newest of each week |

A file keeps at most 50 versions. The tiers and the limit are set under **Settings → Trash and versions**.

**Pinned** versions escape the thinning and the per-file limit. Pin a version to keep it — the one sent to a client, the one before a large rewrite — and give it a name so it is easy to find.

## Space

Versions and the trash share each volume's reserved space (`TRASH_MAX_PERCENT` and `TRASH_MAX_SIZE`). When that space runs short, or the volume falls below the upload reserve, what goes first is what matters least:

1. versions that are not the latest of their file, oldest first;
2. items in the trash, oldest first;
3. the latest version of each file;
4. pinned versions, last.

A version larger than the whole reserved space is not kept, and the zone's journal says so. Every version removed early is recorded in the journal too.

Versions and the trash are switched on and off separately: versions can be kept without a trash, and the other way round.

## Restoring

- **Restore** puts the file back as the version had it. The content it replaces becomes a version like any other save, and the restored version stays in the history: nothing is lost by restoring the wrong one.
- **Restore as a copy…** writes the version as a new file in a folder you choose, named after the file and the version's date.
- **Replace another file…** puts the version over an existing file you choose; that file's own content becomes one of its versions.
- **Download** saves the version without restoring anything.
- **Open read-only** shows a text file's version in the editor, and a document's in ONLYOFFICE or Collabora. Nothing can be saved from it.

An editor that was already open on the file when it was restored still holds what the restore replaced. Its next save does not undo the restore: it is set aside as a version marked **Set aside**, from which it can be restored in turn.

## Inside the office editors

- **ONLYOFFICE**: the editor's **History** shows the document's versions. Click one to see it; **Restore** is offered to whoever may change the document and works like a restore from the panel.
- **Collabora**: **File → Revision history** opens the Versions panel over the document. A restore made there reopens the document in the editor.

## Who may do what

- **See** a file's history: whoever may read the file.
- **Download** a version, or take it out as a copy or over another file: whoever may also download the file.
- **Restore**, **name** or **pin** a version: whoever may change the file.
- **Delete** versions: whoever may delete the file. Deleting versions is permanent; **Delete all** includes pinned versions. The file itself stays.

### Through a share

A share's owner decides what it shows of its files' history, with two options in the share dialog:

- **Show file versions** — visitors see the history, and may restore versions if the share lets them edit;
- **Allow downloading versions** — visitors may also download versions or take them out as copies. It needs the history to be shown.

Both are on for a new share with named people, who could see the history anyway, and off for a link for anyone. Shares with named people made before versions existed have both switched on.

## Following the file

- **Renamed or moved** in NextExplorer, a file keeps its history, to another disk included.
- **Copied**, the copy starts with no history.
- **Sent to the trash**, a file takes its history with it, and gets it back when restored.
- **Deleted for good** — from the trash, at the end of its retention, or straight away — a file's versions go with it.
- **Deleted outside NextExplorer**, a file's history is kept for the trash retention, in case the file comes back to the same place, then removed.

## Settings → File versions

Every file in the installation that has a history, in one list, for administrators. The panel answers "what happened to this file"; this answers "where has the space gone", which no path can be asked about — a file deleted outside NextExplorer leaves its versions behind, and those are the histories least likely to be found by looking.

Each row gives the file, the space it is in, how many versions it has and what they hold, and the date of the most recent. The list is ordered by space used by default, and can be searched by path, narrowed to one space, and narrowed by what became of the file:

- **Present** — the file is still there;
- **In the trash** — it was deleted and can still be restored, its history with it;
- **Gone** — it disappeared outside NextExplorer, and its versions are the only copy left. They are kept for the trash retention in case it comes back.

Open a row to see its versions, and delete any of them, or the whole history, from there. Deleting is permanent and includes pinned versions; the file itself is never touched. When a history whose file is gone loses its last version, its entry goes too.

This list shows paths from every space, personal folders included — which no account can otherwise see of another. That is why the page is for administrators only, and why deleting from it is not something to do on somebody else's behalf without telling them.

## Settings → Trash and versions

Administrators can switch versions on or off, set the thinning tiers, the most versions per file and the office checkpoint. Switched off, saves keep nothing new; the versions already kept stay until they are thinned out, removed for space or deleted. The defaults come from [environment variables](/configuration/environment#file-versions).

Each volume shows how many versions it holds and how much space they take, counted with the trash in its usage bar.

## Backups

Versions live in `.nextexplorer/versions` inside each volume, so a backup of the volume includes them. Exclude `.nextexplorer/` from backups if you do not want to back up versions and deleted items.
