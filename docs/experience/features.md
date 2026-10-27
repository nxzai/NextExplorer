# Features

nextExplorer mixes a modern browser experience with secure access controls and filesystem workflows. Here are the standout capabilities available out of the box.

## File browsing & previews

- **Dual views:** Switch between responsive grid, list, and column modes while keeping breadcrumbs, toolbar, and search accessible.
- **A document has an address:** Every document that opens — a photograph, a video, a PDF, a spreadsheet in ONLYOFFICE or Collabora — has a URL of its own, `/open/<path>`. It can be linked to, kept as a bookmark, and opened in a browser tab of its own. Settings → Preferences → **Open documents in a new tab** makes that the default for every kind of file at once, so several stay open while you go on browsing; left off, documents open over the folder as they always have. Closing the tab ends the editing session exactly as closing the panel does, so nothing is left marked as being edited by somebody who has gone.
- **A file that has a history says so:** A small mark on the row, with how many earlier versions there are; clicking it opens the [Versions](/admin/versions) panel. Settings → Preferences → **Mark files that have versions** turns it off. It appears only where the history itself would be shown, so a share that does not hand out histories does not hand out the mark either. Administrators get the other end of it under Settings → **File versions**: every file in the installation that has one, ordered by the space it takes, with the versions deletable from there.
- **Inline previews:** Images, videos, PDFs, and text files preview instantly without downloads. Image/video thumbnails are generated automatically using FFmpeg (`FFMPEG_PATH`/`FFPROBE_PATH` can override binaries).
- **Media gallery:** Pictures and videos open in one viewer and are browsed together — swipe on a touch device, arrow keys or on-screen arrows elsewhere. Pictures zoom by pinch, double-tap or ctrl-wheel; while zoomed, dragging pans the picture instead of turning the page.
- **Subtitles:** A video offers the subtitle tracks inside it and any subtitle files sitting beside it — `film.srt`, `film.fr.srt`, `film.en.forced.srt` — converted to WebVTT and listed in the browser's own captions menu. Blu-ray and DVD subtitles are pictures of words rather than text, so they are not offered; turning those into captions would need OCR.
- **Why a video is silent:** Playback hands the file to the browser and never transcodes — that is a media server's job, not a file explorer's. The consequence used to be invisible: a film whose soundtrack is AC-3, E-AC-3, DTS or TrueHD plays perfectly with no sound in Chrome or Firefox, because those browsers will not decode them. The player now says so, naming the codec, and says the same when the picture itself is one the browser cannot decode — HEVC, most often. Switching between audio tracks appears only in browsers that support it, which today means Safari.

