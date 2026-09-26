# User Workflows

These are the day-to-day actions your team will take in nextExplorer. Every workflow assumes you’re authenticated and have access to the volumes you mounted under `/mnt`.

## Navigating volumes

1. Click a volume in the sidebar to list its contents in the main area.
2. Use breadcrumbs to back out of nested folders, or click the breadcrumb anchor to jump to any ancestor.
3. Switch between grid/list views with the toolbar toggles; list view shows sortable columns for Name, Size, Kind, and Date Modified.

## File & folder operations

- **Create a folder/file:** Use the `Create` menu, context menu (right-click background → New Folder/File), or press the `+` toolbar button. A new folder takes “Untitled Folder 2” when the name is taken, even by one created at the same moment.
- **Rename:** Right-click an item and choose Rename or use F2 key to rename.
- **Move (desktop drag-and-drop):** Select one or more items (Ctrl/⌘-click, Shift-click, or drag a selection rectangle), then drag any selected item onto a destination folder and drop to move everything selected. Hold Alt (Option on macOS) while dropping to copy instead, and drop onto a favorite in the sidebar to send items there without navigating to it.
- **Move to / Copy to:** Right-click a selection and choose **Move to** or **Copy to**. The dialog lists the destinations you have used recently, then your favorites, then the storage to browse; destinations that cannot work — the root, a folder inside itself — are refused before the transfer rather than after. What is copied or moved never replaces a file or merges into a folder already at the destination, including one that appears during the transfer: it takes “name (1)”. Nothing appears under the name until a copy is whole; a cancelled copy leaves nothing behind, and what someone put in the destination meanwhile stays. A symbolic link is copied as a link, not as what it points to, whichever engine copies it; one that leaves its volume is shown as such and opens nothing.
- **Move (touch devices):** Drag-and-drop is disabled on touch devices, so use **Move to** from the item menu (long-press to open it). Cut → Paste still works if you prefer it.
- **Delete:** The context menu’s Delete option (or toolbar action) prompts for confirmation and supports multi-select deletions.
- **Clipboard shortcuts:** ⌘/Ctrl+C/X/V work just like desktop file managers and respect Access Control rules (read-only folders can’t be written).
- **Mobile multi-select (checkboxes):** Tap **Select** in the toolbar to enter selection mode, then tap items to toggle selection without opening them; tap **Done** to exit (selection clears on exit). Long-press opens the item menu.

## Uploads & downloads

- **Drag-and-drop upload:** Drop files/folders from your device onto the main pane to upload; the floating footer upload panel shows per-file and total progress. An upload never replaces a file already there, even one that arrives while it is sent: it takes “name (1)”.
- **Create menu upload:** Select Upload files/folders from the Create menu if you prefer a dialog.
- **Download:** Select one or more items and hit the Download button; multiple items or folders produce a ZIP archive.
- **Transfer control:** Pause, resume, or cancel uploads directly from the footer panel, which also shows the current rate. With several files in flight, the summary adds them up and expanding the list gives each file its own figure.
- **Large files:** With chunked uploads enabled, a transfer resumes from where it stopped rather than starting over, and gets past reverse proxies that reject large bodies. Once every byte is sent, the server may still be writing the file into place — that phase is shown separately, so a long copy is not mistaken for a stalled upload. If the file cannot be put in its folder, the upload fails with the server’s reason instead of showing as done.

## Search

- Click the search icon in the toolbar, type a query, and press Enter.
- Search covers filenames and file contents thanks to ripgrep; disable deep search with `SEARCH_DEEP=false` if you want faster scans.
- Large files respect `SEARCH_MAX_FILESIZE`; if ripgrep isn’t available, the app falls back to a built-in indexer that still searches filenames.
- Type `*` or `?` to search by filename shape rather than by text: `*.ps1` for the scripts, `*.xlsx` for the spreadsheets. A pattern is matched against the whole name, so `*.ps1` does not return `deploy.ps1.bak`.
- With `SEARCH_INDEX` on, content searches are answered from the index rather than by reading the volume, and a search names any folder it did not have time to finish looking through.

## Previews & editing

