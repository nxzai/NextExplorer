# Admin & Access Guide

Administrators control users, folders, and security policies through Settings. This guide walks through the workflows for onboarding admins, managing users, configuring access control, and ensuring data stays protected.

## First admin & workspace lock

- During first launch (after you run your Compose file) the Setup screen appears automatically. Create your first local user account and workspace password.
- That account becomes an admin automatically; the backend prevents removing or demoting the final admin.
- The workspace password protects the UI until a user unlocks it. Trusted sessions may remember the password for a short time depending on your session settings.

## User management

- Navigate to **Settings → Admin → Users** to add local users, assign roles, and reset passwords.
- Resetting a password signs that account out of every session it has open, on
  every device — the sessions opened with a password and the ones opened through
  the identity provider alike. Someone changing their own password from
  **Settings → Password** is signed out everywhere except where they made the
  change. A changed `AUTH_ADMIN_PASSWORD` does the same to the administrator at
  the next start; the same value set again at each restart signs nobody out.
- One thing a password change does **not** end: the tokens already handed to
  ONLYOFFICE and Collabora for documents open at that moment. Those are signed
  rather than stored, so there is nothing on the server to withdraw. Each
  reaches the one file it was minted for, with the rights it was minted with,
  and expires on its own — within 12 hours for ONLYOFFICE, 6 for Collabora.
  Reopening the document asks for a new one, which the new password governs. To
  end them sooner, change `ONLYOFFICE_SECRET` or `COLLABORA_SECRET` and restart:
  every token signed with the old value stops working at once, for everyone.
- When `USER_VOLUMES=true`, each user profile includes a **Volumes** tab for assigning per-user volumes. See [User volumes](/admin/user-volumes).
- Local users store credentials in the SQLite database inside your `/config` mount.
- People sign in with **either their email address or their username**, in the
  same box. Case does not matter for either.
- A username has to name one account to be usable for signing in. NextExplorer
  refuses a new account, or a rename, that would take a username another account
  already has — but an installation upgraded from an older version may already
  hold duplicates, because the username is derived from the local part of the
  address (`alice@example.com` and `alice@other.org` both become `alice`). Where
  a username answers for more than one account it signs nobody in, and those
  accounts use their email address instead. Give one of them a different
  username in **Settings → Admin → Users** to free it.
- **Two-factor authentication** is each person's to turn on, in **Settings → Two-factor**: a QR code for any authenticator app, one code to prove the phone kept the secret, and ten recovery codes shown once. From then on that account's sign-in asks for a code after the password. The user list says who has it on. When somebody loses both the phone and the codes, an administrator takes it off for them — the same person who could already reset that account's password — and the account signs in with its password alone until it is set up again. With OIDC the second factor belongs to the provider, and this is for local passwords only.
- **Passkeys** are each person's to add, in **Settings → Passkeys**: a fingerprint, a face or a device PIN instead of a password. The device keeps the key and never hands it over, and what it signs names this site — so a passkey cannot be typed into a page pretending to be this one, read over a shoulder, or replayed anywhere else. A passkey that was unlocked to be used is already two things (the device, and whoever can unlock it), so it answers an account's second factor on its own; one used without unlocking still asks for the code. Passkeys are for local accounts, like the second factor; with `AUTH_MODE=oidc` they are not offered.
  - **The browser decides where this can work.** A passkey is bound to a hostname, and browsers refuse to make one on a page that is not secure or on an address that is not a name: over plain `http`, or at `https://192.168.1.10`, the page says so instead of offering a button. Reach the server over https, or through `localhost`, to add one.
  - **An installation reached through two hostnames has to pick one.** A passkey made on `files.example.com` is refused on `files.lan`, by design. `PUBLIC_URL` settles it where it is set; `WEBAUTHN_RP_ID` settles it explicitly. Change either one and the passkeys already made stop working — they belong to the name they were made on.
  - **The last way in is protected.** An account with no password is refused the removal of its last passkey, and removing any passkey asks for the password when the account has one.
  - **When the device that held the passkey is gone**, an administrator takes every passkey off that account — the same deliberate act, by the same person, as taking somebody's second factor off. What is left is an account that signs in with its password and adds a passkey again from whatever device is in front of it.
- Promote trusted accounts to admin inside the UI—note that demotions are blocked when it would remove the last admin.
- When OIDC is enabled, users are created automatically on first login (unless `OIDC_AUTO_CREATE_USERS=false`) and elevated to admin if their `groups`, `roles`, or `entitlements` claims match any of the names inside `OIDC_ADMIN_GROUPS`.

## Access control policies

- **Settings → Access Control** lets you define rules with the following types:
  - `rw` – Read/write access (default). Applies when no rule matches.
  - `ro` – Read-only access; uploads and edits are disabled for every account except administrators.
  - `hidden` – Keeps the volume/folder out of listings and search, and refuses it by its address too — for everyone, administrators included.
- Rules use the logical root (e.g., `Projects/Team`), the path NextExplorer shows with the volume first — not the path of the mount on the host or in the container. The folder button beside the field chooses it for you, and a path that names no folder is flagged with the one probably meant.
- Rules evaluate in defined order, so place more specific rules above general ones.
- Recursive rules apply to subfolders when the recursion checkbox is enabled.

## Sharing & guest access

- Users with access to a folder or file can create **share links** from the toolbar Share button; shares respect Access Control rules and can be read-only or read/write.
- **Anyone-with-link shares** can be opened by guests via `/share/:token` URLs; guests are confined to the shared path and cannot see other volumes or personal folders.
- **User-specific shares** require authentication and are visible from the **Shares → Shared with me** view; revoking a user’s access to the underlying path (via Access Control or account removal) effectively revokes their ability to use the link.