- **Drag-to-move (desktop):** Select one or more items, then drag them onto a destination folder to move them. Hold Alt (Option on macOS) to copy instead, and drop onto a favorite in the sidebar to send items there without navigating.
- **Move to / Copy to:** From the context menu, pick a destination from a dialog that offers your recent destinations and favorites before any browsing. This is the way to move files on a touch device, where dragging is unavailable.
- **Drag-to-upload:** Drop files or folders from your device onto the main pane to upload them.
- **Mobile selection mode:** On touch devices, use **Select** to enable checkbox selection for batch actions.
- **Context menus:** Right-click the background or individual items for quick shortcuts (New Folder/File, Paste, Move to, Rename, Get Info, download, delete).
- **Several files, without an archive:** Downloading more than one thing at once has always meant a zip, and by default it still does. Settings → Preferences → **Downloading several items** changes that to separate files; the arrow beside the download button and the right-click menu offer both ways at any moment, without changing the default. Folders are never taken apart — whichever way is chosen, the selected folders arrive as one archive beside the loose files. Where the browser has a folder picker (Chrome, Edge) you are asked once where to put them and the files are written there with their progress shown; Firefox and Safari have none, so the files go wherever downloads go, with that browser's own permission prompt and its own way of telling two files of the same name apart. Past twenty-five files it asks first, and offers the archive instead. A public link counts the selection as one download, exactly as it counts a zip.
- **Two or three files, compared side by side:** Choose two or three text files in a listing, right-click, and **Compare**. They open at an address of their own — so the comparison lives in a tab, can be linked to, and is somewhere you leave and come back to rather than a dialog to finish. Every line of every file is there, aligned: two versions of a line sit on one row, and a gap shows where a side has nothing. Within a changed pair, the part that actually differs is marked, which is what makes one character different in a long path readable. The differences are counted and numbered, and **F8** and **F7** walk them (alt with the arrows does the same, for a keyboard without those keys), coming round again at the end rather than stopping. Each difference can be **taken across** in either direction, a whole run at once, and the file written back keeps the line endings it had — a comparison that rewrote those would turn a one-line change into a change on every line. Three files align on the **middle** one, which is the arrangement that answers "who changed what" when two people have both edited a common version; copies there go between neighbours, since left and right are not next to each other. A long file folds down to the differences with a little around them and says how much it folded, and that is always yours to unfold. A slim **map of the differences** runs down the right of the comparison: one mark per difference over the whole file, and one click from here to there. **Search and replace** (the magnifying glass) looks in one file, another, or all of them at once, steps through what it finds and replaces one or all — never into a side that is an earlier version. A line can also be changed by hand: **double-click it**, type, press Enter. The two sides can be **put the other way round**, address and tab name with them. And a comparison with lines copied across and not saved says so before you close its tab or the window. A comparison also lives in a tab the way everything else does: the tab is **named after the files it compares**, so three of them open are three tabs you can tell apart, and coming back to one reads neither file again — the lines, the difference you were on and anything you had taken across and not yet saved are all still there. Everything the text editor can open is comparable; `COMPARE_FILE_EXTENSIONS` adds whatever else this installation calls text.
- **A file against its own past:** In the [Versions](/admin/versions) panel, **Compare with the file now** puts an earlier version of a file beside the file as it stands — the older one on the left, which is the order that reads as "what happened since". The version's side is read-only: there is nothing to write a version back to, so lines go out of it and never into it.
- **Tabs:** Off by default, and turned on in Settings → Preferences → **Browse in tabs**. On, a strip above the toolbar holds the places you have open — folders, but also a document, the editor, the trash, the settings — because a tab is an address rather than a folder, and each one keeps what it was on: its listing, what was selected in it, the rename it was in the middle of. The clipboard is deliberately **not** per tab: copying in one and pasting in another is the point. One rule opens anything in a tab behind: **command** on a Mac, **control** elsewhere, held with the gesture that opens the thing — the double click on a row in the listing, the single click on a favourite or a volume in the sidebar or on the home page, and the Enter key on whatever the keyboard is on. On a row the modifier with a _single_ click still adds to the selection, which is worth more than a tab. The middle mouse button says the same thing without a modifier, anywhere. A cross closes a tab, and right-clicking one offers to move it left or right, to duplicate it, to keep it, to close it, or to close the others. Choosing several entries and asking for them in tabs opens a tab for each — the first in front, the rest behind — and stops when the row is full. Tabs can also be dragged along the strip: two folders being compared belong side by side, whichever order they happened to be opened in. What a tab is holding stays alive while another one is in front — an ONLYOFFICE document is not opened again when you come back to it, wherever its tab is dragged to, and the text editor comes back where you left it without reading the file again: what you typed and had not saved, the cursor or the run of text you had selected, and the line you were reading — put back before the editor is shown, so the file does not appear at the top and jump. The file is checked quietly afterwards, and what somebody else wrote to it takes over unless you have unsaved work of your own. A folder tab comes back the same way — its listing is not read again from the server, what was selected is still selected, it is shown the way that folder is shown, and it is where you left it in the folder; the listing is still refreshed, quietly, behind what you were already looking at. The tabs come back when you return; one that was left on a settings page comes back at the volumes rather than reopening it, because nobody was in the middle of anything there — but the tab itself is yours and it is not taken away. A tab shows the icon of the favourite it is inside, for as long as it is inside it — the icons somebody chose to tell four folders apart are worth more than four identical folder icons. The strip never scrolls: tabs share the room and narrow as they go, and the row stops at a number an administrator sets under Settings → **Tabs** (five, ten, fifteen or twenty; ten unless it is changed). A button closes every tab and leaves a new one at the volumes, and Settings → Preferences → **Close a tab by double-clicking it** adds that gesture for whoever wants it. A **kept** tab — pinned from its own menu — sits at the front of the row as its icon alone, has no cross to lose it by, is not swept away by "close every tab", and is there again when you come back. Files and folders dragged from a listing can be dropped **onto a tab**, which moves them into the folder that tab is on, or copies them with the modifier held — the same gesture the favourites in the sidebar already take. A tab opened behind, or reopened with the window, is **got ready before you reach it**: the folder is listed, the document is opened in its viewer, the text file is read and kept for that tab, the shell is started — so arriving at it finds it done instead of starting it, the first time as well as every time after. Settings → Preferences → **Prepare tabs opened in the background** turns that off; a document prepared this way is opened in its editor, so it counts as being edited, and no more than three such editors are ever prepared at once. While a tab is still working — its listing being read, its file fetched, its document server answering — it shows a **spinner where its icon goes**, as a browser does, and its own icon again once it is really there; for ONLYOFFICE that means once the document is in the editor, not merely once the panel exists. And **Back** and **Forward** belong to the tab rather than to the window: each tab keeps its own trail, so going back in one never takes you to what another was looking at, and the buttons grey out when that tab has nowhere to go.

