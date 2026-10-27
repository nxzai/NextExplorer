# OpenWebUI to ONLYOFFICE handoff

> Draft integration contract for NextExplorer.
>
> The end-to-end feature remains under development; this document is the
> reviewable starting point for the implementation PR.

## Purpose

Provide a safe handoff from an authenticated OpenWebUI file to the configured
NextExplorer storage and ONLYOFFICE preview/editor flow.

```text
OpenWebUI file_id
  -> authenticated handoff
  -> NextExplorer import or existing association lookup
  -> browse/previewManager
  -> ONLYOFFICE
  -> callback save
  -> canonical Explorer document
```

Office and OpenDocument files must open through the Explorer browse/preview
flow, not through the plain text editor route.

## Configuration direction

NextExplorer already has ONLYOFFICE settings. The handoff-specific settings
should follow the same environment/configuration conventions and remain
provider/deployment configurable:

```env
ONLYOFFICE_URL=
ONLYOFFICE_SECRET=
ONLYOFFICE_LANG=en
ONLYOFFICE_DOWNLOAD_ORIGINS=
OPENWEBUI_BASE_URL=
OPENWEBUI_HANDOFF_ENABLED=false
OPENWEBUI_HANDOFF_ALLOWED_ORIGINS=
OPENWEBUI_HANDOFF_TTL_SECONDS=300
OPENWEBUI_STORAGE_ROOT=
```

Values are examples only. Secrets must never be committed, logged, returned in
HTML, or placed in client-visible URLs.

## Handoff requirements

- Accept only an authenticated, short-lived handoff.
- Validate the OpenWebUI file identity and access before import.
- Preserve the supplied logical filename.
- Import into a configured storage destination, never a hard-coded private path.
- Look up an existing association before importing a second copy.
- Return only browser-safe identifiers and routes.
- Open Office files through `/browse/...` and the existing preview manager.
- Keep download and editor actions separate.

## Persistent association

The association must be explicit and durable. At minimum it relates:

- OpenWebUI `file_id`;
- Explorer logical path/document identity;
- logical filename and version;
- latest callback/save state;
- owning user or access boundary.

The callback must save to the associated canonical document rather than creating
an anonymous new file. A later handoff for the same `file_id` must reuse that
document.

## Versioning

Use deterministic names such as:

```text
Souto-Teste_v1.docx
Souto-Teste_v2.docx
drones_peru_dez2022_v1.pptx
drones_peru_dez2022_v2.pptx
```

Do not add timestamp prefixes. Do not create a new version merely because the
user reopened an existing association. A new version requires an explicit new
generation or version action.

## Security requirements

- Never expose ONLYOFFICE secrets, cookies, JWTs, or API tokens.
- Restrict callback and download origins.
- Keep internal filesystem paths server-side.
- Reject expired, malformed, replayed, or unauthorized handoffs.
- Keep logs redacted and free of file tokens or signed URLs.
- Preserve existing user and share permission boundaries.

## Draft implementation checklist

- [ ] Define handoff request/response schema.
- [ ] Add configuration parsing and validation.
- [ ] Implement authenticated import or existing-association lookup.
- [ ] Persist the OpenWebUI-to-Explorer association.
- [ ] Open supported Office formats through `/browse` and `previewManager`.
- [ ] Ensure the ONLYOFFICE callback updates the canonical document.
- [ ] Add duplicate-import and versioning tests.
- [ ] Add callback authorization and replay/expiry tests.
- [ ] Document deployment, configuration, migration, and rollback.
- [ ] Run a real authenticated OpenWebUI -> Explorer -> ONLYOFFICE test before
      marking this PR ready for review.

## End-state: structured document editing API

The long-term target is an API layer similar in spirit to Google Docs/Slides:
read the current document state, submit validated semantic operations in an
atomic batch, and reject stale writes instead of silently overwriting user work.

The NextExplorer adapter should eventually expose or implement:

- a stable logical document ID;
- current document/slide state and opaque revision ID;
- structured batch edits for text, slides, tables, shapes, and images;
- atomic application of a batch;
- optimistic `requiredRevisionId` checks and explicit conflict responses;
- idempotency keys for retried model operations;
- revision/history metadata;
- live-session status and force-save;
- collaborator-change and save events.

The model must return validated semantic operations, never arbitrary JavaScript or
an opaque replacement file. The ONLYOFFICE integration may apply those operations
through a controlled plugin/API in the editor session already open to the user.

For PPTX, the operation surface should be presentation-aware, analogous to the
Google Slides `presentations.batchUpdate` model, while remaining an adapter that
can support other editors in the future.

## Non-goals

- Replacing NextExplorer authentication.
- Publishing public editor links without explicit sharing policy.
- Storing OpenWebUI or ONLYOFFICE secrets in the frontend.
- Guessing the target document from the newest file in a directory.