- **Preview:** Click images/videos/PDFs to open them inside the app (previews are cached in `/cache`).
- **Editor:** Double-click text/code files to open the inline editor with syntax highlighting, line numbers, and Save/Cancel actions. The editor supports 50+ file types by default including common text formats (txt, md, log), data files (json, yaml, xml, csv), programming languages (js, ts, py, java, go, rust, etc.), config files (ini, env, properties), shell scripts (sh, bash, ps1), and web formats (html, css, scss, vue). Add support for custom file types (e.g., `.toml`, `.proto`, `.graphql`) at runtime using the `EDITOR_EXTENSIONS` environment variable—no rebuild needed, changes apply on container restart.
- **ONLYOFFICE:** When configured, office documents (DOCX, XLSX, PPTX, ODT, ODS, ODP) launch in the embedded ONLYOFFICE editor; nextExplorer signs requests with `ONLYOFFICE_SECRET` and calls `/api/onlyoffice/config`, `/api/onlyoffice/file`, and `/api/onlyoffice/callback` to orchestrate editing. Leaving the document — closing the panel, or closing the browser tab it was opened in — calls `/api/onlyoffice/session-end`, which asks Document Server for one last save and then lets the editing session go. One route for both, because a tab being closed has time for exactly one request and the two have to leave the server in the same state.
- **Inside an archive:** Open a zip, 7z, rar, iso or tar to see what is in it without extracting anything, listed the way a folder is. Folders open, the trail at the top walks back, and every row offers two things: take this one file out onto the volume, or download it. The rest of the archive is never unpacked. Which formats open is the same list the Extract action offers, and it depends on the 7-Zip the image was built with.
  - **Reading one, without taking it out:** the name of an entry the panel can show is a link — text and code, Markdown, and the images a browser decodes on its own (JPEG, PNG, GIF, WebP, BMP, SVG, ICO, AVIF). It opens in the same window, with the file as the last step of the trail and the folder it is in as the way back. A camera's raw file and a HEIC are not offered: what is shown here comes straight out of the archive, and nothing converts it on the way. Text stops at 2 MB and an image at 32 MB — past that the panel says the size and leaves downloading or extracting as the way to open it.
  - **Extract here** puts that entry — a file, or a folder with everything under it — in the folder the archive is in. Nothing is ever replaced: a name already held becomes “name (1)”, and the panel says which name it landed under.
  - **Several at once, and somewhere else:** every row has a tick box, and the box in the column header takes everything at this level. What is ticked goes out in one request — **Extract here** for the folder the archive is in, or **Extract to…** for the same “Move to” dialog the rest of the application uses, opened on that folder. Ticks are forgotten when another folder is opened, and once what was ticked has come out.
  - A `.tar.gz` and its family (`.tbz2`, `.txz`, `.tar.zst`) are two archives, so the tar inside is decompressed once into `CACHE_DIR/archives` and read from there. Past a certain size the answer is to extract the archive instead.
  - A solid `.7z` — one where every file went into a single compressed stream — is read the same way until somebody reads a second entry from it. At that point it is extracted once into `CACHE_DIR/archives` and every read after it comes from there: measured on a real 7-Zip, reading ten entries one at a time costs five times what extracting the whole archive costs, and the second read costs about the same either way. Nothing is extracted for a first read, or for an archive past that size; what is kept shares the cache's budget and is swept the same way.
  - An archive whose table of contents is itself password-protected says so rather than opening empty; entries whose contents are encrypted are listed but not handed over. Extraction is where a password is asked for.
  - An archive can hold names that point outside itself. Those are never shown as a place inside it, and the panel says how many were left out.

## Sharing items

- **Create a share link:** Select a single file or folder in any browse view (including **My Files** when personal folders are enabled) and click the **Share** button in the toolbar. Configure access mode (read-only vs read/write), choose whether the link is open to **anyone with the link** or restricted to **specific users**, optionally set a password and expiration date, optionally withhold downloads so the share can be read but not copied, then create the link and copy it from the success screen.
- **Open a share link as a guest:** Visitors open URLs like `https://files.example.com/share/aBc123XyZ`. The Share access page shows basic information (label, type, expiration) and either auto-opens the shared item, prompts for a password, or redirects to the login page for user-specific shares. Guest sessions are limited so they can only browse within the shared item.
- **Review items shared with you:** Use the **Shares → Shared with me** entry in the sidebar to see folders/files other users have shared with your account, filter by status (active/expired), and click into a share to open it in the normal browser view.

## Favorites & quick access

- Highlight a folder and click the star toolbar icon (or use the context menu) to pin it as a Favorite.
- Favorites appear above Volumes in the sidebar for instant navigation; you can customize icons to reflect project types.

## Access control & admin actions

- **Access Control rules:** Settings → Access Control defines per-folder policies (`rw`, `ro`, `hidden`). The first matched rule applies.
- **Hidden folders:** Use `hidden` to keep a folder out of listings _and_ refuse it when asked for by name — it is a denial, not a cosmetic filter. This page used to say the opposite, which would have talked an administrator out of the one control that stops a path being read.
- **Admin users:** Settings → Admin lets you add local users, reset passwords, and grant the admin role. Demoting an admin via UI is disabled to avoid lockouts.
- **Changing a password:** Settings → Password changes your own. Every other session of your account is signed out — another browser, another device, anyone who had the old password — and the one you changed it from stays signed in. A reset by an administrator signs the account out everywhere.
- **Sign-out:** Use the user menu in the sidebar to log out or manage user-specific settings.