## Security & logging

- Authentication can be fully disabled for trusted networks via **Settings → Security**, but enabling protects all API routes.
- Sessions survive restarts: without `SESSION_SECRET`, the secret generated at the first start is kept in `/config/session-secret`. Set `SESSION_SECRET` (or `SESSION_SECRET_FILE`) to choose it, or for several replicas.
- **Persistent sessions:** By default, users stay logged in for 30 days even after closing their browser. Configure `SESSION_MAX_AGE_DAYS` to adjust this duration (e.g., `7` for weekly re-authentication, `90` for extended sessions).
- **Two-factor secrets are kept unreadable in `app.db`**, under a key drawn into `/config/totp-key` at the first use. A copy of the database on its own — a backup, a support ticket — is not a set of working authenticators. Losing that key costs authenticators, not accounts: recovery codes are hashed and go on working, and whoever uses one signs in and sets their phone up again.
- **The activity log is off unless you ask for it**, in **Settings → Activity log**. On, it writes down sign-ins (including the ones that were refused, and the name that was tried) and sign-outs; files downloaded, uploaded, sent to the trash, restored and removed for good; what left through a share link — and what arrived through one — and from which link; shares created and deleted; account changes, whether somebody's own (password, second factor, passkey) or an administrator's (an account created, renamed, given roles, or removed); and which settings were changed, including this switch itself. Each line carries who, what, when, the address it came from, and whether it worked. Behind a reverse proxy — or in a container reached from its own host — that address is only the person's if `TRUST_PROXY` says the proxy may be believed; see [the reverse proxy guide](/installation/reverse-proxy). Only administrators can read it.
  - **Nothing before it was switched on is in it.** The log is a record kept from the moment it is asked for, not a history reconstructed afterwards.
  - Lines are kept for the retention set beside the switch (90 days by default, `ACTIVITY_RETENTION_DAYS` to start elsewhere) and swept hourly, whether the log is on or off — switching it off lets the disk go back rather than freezing yesterday's rows. **Empty the log** removes everything at once — and leaves one line saying who emptied it, when, and how many rows went, because a record that can be taken away without a trace is worth less than the rows it lost.
  - It lives in `app.db`, so it is in the same backup as everything else. It has no foreign key to the accounts: what somebody did while their account existed is exactly what a log is for, and deleting the account does not take it away.
  - Nothing here can fail a request. A line that cannot be written is reported in the server's own log and the download, the sign-in or the deletion carries on.
- Http logging toggles (`ENABLE_HTTP_LOGGING`, `LOG_LEVEL`, `DEBUG`) help surface suspicious activity; send container logs to a centralized system for audits.

## Backups & persistence

- `/config` houses `app.db` — accounts, shares, settings, and the records of the trash and file versions — `logos/`, the logo uploaded in Branding, `session-secret`, the secret sessions are signed with when `SESSION_SECRET` is not set — a `/config` restored without it signs everyone out once — and `totp-key`, which is what makes the two-factor secrets in `app.db` readable. Back it up before upgrades. Copy `app.db` with the container stopped, or together with `app.db-wal`: a copy of `app.db` alone can miss what was written last.
- Back up `app.db` and the volumes together. The trash and file versions keep their content in each volume’s `.nextexplorer` folder and their records in `app.db`; one restored without the other leaves items that cannot be restored, or content nothing lists.
- `app-config.json` in `/config` held settings and favorites in early releases, and is only read when `app.db` is created, to carry them into it. Settings are read from `app.db` alone: a read that fails is refused rather than answered from that file, and a current installation keeps nothing in it.
- `app.db` gives back the space its deletions free. SQLite keeps freed pages inside the file, so a large deletion used to leave `app.db` — and every backup of it — at its largest size. An hourly pass now hands free space back once more than 16 MB of it has built up, and the write-ahead log is cut back to 64 MB after a checkpoint. A database created by an earlier release is rewritten once, at the first start, to make this possible; the log says how large it was before and after. The same pass covers `index.db` and `sessions.db` in `/cache`.
- Records nobody needs any more are purged too: ONLYOFFICE document keys past their expiry, every hour, and each trash zone’s events beyond its newest thousand.
- `/cache` holds what can be made again: thumbnails and RAW previews — each kept within its limit, with what a crash left of them removed — sessions, and `index.db` — the search index and the folder sizes. Nothing in it needs a backup. Deleting it signs everyone out and costs a pass over the volumes to rebuild the indexes, so keep it on a persistent mount: without one, every new container reads the volumes again.
- A save, an ONLYOFFICE download, an extraction, a compression, or a copy or move across disks stopped half-way by a restart leaves a hidden temporary file, extraction folder or archive in the volume: what is still being written never sits under the name it is meant to take. Each is recorded in `/cache/in-flight` while it runs, and the next start removes what an interrupted one left, and only that. A `/cache` cleared in between loses the record, and the leftover stays for you to delete.
- An installation upgraded from 3.6.0 or earlier has its indexes moved out of `app.db` into `/cache/index.db` at the first start, as they are — the volumes are not read again for it — and `app.db` is rewritten without them.
- When upgrading, run `docker compose pull` followed by `docker compose up -d`. An installation that started on 1.1.7 or earlier kept `app.db` in `/cache`; nothing moves it to `/config` any more, so copy it there by hand first; the server warns at start when it finds such a file there. Links named `app.db`, `app-config.json` or `extensions` left in `/cache` by 1.1.8 to 2.0.2 are unused and can be deleted.