An administrator's terminal belongs to the tab it was opened from. The Terminal entry in the sidebar opens the drawer beside the folder, as it always has — but one per tab now, so several folders can each have a shell running in them, and bringing another tab forward shows that tab's own. The drawer covers what the tab holds and nothing else, so the strip of tabs and the sidebar stay reachable with a shell open, and a shell left running in a tab is still running when you come back to it. A terminal that takes a whole tab is a separate decision, and it is asked for the way everything else is: **command**, **control**, or the middle button on the Terminal entry.

Keyboard shortcuts are not offered, and cannot be: every one a tabbed window would want — ctrl+T, ctrl+W, ctrl+Tab, ctrl+1 — belongs to the browser, which takes it before the page is asked.

- **Quick actions:** An optional inline menu puts the actions you choose on each row, without opening the context menu. Off by default; configure it in Settings → User preferences. **Where the icons sit** is a choice there too: after the name, as they have always been, or aligned at the start or the end of the name column — aligned, they keep the same place on every row, and the room they need is held whether a row is hovered or not, so nothing moves when the pointer arrives.
- **Per-folder sorting:** A folder reopens sorted the way you left it.
- **Folder sizes:** Switched on from **Settings → Folder sizes** (or `FOLDER_SIZE_MODE`), folders show their recursive size — or only the size of their own files — computed in the background and kept up to date as files move.
- **Keyboard navigation:** Move through a folder with the up and down arrows, open with Enter or the right arrow, and go up a level with Backspace or the left arrow.

## Editing, sharing & document workflows

- **Built-in editor:** Double-click any text or code file to edit it inline with syntax highlighting, line numbers, and Save/Cancel actions. Supports 50+ file types by default (txt, md, json, js, ts, py, yml, html, css, and many more). Extend support for additional formats at runtime using the `EDITOR_EXTENSIONS` environment variable—no rebuild required.
- **Link-based sharing:** Use the **Share** button in the toolbar to create share links for any folder or file you can access (including items under **My Files** when personal folders are enabled). Shares can be:
  - **Read-only** or **read/write**.
  - **Anyone with the link** or **specific users**.
  - **Downloadable, or read-only in the stricter sense.** Turning downloads off leaves the share readable while withholding the file itself — the download button is gone and the endpoint refuses. It is deliberately independent of read/write, because "collaborate on this, but do not take a copy home" is a coherent thing to ask for. Shares created before this existed, and any share where it is not set, allow downloads.
  - Optionally **password-protected** and **time-limited** with an expiration date.
    After creation, the dialog shows a friendly label, final URL (based on `PUBLIC_URL` when set), and a one-click **Copy link** button.
- **Guest access to shares:** Public “anyone with the link” shares use short tokens (for example, `/share/aBc123XyZ`) and create a limited **guest session** so visitors can browse just the shared item. Password-protected shares prompt for the password first; user-specific shares redirect to the login screen and apply normal access checks after authentication. The password applies to everyone except the share's owner — being signed in, including as an administrator, is not the same as knowing it. This matters for shares pointing at a personal folder, which no other account can reach any other way. With `AUTH_MODE=disabled` there are no accounts to tell apart and every visitor already browses the whole filesystem, so the prompt is skipped.
- **“Shared with me” view:** The **Shares** section in the sidebar links to a **Shared with me** page showing items other people have shared with you, including status (active/expired), access mode, and last accessed time.
- **ONLYOFFICE integration:** When `ONLYOFFICE_URL` and the JWT `ONLYOFFICE_SECRET` are configured, docx/xlsx/pptx/odt/ods/odp files open for editing via `/api/onlyoffice/*`. Two people opening the same document join the same session and edit it together. The editor follows the app's theme, closes with its own button (saving on the way out), and can rename the open document, save it under a new name, share it, mention other users, compare against another version, and insert files picked from your own storage. Work is saved in the background while the document stays open.
- **New office documents:** The drawer beside **New file** creates a blank Word, Excel or PowerPoint document and opens it straight in the editor.
- **Favorites:** Pin folders to the sidebar with a star so critical paths stay in reach across sessions.

## Search & metadata

- **Smart search:** The search bar finds names and contents inside the current folder and its children, from three characters on. With the search index switched on (**Settings → Search index**, or `SEARCH_INDEX`), both are answered from the index, so a search on a network share costs a query rather than a walk of the storage; without it, ripgrep reads the files (`SEARCH_RIPGREP`, `SEARCH_DEEP`, `SEARCH_MAX_FILESIZE`). Each result says whether its name or its contents matched. The line shown under a content match is read back from the file, a few files at a time and only for the results on the page; on a slow share, those not read within two seconds are listed without their line rather than holding the answer. Names are ranked — the whole name, then a name that begins with the term, then one that holds it — and contents by relevance when the index answers, by folder otherwise, so that a folder's files arrive together. A search that ran out of time says so, rather than passing a short list off as the whole answer, and an accented name is found however the machine that wrote it encoded the accent.
- **Filename patterns:** `*` and `?` in a search term match filenames rather than text — `*.ps1` finds the scripts, `conf?g.json` finds either spelling, and `Stacks/*/logs/*.log` reaches across folders. A pattern names a shape, so nothing is read inside files for it, which is also what makes it immediate.
- **Inside documents:** Word, Excel and PowerPoint files are archives of XML and PDFs keep their words in compressed streams, so a plain content search finds nothing in either. Their text is read and searched — including a word an author emphasised halfway through, which Word stores in pieces. A scanned PDF is a picture of a page and stays unsearchable: that would need OCR.
- **Metadata overlays:** List view shows size, kind, modified date, owner, and volume stats (volume usage visibility flips on with `SHOW_VOLUME_USAGE`).
- **Thumbnail cache:** `/cache` holds thumbnails, RAW previews and search indexes that regenerate when cleared; thumbnails and previews are kept within their limits (`THUMBNAIL_CACHE_MAX_FILES`, `RAW_PREVIEW_CACHE_MAX_FILES`).

## Access & security

- **Local users & groups:** Create local accounts from Settings → Admin; the first account becomes admin and can’t be removed while others exist.
- **Passkeys:** Any local account can add one in Settings → Passkeys, and sign in with a fingerprint, a face or the device's PIN instead of a password. The key stays on the device and what it signs names this site, so it cannot be phished, watched or replayed. A passkey that was unlocked to be used answers the second factor as well; one that was not still asks for the code. Browsers only allow this on a secure page served from a hostname, which the page says when it cannot be offered.
- **Two-factor authentication:** Any local account can turn on a second factor in Settings → Two-factor — a QR code for any authenticator app, a code to confirm the phone kept the secret, and ten recovery codes shown once. Signing in then asks for a code after the password; six digits are worth one sign-in, and a recovery code one use. With OIDC the second factor is the provider's.
- **OIDC SSO:** Express OpenID Connect exposes `/login`, `/logout`, and `/callback`, so you can federate with Keycloak, Authentik, Authelia, or any compliant provider. Admin elevation happens when the IdP groups/roles intersect `OIDC_ADMIN_GROUPS`.
- **Per-user access control:** Grant or deny paths per user or group, with read, write and delete kept apart. Personal folders (`USER_DIR_ENABLED`) and per-user volumes build on the same rules.
- **Secrets from files:** Every credential can be read from a file instead of the environment, so nothing sensitive appears in `docker inspect`. See [Secrets](/configuration/environment#secrets).
- **Workspace lock:** A workspace password (set on first run) gates access, and admin-only sections (Files & Thumbnails, Security, Access Control, Admin Users) appear only when your role allows it.

## Operational helpers

- **The language you read in:** The interface follows the browser, which is right for most people and wrong for anybody whose browser is not in their language — a shared machine, a company image, a second account. Settings → Preferences → **Language** chooses one for the account, so it travels with you to whichever browser you sign in from; left on _Follow the browser_, nothing changes. The globe on the sign-in page still chooses a language for that browser, which is the one thing an account cannot do before anybody has signed in.
- **Resizeable sidebar:** The sidebar can be dragged to different widths for wide or narrow monitors.
- **Notifications & transfers:** A floating panel tracks uploads, copies, moves and archive work, with pause, resume and cancel, the transfer rate, and per-file detail when several run at once.
- **Chunked uploads:** Large files can be uploaded in resumable chunks (`UPLOAD_CHUNKED_ENABLED`), which survives a dropped connection and gets past reverse proxies that refuse large bodies — a fallback switches to chunks automatically when one does. Once the transfer ends, the server may still be writing the file into place; that phase is reported separately rather than appearing to stall at 100%, and a file that arrived but could not be put in its folder is reported as a failure, with the reason, never as done.
- **Cancellable file operations:** Copy and move run natively with real progress and can be stopped mid-way, leaving nothing half-written.
- **Nothing is ever replaced:** A copy, a move, an upload, an extraction, a new archive, a new folder, a Save as, a copy of a version or a restore from the trash takes the name it asks for only when nothing holds it — even something that arrives while it runs — and otherwise takes “name (1)”, or “name 2” for a new folder. It never replaces a file and never pours into a folder that is already there, and undoing one that failed removes only what it wrote itself: a file someone saved in the meantime stays.
- **Keyboard shortcuts:** ⌘/Ctrl+C/X/V for clipboard actions, plus quick navigation via breadcrumbs and toolbar icons.

- **Activity log:** Off unless an administrator turns it on, in Settings → Activity log. On, it writes down who signed in — including who tried and failed — what was downloaded, uploaded, deleted, restored and removed for good, what left through which share link and what arrived through one, every change to a password, a second factor or a passkey, and every account or setting an administrator changed. Administrators read it, and it keeps each line for as long as the retention says.

## How it compares

Two projects solve the same problem from a different angle:
[FileBrowser Quantum](https://github.com/gtsteffaniak/filebrowser), the active
fork of File Browser, and [Filestash](https://www.filestash.app/), which speaks
every storage protocol there is. Every cell below was read on **16 September
2026** from the project it describes — its repository, its documentation, its
pricing page — rather than from anybody's marketing or anybody's comparison
chart. The sources are listed underneath, including the ones about NextExplorer.

✅ shipped · 🚧 announced by that project as coming · ❌ not offered · 💰 paid
tier · — not documented

### The project

|                                   | **NextExplorer 3.7** | **FileBrowser Quantum** | **Filestash**                                   |
| --------------------------------- | -------------------- | ----------------------- | ----------------------------------------------- |
| Licence                           | GPL-3.0              | Apache-2.0              | AGPL-3.0 (core)                                 |
| Price                             | Free                 | Free                    | Free — Pro from $50/mo, Enterprise from $290/mo |
| Interface languages               | 15                   | 26                      | —                                               |
| Docker image, amd64 and arm64     | ✅                   | ✅                      | ✅                                              |
| Official installer outside Docker | ✅ Linux archive     | ✅                      | 💰                                              |

### Archives, without unpacking them

|                                   | **NextExplorer 3.7**               | **FileBrowser Quantum** | **Filestash**    |
| --------------------------------- | ---------------------------------- | ----------------------- | ---------------- |
| Browse one like a folder          | ✅ zip, 7z, rar, iso, tar, tar.gz… | 🚧                      | ✅ viewer plugin |
| Read a file inside one            | ✅ text, Markdown, images          | 🚧                      | ✅ viewer plugin |
| Take one entry — or several — out | ✅ into any folder you pick        | ❌                      | ❌               |
| Compress a selection              | ✅                                 | ✅                      | ❌               |

### Getting data in and out

|                                | **NextExplorer 3.7**          | **FileBrowser Quantum** | **Filestash** |
| ------------------------------ | ----------------------------- | ----------------------- | ------------- |
| Chunked, resumable uploads     | ✅                            | ✅                      | ✅            |
| Upload a whole folder          | ✅                            | ✅                      | ✅            |
| Never replaces a file silently | ✅ “name (1)”, and it says so | —                       | —             |

### When something goes wrong

|                                               | **NextExplorer 3.7**        | **FileBrowser Quantum** | **Filestash** |
| --------------------------------------------- | --------------------------- | ----------------------- | ------------- |
| Trash, with restore                           | ✅                          | 🚧                      | ❌            |
| Restore part of a deleted folder              | ✅                          | ❌                      | ❌            |
| Earlier versions of a file                    | ✅                          | ❌                      | 💰 Enterprise |
| Versions from the office editors' own history | ✅ ONLYOFFICE and Collabora | ❌                      | ❌            |

### Finding things

|                                      | **NextExplorer 3.7**             | **FileBrowser Quantum** | **Filestash** |
| ------------------------------------ | -------------------------------- | ----------------------- | ------------- |
| Search by name, indexed, as you type | ✅                               | ✅                      | ✅            |
| Search inside file contents          | ✅ Office documents and PDFs too | ❌                      | ✅            |

### Viewing and editing

|                                         | **NextExplorer 3.7**      | **FileBrowser Quantum** | **Filestash** |
| --------------------------------------- | ------------------------- | ----------------------- | ------------- |
| Images, video and audio, in the browser | ✅                        | ✅                      | ✅            |
| Office documents                        | ✅ ONLYOFFICE / Collabora | ✅                      | ✅            |
| Text and code editor                    | ✅                        | ✅                      | ✅            |
| Folder sizes in the listing             | ✅                        | ✅                      | —             |

### Who gets in

|                                         | **NextExplorer 3.7**                 | **FileBrowser Quantum** | **Filestash** |
| --------------------------------------- | ------------------------------------ | ----------------------- | ------------- |
| Local accounts                          | ✅                                   | ✅                      | ✅            |
| OIDC single sign-on                     | ✅                                   | ✅                      | 💰 Enterprise |
| LDAP sign-on                            | ❌                                   | ✅                      | 💰 Enterprise |
| Second factor from an authenticator app | ✅ with recovery codes               | ✅                      | 💰 Enterprise |
| Passkeys (WebAuthn)                     | ✅ and they answer the second factor | ✅                      | 💰 Enterprise |
| Brute force on the sign-in              | ✅ account lockout                   | ✅ rate limiting        | —             |
| Access rules per path                   | ✅ read, write and delete apart      | ✅                      | 💰 RBAC       |

### Sharing

|                                     | **NextExplorer 3.7** | **FileBrowser Quantum** | **Filestash** |
| ----------------------------------- | -------------------- | ----------------------- | ------------- |
| Links with a password and an expiry | ✅                   | ✅                      | ✅            |
| Per-operation permissions on a link | ✅                   | ✅                      | ✅            |
| Guests can upload into a share      | ✅                   | ✅                      | ✅            |

### Running it

|                                     | **NextExplorer 3.7**        | **FileBrowser Quantum** | **Filestash**         |
| ----------------------------------- | --------------------------- | ----------------------- | --------------------- |
| WebDAV                              | ❌ by choice                | ✅                      | ✅                    |
| Storage beyond the local filesystem | ❌ by choice                | ❌                      | ✅ about 25 protocols |
| API tokens for scripts              | ✅ read-only or read-write  | ✅                      | ✅                    |
| Activity log                        | ✅ optional, off by default | ✅                      | 💰                    |
| Space quotas                        | 🚧                          | 🚧                      | 💰                    |
| Terminal in the browser             | ✅ switchable               | ❌ removed deliberately | ❌                    |

### Where each answer comes from

- **NextExplorer**: the pages on this site — [archives](/experience/workflows),
  [trash](/admin/trash), [file versions](/admin/versions),
  [search](/experience/features), [two-factor, passkeys and
  access](/admin/guide) — and the suites in the repository. The 🚧 are recorded
  in `TODO.md` with what each would take; they are intentions, not dates. The ❌
  are honest: there is no LDAP here, and the two marked _by choice_ are settled
  positions rather than a backlog nobody got to.
- **FileBrowser Quantum**: its [README](https://github.com/gtsteffaniak/filebrowser)
  states OIDC, LDAP, JWT, password + 2FA and proxy sign-in, WebDAV, folder
  sizes, API tokens, granular permissions, share expiry and permissions, and
  that shell commands were removed on purpose. Its own comparison chart is
  where trash, quotas and browsing archives are marked as coming, and
  content-aware search as absent. In its source: chunked uploads, TOTP,
  WebAuthn passkeys, rate limiting on the auth routes, archive creation as zip
  or tar.gz, and twenty-six interface languages — and no extraction from an
  archive, and nothing about versioning.
- **Filestash**: its [pricing page](https://www.filestash.app/pricing/) is
  where free ends and paid begins — the self-hosted Hobby edition is AGPL and
  free, Pro starts at $50/month, Enterprise at $290/month. In its own feature
  table, OIDC, SAML, LDAP sign-on, MFA, RBAC and versioning are Enterprise;
  quotas and the audit journal are Pro; resumable uploads, shared links, the
  editors and Docker are free, and the Debian and RHEL installers are not. Its
  [README](https://github.com/mickael-kerjean/filestash) is the source for the
  storage protocols and the viewer plugin that opens `tar`, `tgz` and `zip`.
  Nothing in either describes a trash or an extraction.
- **The original [File Browser](https://github.com/filebrowser/filebrowser)**
  is left out: its README says it was archived on 1 September 2026, that there
  will be no further releases, and that two classes of security issue — the
  command runner, and sessions that are self-contained JWTs and therefore
  cannot be revoked — will not be fixed. Quantum is its active fork, and stands
  in the table instead.

### Installing it without Docker

That row was a cross until 3.8.0, and what turned it is
[an archive](/installation/standalone) rather than a single binary: the Node
runtime and the official 7-Zip build travel in it, an install script makes the
account, the directories and the systemd service, and the same script is the
update path. Quantum's ✅ is one static Go binary, which is a property of its
language rather than a difference in effort — Node cannot embed the three
native modules in this tree. What the request behind it asked for, which was
not being made to install Docker, is answered.

### API tokens

That row was a 🚧 until a script had a credential of its own. A token is issued
from the settings of the account it belongs to, shown once and stored hashed,
and revoked on its own without disturbing the account or the other tokens. It
is deliberately **less** than the account: a read-only token reaches `GET` and
nothing that changes anything, and no token at all — whatever its scope, and
even when its owner is an administrator — reaches the account's own settings,
any administrative route, or the terminal. [Driving the API](/reference/api) has
the whole of it.

### The intention left, and the two crosses that stay

Space quotas are what the comparison still says is missing here, and it is in
the backlog with the shape it would take: the recursive folder-size index
already counts what a quota would hold people to; what it needs is a decision
about what a quota applies to, and one place where a write is refused rather
than ten. The activity log and the API tokens that were here beside it are
done — see [Admin & Access](/admin/guide).

WebDAV is a cross rather than a 🚧, and stays one. NextExplorer is a file
browser, not a server: something you open and use, not something other software
mounts. A protocol is a second permanent way in — its own way of proving who is
asking, its own locks, its own clients writing whenever they like — on top of a
filesystem this already reaches, and every rule about who may read, write or
delete a path would have to hold on that side too. What is mounted into the
container is what this browses, the way a drive is a volume in Windows Explorer:
an NFS or SMB share mounted on the host is already here, without this project
speaking a protocol of its own. Twenty-five storage protocols are a cross for
the same reason from the other end: that is Filestash's ground, and arriving
second on it would cost the thing this does well, which is knowing one
filesystem deeply.
