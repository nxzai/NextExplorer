import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { findUnreachableContent } from './unreachable.js';

/**
 * The journey one person takes through a fresh install, in order: set it up,
 * sign out and back in, open a volume, upload a file, share one with someone
 * who has no account. Each step depends on the one before it, as it would for
 * that person, so the steps share a page and run in sequence.
 *
 * The unit suites cover each of these in pieces. What they cannot cover is the
 * pieces together in a browser, against the server the image runs — which is
 * where a working API and a working component can still add up to a screen
 * that does nothing.
 */
test.describe.configure({ mode: 'serial' });

const admin = {
  email: 'admin@example.com',
  username: 'admin',
  password: 'correct-horse-battery',
};
const volume = path.join(process.env.E2E_ROOT, 'volumes', 'Projects');

let page;

// Every script the page asked for, so a test can say what was loaded when.
const requested = [];
const loadedUploader = () => requested.some((url) => /\/assets\/uploadEngine-[^/]*\.js$/.test(url));

/**
 * Anything the page threw, for the whole journey.
 *
 * A render that dies leaves the screen it was drawing half built and takes every
 * later one with it, and none of that is an assertion any single step would fail
 * on — the thing being clicked is usually still there. So the errors are
 * collected across the journey and read at the end.
 */
const thrown = [];

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  page.on('request', (request) => requested.push(request.url()));
  page.on('pageerror', (error) => thrown.push(error.message));
});

test.afterAll(async () => {
  await page.close();
});

test('the first visit sets up an administrator and signs them in', async () => {
  await page.goto('/');

  await page.locator('#setup-email').fill(admin.email);
  await page.locator('#setup-password').fill(admin.password);
  await page.locator('#setup-password-confirm').fill(admin.password);
  await page.locator('button[type="submit"]').click();

  // Signed in straight away, on the list of volumes — the tab says so, and
  // says which instance: the name Settings → Branding gives it.
  await expect(page).toHaveTitle('Volumes | Explorer');
  await expect(page.getByText(admin.email)).toBeVisible();
});

/** Press `key` until `target` has focus, as someone without a mouse would. */
const pressUntilFocused = async (key, target, limit = 50) => {
  await expect(target).toBeVisible();
  for (let presses = 0; presses < limit; presses += 1) {
    await page.keyboard.press(key);
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error(`${key} never reached ${target}`);
};

test('signing out returns to the sign-in screen, and the username signs back in', async () => {
  // By keyboard alone. The account menu is the only way to Sign out, and its
  // toggle was once a div: clickable, but out of reach of every key. The exact
  // name is what a screen reader reads and what voice control answers to — the
  // word for the control, then the name and address shown on it.
  const account = page.getByRole('button', {
    name: `Account ${admin.username} ${admin.email}`,
    exact: true,
  });
  await pressUntilFocused('Tab', account);
  await page.keyboard.press('Enter');
  await expect(account).toHaveAttribute('aria-expanded', 'true');

  // The menu opens above its toggle, so its entries come before it.
  await pressUntilFocused('Shift+Tab', page.getByRole('button', { name: 'Sign out' }));
  await page.keyboard.press('Enter');

  await expect(page.locator('#login-identifier')).toBeVisible();

  // The username, not the email address: the account was created with only an
  // address, and the username it was given from it is enough to sign in.
  await page.locator('#login-identifier').fill(admin.username);
  await page.locator('#login-password').fill(admin.password);
  await page.locator('button[type="submit"]').click();

  await expect(page).toHaveTitle('Volumes | Explorer');
});

test('a volume opens by its address and lists what is in it', async () => {
  // Opened by URL rather than by clicking: the address is served by the
  // single-page fallback, which only exists when the server has a build to
  // serve — exactly the route the unit suites never register.
  await page.goto('/browse/Projects');

  await expect(page.getByRole('button', { name: 'Select notes.txt' })).toBeVisible();
  await expect(page).toHaveTitle('Projects | Explorer');
});

test('an uploaded file reaches the disk and the listing', async () => {
  const content = 'uploaded through the browser\n';

  // Uppy comes with the first upload, not with the page: signing in and
  // opening a folder have not asked for it.
  expect(loadedUploader()).toBe(false);

  await page.getByRole('button', { name: 'New' }).click();
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Upload File' }).click(),
  ]);
  await chooser.setFiles({
    name: 'report.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(content),
  });

  await expect(page.getByRole('button', { name: 'Select report.txt' })).toBeVisible({
    timeout: 15_000,
  });
  // The listing could be showing what the client expects rather than what
  // happened; the disk cannot.
  await expect
    .poll(() => {
      const file = path.join(volume, 'report.txt');
      return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    })
    .toBe(content);
  expect(loadedUploader()).toBe(true);
});

/** What a file holds on the disk, or null while it is not there. */
const onDisk = (...parts) => {
  const file = path.join(volume, ...parts);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
};

test('a whole folder chosen in the picker arrives with its tree', async () => {
  const source = path.join(process.env.E2E_ROOT, 'to-upload', 'Carnets');
  fs.mkdirSync(path.join(source, 'sous'), { recursive: true });
  fs.writeFileSync(path.join(source, 'a.txt'), 'premier\n');
  fs.writeFileSync(path.join(source, 'sous', 'b.txt'), 'second\n');

  await page.getByRole('button', { name: 'New' }).click();
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Upload Folder' }).click(),
  ]);
  await chooser.setFiles(source);

  await expect.poll(() => onDisk('Carnets', 'a.txt'), { timeout: 15_000 }).toBe('premier\n');
  await expect.poll(() => onDisk('Carnets', 'sous', 'b.txt')).toBe('second\n');
  await expect(page.getByRole('button', { name: 'Select Carnets' })).toBeVisible();
});

/**
 * Dropped from the desktop, onto a page that has not loaded the uploader yet.
 *
 * The drop arrives before Uppy does; the page has to keep the browser from
 * opening the file in its place, read what was dropped while it still can,
 * and hand it over once the uploader has come. A fresh tab, so nothing earlier
 * has loaded it.
 */
test('a file dropped before the uploader has loaded reaches the disk', async () => {
  // Loaded afresh: whatever the earlier uploads loaded is gone with the page.
  const from = requested.length;
  const engineSince = () =>
    requested.slice(from).some((url) => /\/assets\/uploadEngine-[^/]*\.js$/.test(url));
  await page.goto('/browse/Projects');
  await expect(page.getByRole('button', { name: 'Select notes.txt' })).toBeVisible();
  expect(engineSince()).toBe(false);

  const outcome = await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(['dropped from the desktop\n'], 'dropped.txt', { type: 'text/plain' })
    );
    const target = document.querySelector('.upload-drop-target');
    target.dispatchEvent(
      new DragEvent('dragover', { dataTransfer: transfer, bubbles: true, cancelable: true })
    );
    const drop = new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true });
    target.dispatchEvent(drop);
    return { prevented: drop.defaultPrevented };
  });

  // Not opened by the browser in place of the page.
  expect(outcome.prevented).toBe(true);
  await expect
    .poll(() => onDisk('dropped.txt'), { timeout: 15_000 })
    .toBe('dropped from the desktop\n');
  expect(engineSince()).toBe(true);
  await expect(page).toHaveURL(/\/browse\/Projects$/);
});

test('a shared link opens for someone with no account, and opens nothing else', async ({
  browser,
}) => {
  await page.getByRole('button', { name: 'Select notes.txt' }).click();
  await page.getByRole('button', { name: 'Share selected item' }).click();

  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Create Share Link' }).click();

  const linkField = dialog.locator('input[readonly]').first();
  await expect(linkField).toHaveValue(/\/share\/[A-Za-z0-9_-]+$/);
  const link = await linkField.inputValue();

  // A separate browser context has none of the administrator's cookies: this
  // is a stranger who was sent the link.
  const stranger = await browser.newContext({ locale: 'en-US' });
  try {
    const strangerPage = await stranger.newPage();
    await strangerPage.goto(link);
    await expect(strangerPage.getByRole('button', { name: 'Select notes.txt' })).toBeVisible();
    // The tab names what was shared, and the instance, for somebody with no
    // account — not the token, which is all the address holds at this level.
    await expect(strangerPage).toHaveTitle('notes.txt | Explorer');

    // The file itself, through the address the dialog hands out for it.
    const response = await stranger.request.get(link.replace('/share/', '/api/share/'));
    expect(response.status()).toBe(200);
    expect(await response.text()).toBe('hello from the e2e volume\n');

    // And the link is the only way in: the volume it came from is still shut.
    await strangerPage.goto('/browse/Projects');
    await expect(strangerPage.locator('#login-identifier')).toBeVisible();
  } finally {
    await stranger.close();
  }
});

const trashDirectory = path.join(volume, '.nextexplorer', 'trash');
/**
 * What the trash holds on disk: the items, not their descriptions.
 *
 * Read through a poll wherever it should be empty: content leaves the trash by
 * being linked under its new name and then unlinked from the old one, so at the
 * instant the restored file is readable its payload can still be there. Read
 * once, the assertion is a race — and it lost one on CI.
 */
const trashPayloads = () =>
  fs.existsSync(trashDirectory)
    ? fs.readdirSync(trashDirectory).filter((name) => !name.endsWith('.json'))
    : [];

/**
 * Deleting is a rename into the volume's own reserved space: the file leaves
 * the folder, its bytes wait on the same disk, and restoring puts back exactly
 * what was there. Checked on the disk, not only in the listing.
 */
test('a deleted file goes to the trash and comes back as it was', async () => {
  const content = 'uploaded through the browser\n';
  const file = path.join(volume, 'report.txt');

  await page.goto('/browse/Projects');
  await page.getByRole('button', { name: 'Select report.txt' }).click();
  await page.keyboard.press('Delete');

  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('will go to the trash');
  await dialog.getByRole('button', { name: 'Move to Trash' }).click();

  await expect.poll(() => fs.existsSync(file)).toBe(false);
  await expect.poll(() => trashPayloads().length).toBe(1);
  expect(fs.readFileSync(path.join(trashDirectory, trashPayloads()[0]), 'utf8')).toBe(content);

  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  await expect(page).toHaveURL(/\/trash$/);
  await page.getByRole('checkbox', { name: 'Select report.txt' }).check();
  await page.getByRole('button', { name: 'Restore', exact: true }).click();

  await expect
    .poll(() => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null))
    .toBe(content);
  await expect.poll(() => trashPayloads()).toEqual([]);
  await expect(page.getByText('The trash is empty.')).toBeVisible();
});

test('deleting for good from the trash takes the bytes off the disk', async () => {
  const file = path.join(volume, 'notes.txt');

  await page.goto('/browse/Projects');
  await page.getByRole('button', { name: 'Select notes.txt' }).click();
  await page.keyboard.press('Delete');
  await page.getByRole('dialog').getByRole('button', { name: 'Move to Trash' }).click();
  await expect.poll(() => fs.existsSync(file)).toBe(false);
  await expect.poll(() => trashPayloads().length).toBe(1);

  await page.goto('/trash');
  await page.getByRole('checkbox', { name: 'Select notes.txt' }).check();
  await page.getByRole('button', { name: 'Delete permanently' }).click();

  // Asked first: nothing leaves the trash on one click.
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('removed for good');
  expect(trashPayloads()).toHaveLength(1);
  await dialog.getByRole('button', { name: 'Delete permanently' }).click();

  await expect.poll(() => fs.readdirSync(trashDirectory)).toEqual([]);
  expect(fs.existsSync(file)).toBe(false);
});

/**
 * A deleted folder is one item in the trash, and what is inside it can still
 * come back on its own — to its place inside the folder, while the rest stays.
 */
test('one file comes back out of a deleted folder, and the rest stays in the trash', async () => {
  const folder = path.join(volume, 'client');
  fs.mkdirSync(path.join(folder, 'drafts'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'brief.txt'), 'the brief\n');
  fs.writeFileSync(path.join(folder, 'drafts', 'v1.txt'), 'first draft\n');
  fs.writeFileSync(path.join(folder, 'drafts', 'v2.txt'), 'second draft\n');

  await page.goto('/browse/Projects');
  await page.getByRole('button', { name: 'Select client' }).click();
  await page.keyboard.press('Delete');
  await page.getByRole('dialog').getByRole('button', { name: 'Move to Trash' }).click();
  await expect.poll(() => fs.existsSync(folder)).toBe(false);
  await expect.poll(() => trashPayloads().length).toBe(1);
  const [payload] = trashPayloads();

  await page.goto('/trash');
  await page.getByRole('button', { name: 'Open client' }).click();
  await expect(page).toHaveURL(/\/trash\?item=/);
  await page.getByRole('button', { name: 'Open drafts' }).click();
  await page.getByRole('checkbox', { name: 'Select v2.txt' }).check();
  await page.getByRole('button', { name: 'Restore', exact: true }).click();

  const restored = path.join(folder, 'drafts', 'v2.txt');
  await expect
    .poll(() => (fs.existsSync(restored) ? fs.readFileSync(restored, 'utf8') : null))
    .toBe('second draft\n');
  // Only that file left the trash: the rest of the folder is still in it, and
  // still listed there.
  expect(fs.readdirSync(folder)).toEqual(['drafts']);
  expect(fs.existsSync(path.join(trashDirectory, payload, 'drafts', 'v2.txt'))).toBe(false);
  expect(fs.readFileSync(path.join(trashDirectory, payload, 'drafts', 'v1.txt'), 'utf8')).toBe(
    'first draft\n'
  );
  await expect(page.getByRole('checkbox', { name: 'Select v1.txt' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Select v2.txt' })).toHaveCount(0);

  // The rest still comes back whole. Its name is taken now, by the folder the
  // file went back into, so it takes a suffix rather than replacing it.
  await page.getByRole('button', { name: 'Restore whole folder' }).click();
  await expect(page).toHaveURL(/\/trash$/);
  const rest = path.join(volume, 'client (1)');
  await expect.poll(() => fs.existsSync(path.join(rest, 'drafts', 'v1.txt'))).toBe(true);
  expect(fs.readFileSync(path.join(rest, 'brief.txt'), 'utf8')).toBe('the brief\n');
  expect(fs.readFileSync(restored, 'utf8')).toBe('second draft\n');
  await expect.poll(() => trashPayloads()).toEqual([]);
});

/**
 * Restoring into a folder chosen with the dialog a move uses: the file lands
 * in that folder, not where it was deleted from.
 */
test('a deleted file can be restored into another folder', async () => {
  const archive = path.join(volume, 'archive');
  fs.mkdirSync(archive, { recursive: true });
  const file = path.join(volume, 'invoice.txt');
  fs.writeFileSync(file, 'invoice 42\n');

  await page.goto('/browse/Projects');
  await page.getByRole('button', { name: 'Select invoice.txt' }).click();
  await page.keyboard.press('Delete');
  await page.getByRole('dialog').getByRole('button', { name: 'Move to Trash' }).click();
  await expect.poll(() => fs.existsSync(file)).toBe(false);
  await expect.poll(() => trashPayloads().length).toBe(1);

  await page.goto('/trash');
  await page.getByRole('checkbox', { name: 'Select invoice.txt' }).check();
  await page.getByRole('button', { name: 'Restore to…' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Restore to');
  await dialog.getByRole('option', { name: 'Projects' }).click();
  await dialog.getByRole('option', { name: 'archive' }).click();
  await dialog.getByRole('button', { name: 'Restore here' }).click();

  const landed = path.join(archive, 'invoice.txt');
  await expect
    .poll(() => (fs.existsSync(landed) ? fs.readFileSync(landed, 'utf8') : null))
    .toBe('invoice 42\n');
  expect(fs.existsSync(file)).toBe(false);
  await expect.poll(() => trashPayloads()).toEqual([]);
  await expect(page.getByText('The trash is empty.')).toBeVisible();
});

/**
 * A deleted script can be read before deciding: a right click, Preview, and the
 * editor shows it — read only, nothing to save — then Close is back in the trash.
 */
test('a deleted script is read in the editor from the right-click menu, and cannot be changed', async () => {
  const script = path.join(volume, 'deploy.sh');
  fs.writeFileSync(script, '#!/bin/sh\necho deployed\n');

  await page.goto('/browse/Projects');
  await page.getByRole('button', { name: 'Select deploy.sh' }).click();
  await page.keyboard.press('Delete');
  await page.getByRole('dialog').getByRole('button', { name: 'Move to Trash' }).click();
  await expect.poll(() => fs.existsSync(script)).toBe(false);
  await expect.poll(() => trashPayloads().length).toBe(1);

  await page.goto('/trash');
  await page.locator('[data-trash-row]', { hasText: 'deploy.sh' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Preview' }).click();

  await expect(page).toHaveURL(/\/trash\/view\//);
  await expect(page.getByText('In the trash · read only')).toBeVisible();
  const content = page.locator('.cm-content');
  await expect(content).toContainText('echo deployed');
  await expect(content).toHaveAttribute('contenteditable', 'false');
  await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page).toHaveURL(/\/trash$/);
  // Read, not restored: it is still in the trash, as it was.
  expect(trashPayloads()).toHaveLength(1);
  expect(fs.readFileSync(path.join(trashDirectory, trashPayloads()[0]), 'utf8')).toBe(
    '#!/bin/sh\necho deployed\n'
  );
});

/**
 * A shared file sent to the trash: its link stops working at once, the delete
 * dialog having said so; restored with "Restore the share links", the very same
 * link works again for someone with no account.
 */
test('a shared file sent to the trash comes back with its link', async ({ browser }) => {
  const file = path.join(volume, 'plan.txt');
  fs.writeFileSync(file, 'the plan\n');

  await page.goto('/browse/Projects');
  await page.getByRole('button', { name: 'Select plan.txt' }).click();
  await page.getByRole('button', { name: 'Share selected item' }).click();
  const shareDialog = page.getByRole('dialog');
  await shareDialog.getByRole('button', { name: 'Create Share Link' }).click();
  const linkField = shareDialog.locator('input[readonly]').first();
  await expect(linkField).toHaveValue(/\/share\/[A-Za-z0-9_-]+$/);
  const shareUrl = (await linkField.inputValue()).replace('/share/', '/api/share/');

  await page.goto('/browse/Projects');
  await page.getByRole('button', { name: 'Select plan.txt' }).click();
  await page.keyboard.press('Delete');
  const deleteDialog = page.getByRole('dialog');
  await expect(deleteDialog).toContainText('stops working while the content is in the trash');
  await deleteDialog.getByRole('button', { name: 'Move to Trash' }).click();
  await expect.poll(() => fs.existsSync(file)).toBe(false);

  const stranger = await browser.newContext({ locale: 'en-US' });
  try {
    expect((await stranger.request.get(shareUrl)).status()).toBe(404);

    await page.goto('/trash');
    await expect(page.locator('[data-trash-row]', { hasText: 'plan.txt' })).toContainText('Shared');
    await page.getByRole('checkbox', { name: 'Select plan.txt' }).check();
    await page.getByRole('button', { name: 'Restore', exact: true }).click();
    const question = page.getByRole('dialog');
    await expect(question).toContainText('What about the share links?');
    await question.getByRole('button', { name: 'Restore the share links' }).click();
    await expect.poll(() => fs.existsSync(file)).toBe(true);

    const back = await stranger.request.get(shareUrl);
    expect(back.status()).toBe(200);
    expect(await back.text()).toBe('the plan\n');
  } finally {
    await stranger.close();
  }
});

/**
 * A file longer than the window has to be reachable in the editor.
 *
 * Reported as #10, against Firefox, and it was broken in every browser:
 * CodeMirror grows with its document unless it is told to fill its host, and
 * the page's own root clips. So a 900-line file drew 20,000 px of editor with
 * no viewport anywhere to scroll, and the wheel moved nothing.
 *
 * The component's side of this is covered in two engines by
 * `e2e/editor-scroll.spec.js`. What only the real view can show is the other
 * half: that the chain of heights from the page down to the editor is
 * unbroken, which is one `min-h-0` away from being false again.
 */
test('a file longer than the window scrolls inside the editor', async () => {
  const file = path.join(volume, 'long-notes.md');
  fs.writeFileSync(
    file,
    Array.from({ length: 900 }, (_, index) => `line ${index + 1} of a long file`).join('\n')
  );

  await page.goto('/editor/Projects/long-notes.md');
  const scroller = page.locator('.cm-scroller');
  await expect(page.locator('.cm-content')).toContainText('line 1 of a long file');

  const sizes = await scroller.evaluate((el) => ({
    visible: el.clientHeight,
    document: el.scrollHeight,
  }));
  // A viewport over the document rather than the whole of it.
  expect(sizes.visible).toBeLessThan(sizes.document / 4);

  const box = await scroller.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 1500);
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(50);

  // And the page itself still clips nothing: whatever the editor does not
  // show is inside it, not hanging off the bottom of the window.
  const overflow = await page.evaluate(() => {
    const root = document.querySelector('#app > div');
    return root.scrollHeight - root.clientHeight;
  });
  expect(overflow).toBeLessThanOrEqual(2);
});

/**
 * A document in a browser tab of its own.
 *
 * The request was to keep documents open while browsing elsewhere, several at
 * a time (nxzai/NextExplorer#303), and the answer is an address rather than a
 * tab bar inside the application. What cannot be proved anywhere but in a
 * browser is the part that decides whether the feature exists at all: that the
 * double click really opens a second tab — `window.open` outside a gesture is
 * a popup a browser silently blocks — and that the folder it was opened from
 * is still sitting there behind it.
 */
test('a document opens in a tab of its own, and the folder stays where it was', async () => {
  fs.writeFileSync(path.join(volume, 'tabbed.md'), '# In its own tab\n');

  await page.goto('/settings/user-preferences');
  const preference = page.locator('[data-test="documents-in-new-tab"]');
  await expect(preference).toBeVisible();
  await preference.click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(preference).toHaveAttribute('aria-checked', 'true');

  await page.goto('/browse/Projects');
  // The row itself: the selection button beside it swallows a double click on
  // purpose, so a double click there would select the file and open nothing.
  const row = page.locator('[title="tabbed.md"]').first();
  await expect(row).toBeVisible();

  const [document] = await Promise.all([page.waitForEvent('popup'), row.dblclick()]);
  await document.waitForLoadState('domcontentloaded');

  expect(document.url()).toContain('/open/Projects/tabbed.md');
  await expect(document.locator('[data-test="preview-surface"]')).toBeVisible();
  await expect(document.getByText('tabbed.md')).toBeVisible();
  // Four tabs all reading "Explorer" would be four tabs nobody can tell apart.
  await expect(document).toHaveTitle('tabbed.md | Explorer');

  // The folder it was opened from never moved: that is the whole point of
  // opening elsewhere.
  await expect(page).toHaveURL(/\/browse\/Projects/);
  await expect(page.locator('[data-test="preview-surface"]')).toHaveCount(0);

  await document.close();
  await expect(page).toHaveURL(/\/browse\/Projects/);

  // Back off, so the tests after this one open documents the way they expect.
  await page.goto('/settings/user-preferences');
  await preference.click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(preference).toHaveAttribute('aria-checked', 'false');
});

/**
 * What the second tab is allowed to be.
 *
 * Three things that are invisible when they are wrong. The tab must not be
 * able to reach back into the page that opened it. The beacon that ends an
 * editing session must actually arrive, with the cookie that says who sent it
 * — a beacon the browser drops, or one that arrives as nobody, leaves a
 * document marked as open for ever. And the address must be worth nothing to
 * somebody with no account: it is a URL, so it will be copied and pasted.
 */
test('the second tab is sealed, and its address needs an account', async ({ browser }) => {
  await page.goto('/settings/user-preferences');
  const preference = page.locator('[data-test="documents-in-new-tab"]');
  await preference.click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(preference).toHaveAttribute('aria-checked', 'true');

  await page.goto('/browse/Projects');
  const row = page.locator('[title="tabbed.md"]').first();
  await expect(row).toBeVisible();
  const [document] = await Promise.all([page.waitForEvent('popup'), row.dblclick()]);
  await document.waitForLoadState('domcontentloaded');

  // `noopener`: nothing in the new tab can touch the one it came from.
  expect(await document.evaluate(() => window.opener)).toBeNull();

  // The transport a closing tab uses to end an editing session.
  //
  // Fired by hand, and at a different endpoint: only ONLYOFFICE sends one, no
  // Document Server runs here, and its routes are not even mounted without
  // one. What has to be true is not about ONLYOFFICE — it is that
  // `sendBeacon` leaves a page at all and arrives carrying the session cookie.
  // A beacon that arrived as nobody would be answered 401, and the editing
  // session it was meant to end would stay open until it timed out.
  //
  // So the same beacon is sent twice, from two places, and what separates the
  // answers is the cookie and nothing else.
  const beacon = () =>
    navigator.sendBeacon(
      '/api/favorites',
      new Blob([JSON.stringify({})], { type: 'application/json' })
    );

  const [fromTheTab] = await Promise.all([
    document.waitForResponse((response) => response.url().includes('/api/favorites')),
    document.evaluate(beacon),
  ]);
  // 400 and not 401: the server knew who was asking, and refused the body.
  expect(fromTheTab.status()).toBe(400);

  await document.close();

  // The same address, to somebody who was sent it and has no account.
  const stranger = await browser.newContext({ locale: 'en-US' });
  try {
    const strangerPage = await stranger.newPage();
    await strangerPage.goto('/open/Projects/tabbed.md');
    await expect(strangerPage.locator('#login-identifier')).toBeVisible();
    await expect(strangerPage.locator('[data-test="preview-surface"]')).toHaveCount(0);
    expect(await strangerPage.locator('body').innerText()).not.toContain('In its own tab');

    // The same beacon, from a page with no session: answered as nobody. That
    // is the other half of the pair above — the cookie is what made the
    // difference, not the shape of the request.
    const [fromNobody] = await Promise.all([
      strangerPage.waitForResponse((response) => response.url().includes('/api/favorites')),
      strangerPage.evaluate(() =>
        navigator.sendBeacon(
          '/api/favorites',
          new Blob([JSON.stringify({})], { type: 'application/json' })
        )
      ),
    ]);
    expect(fromNobody.status()).toBe(401);
  } finally {
    await stranger.close();
  }

  await page.goto('/settings/user-preferences');
  await preference.click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(preference).toHaveAttribute('aria-checked', 'false');
});

/**
 * The same, inside a share.
 *
 * A share is its own space — `share/<token>/…` rather than a volume — and the
 * preference is one decision for every kind of file, so it has to hold there
 * too. A document that opened over the folder everywhere except inside a share
 * would be exactly the surprise this feature exists to avoid.
 */
test('a document inside a share opens in a tab as well', async () => {
  await page.goto('/browse/Projects');
  await page.getByRole('button', { name: 'Select tabbed.md' }).click();
  await page.getByRole('button', { name: 'Share selected item' }).click();

  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Create Share Link' }).click();
  const link = await dialog.locator('input[readonly]').first().inputValue();
  const token = link.split('/share/')[1];
  await page.keyboard.press('Escape');

  await page.goto('/settings/user-preferences');
  const preference = page.locator('[data-test="documents-in-new-tab"]');
  await preference.click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(preference).toHaveAttribute('aria-checked', 'true');

  // The share as the account that made it sees it: the same listing, the same
  // double click, in a space whose paths are not a volume's.
  await page.goto(`/browse/share/${token}`);
  const row = page.locator('[title="tabbed.md"]').first();
  await expect(row).toBeVisible();

  const [document] = await Promise.all([page.waitForEvent('popup'), row.dblclick()]);
  await document.waitForLoadState('domcontentloaded');

  expect(document.url()).toContain(`/open/share/${token}/tabbed.md`);
  await expect(document.locator('[data-test="preview-surface"]')).toBeVisible();
  // Not an empty shell: the document itself came through the share.
  await expect(document.getByText('In its own tab')).toBeVisible();
  await document.close();

  await page.goto('/settings/user-preferences');
  await preference.click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(preference).toHaveAttribute('aria-checked', 'false');
});

/**
 * Every save in the editor keeps what it replaced. From a right click, the
 * Versions panel lists those versions and puts an earlier one back — and what
 * the restore replaced is kept in turn, so restoring the wrong one loses
 * nothing. The content is checked on the disk, not only on screen.
 */
test('an earlier version of a file edited in the browser comes back from the Versions panel', async () => {
  const file = path.join(volume, 'minutes.txt');
  fs.writeFileSync(file, 'draft one');

  const saveInEditor = async (text) => {
    await page.goto('/editor/Projects/minutes.txt');
    const content = page.locator('.cm-content');
    await expect(content).toContainText('draft');
    await content.click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type(text);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => fs.readFileSync(file, 'utf8')).toBe(text);
  };

  await saveInEditor('draft two');
  await saveInEditor('draft three');

  await page.goto('/browse/Projects');
  await page.getByRole('button', { name: 'Select minutes.txt' }).click({ button: 'right' });
  await page.getByRole('button', { name: 'Versions', exact: true }).click();

  const panel = page.getByRole('dialog', { name: 'File versions' });
  await expect(panel).toContainText('minutes.txt');
  const rows = panel.locator('[data-test="version-row"]');
  await expect(rows).toHaveCount(2);

  // Newest first: the last one is the file as it was before the first save.
  await rows.last().getByRole('button', { name: 'Version actions' }).click();
  // Exactly: "Restore as a copy…" is in the same menu.
  await panel.getByRole('menuitem', { name: 'Restore', exact: true }).click();
  // Asked first.
  expect(fs.readFileSync(file, 'utf8')).toBe('draft three');
  await page.locator('[data-test="versions-confirm"]').click();

  await expect.poll(() => fs.readFileSync(file, 'utf8')).toBe('draft one');
  await expect(page.getByText('Version restored')).toBeVisible();
  // What the restore replaced is a version now, beside the two there were.
  await expect(rows).toHaveCount(3);
});

/**
 * The two ends of the same fact: a file has versions.
 *
 * In the folder, a mark on the row says so and opens the history. In the
 * settings, one list holds every file in the installation that has one, which
 * is the only place the space they take can be seen and given back. Deleting
 * from there has to reach both — and leave the file itself alone.
 */
test('a file with versions is marked in the listing, and an administrator can clear it', async () => {
  // By the row's own selection control and not by its text: the list view
  // shortens a long name in the middle, so matching on the name is a test
  // that depends on how wide the column happens to be.
  const markFor = (name) =>
    page
      .locator('.group\\/item')
      .filter({ has: page.locator(`[aria-label="Select ${name}"]`) })
      .locator('[data-test="version-mark"]');

  await page.goto('/browse/Projects');
  await expect(markFor('minutes.txt')).toHaveText('3');
  await expect(markFor('report.txt')).toHaveCount(0);

  await markFor('minutes.txt').click();
  await expect(page.getByRole('dialog', { name: 'File versions' })).toContainText('minutes.txt');
  await page.keyboard.press('Escape');

  await page.goto('/settings/file-versions');
  const row = page.locator('[data-test="versions-row"]').filter({ hasText: 'minutes.txt' });
  await expect(row).toHaveCount(1);
  await expect(row.locator('[data-test="versions-count"]')).toHaveText('3');

  await row.locator('[data-test="versions-expand"]').click();
  await expect(page.locator('[data-test="versions-version"]')).toHaveCount(3);

  await row.locator('[data-test="versions-delete-all"]').click();
  await page.locator('[data-test="versions-confirm"]').click();
  await expect(row).toHaveCount(0);

  await page.goto('/browse/Projects');
  await expect(markFor('minutes.txt')).toHaveCount(0);
  // The history went; the file is exactly what the restore put back.
  expect(fs.readFileSync(path.join(volume, 'minutes.txt'), 'utf8')).toBe('draft one');
});

/**
 * Two background workers switched on from Settings rather than from the
 * environment, and the report of which optional tools are here (#9).
 *
 * Held in the real build against the real server because the parts are in
 * four places — the page, the store, the settings route and the feature
 * switches that start the workers — and each has its own tests; this is the
 * one that crosses all of them, including the reload that proves the server
 * kept the choice rather than the page remembering it.
 */
/**
 * Several files taken away without an archive (#487).
 *
 * The browsers that have a folder picker open a dialog belonging to the
 * operating system, which nothing here can answer — so the picker is taken away
 * and what runs is the other path, the one Firefox and Safari get: one download
 * per file, each named by the plan.
 *
 * The chain is what this is for. The menu asks the server to describe the
 * selection, that description is where the download is counted, and each part
 * then arrives as its own file — three pieces that the unit suites each prove
 * alone and that have to add up in a browser.
 */
test('several files download one by one, without a zip', async () => {
  fs.writeFileSync(path.join(volume, 'premier.txt'), 'un');
  fs.writeFileSync(path.join(volume, 'second.txt'), 'deux');

  await page.goto('/browse/Projects');
  await page.evaluate(() => {
    delete window.showDirectoryPicker;
  });

  await page.getByRole('button', { name: 'Select premier.txt' }).click();
  await page.getByRole('button', { name: 'Select second.txt' }).click();
  await page.getByRole('button', { name: 'Select second.txt' }).click({ button: 'right' });

  const downloads = [];
  page.on('download', (download) => downloads.push(download));
  await page.getByRole('button', { name: 'Download as separate files' }).click();

  await expect.poll(() => downloads.length).toBe(2);
  expect(downloads.map((download) => download.suggestedFilename()).sort()).toEqual([
    'premier.txt',
    'second.txt',
  ]);
});

/**
 * Tabs: the switch that turns them on, and two places open at once.
 *
 * Off is the default and it has to be invisible — nothing above the toolbar, no
 * strip, the application somebody has always used. On, the two things worth
 * proving in a browser are that a tab keeps the folder it was on while another is
 * in front, and that the middle button opens a folder behind without taking the
 * reader anywhere, which is the gesture that makes tabs worth having.
 *
 * The preference is put back at the end: the rest of this journey shares one page,
 * and a strip left on screen would be measuring a different application.
 */
/**
 * A shell in a tab of its own: named for where it is, and given the whole tab.
 *
 * Three of them open were three tabs all reading "Terminal", which is no more useful
 * than three reading "Compare" — and the sidebar beside a shell answered nothing but
 * "leave the shell", which reads as "go to that folder" and is easy to confuse with a
 * `cd` a keystroke away. Both are about what is drawn, so both need a browser.
 */
test('a terminal in its own tab is named for its folder and takes the whole tab', async () => {
  await page.goto('/settings/user-preferences');
  const preference = page.locator('[data-test="browse-in-tabs"]');
  await preference.click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(preference).toHaveAttribute('aria-checked', 'true');

  const strip = page.locator('[data-test="tab-strip"]');
  try {
    await page.goto('/browse/Projects');
    await expect(page.locator('[data-test="browser-aside"]')).toBeVisible();

    // The gesture that asks for a shell in a tab rather than in the drawer. It opens
    // behind, as every tab opened this way does, so the folder stays in front.
    const before = await strip.locator('[data-test="tab"]').count();
    await page.getByRole('button', { name: 'Terminal', exact: true }).click({ button: 'middle' });
    await expect(strip.locator('[data-test="tab"]')).toHaveCount(before + 1);
    await expect(page).toHaveURL(/\/browse\/Projects$/);

    // Named for the folder its shell is in, not for what it is. Told apart from the
    // folder tab of the same name by what it is, which is what the icon is for.
    const shell = strip.locator('[data-test="tab"][data-kind="terminal"]');
    await expect(shell.getByRole('tab')).toHaveAttribute('title', 'Projects');
    await expect(strip.locator('[role="tab"][title="Terminal"]')).toHaveCount(0);

    await shell.getByRole('tab').click();
    await expect(page).toHaveURL(/\/terminal\/Projects$/);

    // And it has the tab to itself: no sidebar beside it.
    await expect(page.locator('[data-test="browser-aside"]')).toHaveCount(0);

    // The strip still leads out, and the sidebar is back where it belongs.
    await strip.locator('[data-test="tab"]').first().getByRole('tab').click();
    await expect(page).toHaveURL(/\/browse\/Projects$/);
    await expect(page.locator('[data-test="browser-aside"]')).toBeVisible();
  } finally {
    await page.goto('/settings/user-preferences');
    await preference.click();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(preference).toHaveAttribute('aria-checked', 'false');
  }
});

test('tabs keep two folders open, and the middle button opens one behind', async () => {
  fs.mkdirSync(path.join(volume, 'Alpha'), { recursive: true });
  fs.mkdirSync(path.join(volume, 'Beta'), { recursive: true });
  // A third name, so the row of tabs can be read: four tabs all called the same
  // thing make every order of them look alike, and an assertion about the order
  // that cannot fail is worse than none.
  fs.mkdirSync(path.join(volume, 'Gamma'), { recursive: true });
  // A name nothing else in this journey is on, so "two tabs called this" means
  // the copy rather than whatever was already open.
  fs.mkdirSync(path.join(volume, 'Twin'), { recursive: true });
  // A folder with more in it than fits on a screen, so a tab can be somewhere in
  // the middle of it and be asked whether it came back there.
  fs.mkdirSync(path.join(volume, 'Many'), { recursive: true });
  for (let file = 1; file <= 160; file += 1) {
    fs.writeFileSync(path.join(volume, 'Many', `file-${String(file).padStart(3, '0')}.txt`), 'x');
  }
  // And one far longer than the listing draws at once. A hundred and sixty rows
  // are all on the page the moment it renders; twelve hundred are not, and a list
  // that is not yet as tall as it will be is a list the browser cannot scroll
  // down — which is where the place a tab remembered quietly became the top.
  fs.mkdirSync(path.join(volume, 'Deep'), { recursive: true });
  for (let file = 1; file <= 1200; file += 1) {
    fs.writeFileSync(path.join(volume, 'Deep', `row-${String(file).padStart(4, '0')}.txt`), 'x');
  }
  // A second text file, read rather than typed into: where the reader was in it
  // is what a tab has to hold even when nothing was changed.
  fs.writeFileSync(
    path.join(volume, 'plain.txt'),
    Array.from({ length: 400 }, (_, line) => `line ${line + 1} of a file worth scrolling`).join(
      '\n'
    )
  );
  fs.writeFileSync(path.join(volume, 'Alpha', 'alpha.txt'), 'a');
  fs.writeFileSync(path.join(volume, 'Beta', 'beta.txt'), 'b');
  // A text file, which goes to the editor rather than the preview: the cross of
  // one and the cross of the other have to mean the same thing. Long enough to
  // scroll, because where the reader was in it is half of what a tab holds.
  fs.writeFileSync(
    path.join(volume, 'tabbed.txt'),
    Array.from({ length: 400 }, (_, line) => `line ${line + 1} of a file worth scrolling`).join(
      '\n'
    )
  );

  const strip = page.locator('[data-test="tab-strip"]');
  const tabs = strip.locator('[data-test="tab"]');

  // Off: not a node of it anywhere.
  await page.goto('/browse/Projects');
  await expect(strip).toHaveCount(0);

  await page.goto('/settings/user-preferences');
  const preference = page.locator('[data-test="browse-in-tabs"]');
  await expect(preference).toBeVisible();
  await preference.click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(preference).toHaveAttribute('aria-checked', 'true');

  await page.goto('/browse/Projects/Alpha');
  await expect(strip).toBeVisible();
  await expect(tabs).toHaveCount(1);
  await expect(page.locator('[title="alpha.txt"]').first()).toBeVisible();

  // A second tab, taken to the other folder.
  await strip.locator('[data-test="tab-new"]').click();
  await expect(tabs).toHaveCount(2);
  await page.goto('/browse/Projects/Beta');
  await expect(page.locator('[title="beta.txt"]').first()).toBeVisible();

  // Back to the first: it is still on the folder it was on, and so is the address.
  await tabs.first().getByRole('tab').click();
  await expect(page.locator('[title="alpha.txt"]').first()).toBeVisible();
  await expect(page).toHaveURL(/\/browse\/Projects\/Alpha$/);

  // The middle button on a folder opens it behind, and leaves the reader put.
  //
  // `:not([role="tab"])` is not decoration: a tab carries the name of what it
  // holds as its own title, so `[title="Beta"]` matched the *tab* on Beta before
  // it matched the folder — and the middle button on a tab closes it, which is
  // how this test spent three runs closing the tab it meant to open.
  await page.goto('/browse/Projects');
  await expect(tabs).toHaveCount(2);
  await page.locator('[title="Beta"]:not([role="tab"])').first().click({ button: 'middle' });
  await expect(tabs).toHaveCount(3);
  await expect(page).toHaveURL(/\/browse\/Projects$/);

  // The cross closes one, and the last one has none to close with.
  await tabs.last().locator('[data-test="tab-close"]').click();
  await expect(tabs).toHaveCount(2);

  /**
   * A document opens in a tab of this application, not of the browser.
   *
   * `documentsOpenInNewTab` is already on by this point in the journey, and with
   * tabs on it means one of ours: a tab beside the folder it came from, in the
   * window that still holds the clipboard and the transfers. The address is left
   * loose between `/open` and `/editor` on purpose — which of the two a markdown
   * file goes to is another preference's business, and this is about the tab.
   */
  // Turned on here rather than relied on from an earlier test: what another test
  // left behind is not a state this one should be built on, and the first version
  // of this was — it found the preference off and opened nothing.
  await page.goto('/settings/user-preferences');
  const inNewTab = page.locator('[data-test="documents-in-new-tab"]');
  if ((await inNewTab.getAttribute('aria-checked')) !== 'true') {
    await inNewTab.click();
    await page.getByRole('button', { name: 'Save' }).click();
  }
  await expect(inNewTab).toHaveAttribute('aria-checked', 'true');

  // Counted absolutely, from the two left above: a count read straight after a
  // navigation is read before the strip has drawn, and `before + 1` then asks for
  // one tab where there are two.
  const document = () => page.locator('[title="tabbed.md"]:not([role="tab"])').first();
  await page.goto('/browse/Projects');
  await expect(tabs).toHaveCount(2);
  // A double click, because on a desktop a single one selects.
  await document().dblclick();
  await expect(tabs).toHaveCount(3);
  await expect(page).toHaveURL(/\/(open|editor)\/Projects\/tabbed\.md$/);
  await expect(strip.locator('[data-test="tab"][data-active="true"]')).toContainText('tabbed.md');

  /**
   * And it goes on existing while another tab is in front.
   *
   * Stamped on the node itself, because from the outside a document that was kept
   * and one that was built again look exactly alike — and that difference is the
   * whole of it: a rebuilt ONLYOFFICE document is a new connection to the Document
   * Server, without the cursor, the undo history or the other people editing it.
   * The page used to mount the surface itself, so it was built with the page and
   * thrown away with it, every single time a tab came forward.
   */
  const documentTab = strip.locator('[role="tab"][title="tabbed.md"]');
  const surface = page.locator('[data-test="preview-surface"]');
  await expect(surface).toHaveCount(1);
  await surface.evaluate((node) => {
    node.dataset.kept = 'yes';
  });

  await tabs.first().getByRole('tab').click();
  await expect(page).toHaveURL(/\/browse\/Projects$/);
  // Out of sight, and still in the page: hidden rather than removed, and the very
  // node that was stamped.
  await expect(surface).toBeHidden();
  await expect(page.locator('[data-test="preview-surface"][data-kept="yes"]')).toHaveCount(1);

  await documentTab.click();
  await expect(page).toHaveURL(/\/(open|editor)\/Projects\/tabbed\.md$/);
  await expect(surface).toBeVisible();
  await expect(surface).toHaveAttribute('data-kept', 'yes');

  /**
   * And several documents, each kept alive in its own tab.
   *
   * The question this answers is whether more than one stays in memory at once:
   * every surface on the page is stamped, the tabs are crossed four times, and
   * every stamp is still there afterwards. A rebuilt document comes back without
   * its stamp — and an office document comes back without its connection to the
   * Document Server, its cursor and its undo history.
   */
  fs.writeFileSync(path.join(volume, 'kept-one.md'), '# Kept one\n');
  fs.writeFileSync(path.join(volume, 'kept-two.md'), '# Kept two\n');

  for (const name of ['kept-one.md', 'kept-two.md']) {
    await tabs.first().getByRole('tab').click();
    await expect(page).toHaveURL(/\/browse\/Projects$/);
    await page.locator(`[title="${name}"]:not([role="tab"])`).first().dblclick();
    await expect(page).toHaveURL(new RegExp(`/open/Projects/${name.replace('.', '\\.')}$`));
  }

  /**
   * Stamped on each viewer, not on the surface around it and not on everything
   * inside it.
   *
   * A mark on the surface survives a viewer torn down underneath it — the surface
   * is the page's, the viewer is the plugin's. Marking every node inside went too
   * far the other way and failed in CI for a markdown preview that had merely
   * finished drawing itself: a viewer is free to re-render its own contents.
   *
   * So the viewer's own root is marked, and what this says is exactly that: two
   * viewers were alive at once and both of them are still the ones that were
   * there. It does not say a document was never *re-opened* — measured, and it is
   * not: the same plugin with another document updates the component it has
   * rather than building a new one, which is why the page's own guard and the
   * manager's are each held to that in their own suites.
   */
  const kept = await page.evaluate(() => {
    const roots = [
      ...document.querySelectorAll('[data-test="preview-surface"] main > div:last-of-type > *'),
    ];
    roots.forEach((node, index) => {
      node.dataset.inside = `k${index}`;
    });
    return roots.length;
  });
  expect(kept).toBeGreaterThan(1);
  expect(
    await page.evaluate(() => document.querySelectorAll('[data-test="preview-surface"]').length)
  ).toBeGreaterThan(1);

  const documentTabs = strip.locator('[role="tab"][title$=".md"]');
  for (let crossing = 0; crossing < 2; crossing += 1) {
    await documentTabs.first().click();
    await documentTabs.last().click();
  }

  // The same viewers, still the ones that were there.
  await expect
    .poll(() =>
      page.evaluate(
        () => document.querySelectorAll('[data-test="preview-surface"] [data-inside]').length
      )
    )
    .toBe(kept);

  /**
   * One rule for opening in a tab: command, or control, with the gesture that
   * opens. On a row that is the double click — the single one selects, and with
   * that modifier it adds to the selection, which is worth more than a tab.
   *
   * A favourite and a volume take the same modifier on their single click, which
   * is the gesture that opens *them*; `FavMenu.spec.js` holds that wiring, since
   * making a favourite here would be a journey of its own.
   */
  await tabs.first().getByRole('tab').click();
  await expect(page).toHaveURL(/\/browse\/Projects$/);
  const openedTabs = await tabs.count();

  await page
    .locator('[title="Alpha"]:not([role="tab"])')
    .first()
    .dblclick({ modifiers: ['ControlOrMeta'] });

  await expect(tabs).toHaveCount(openedTabs + 1);
  // Behind: the reader is still in the folder they were reading.
  await expect(page).toHaveURL(/\/browse\/Projects$/);

  // And the row put back as the rest of this journey found it: the counts below
  // are absolute, on purpose, so tabs left behind here would be counted there.
  for (const name of ['kept-one.md', 'kept-two.md', 'Alpha']) {
    await tabs
      .filter({ has: page.locator(`[role="tab"][title="${name}"]`) })
      .first()
      .locator('[data-test="tab-close"]')
      .click();
  }
  await expect(tabs).toHaveCount(3);

  // And the middle button does the same for a file, behind: a document is a place
  // like a folder is, which is the whole point of a tab being an address.
  await page.goto('/browse/Projects');
  await expect(tabs).toHaveCount(3);
  await document().click({ button: 'middle' });
  await expect(tabs).toHaveCount(4);
  await expect(page).toHaveURL(/\/browse\/Projects$/);

  /**
   * And it is ready before the reader gets there.
   *
   * A tab opened behind used to be an address and nothing else: the router draws
   * one page, so the document was read, the viewer built and — for ONLYOFFICE —
   * a document server reached only once the tab was brought forward. Seconds of
   * blank panel, after deliberately opening the tab in advance so as not to wait.
   *
   * The viewer is drawn by the host, which holds one surface per tab and is mounted
   * once, so the proof is that a surface appears while the reader is still looking
   * at the folder. Counted before and after, because "some hidden surface exists"
   * is true of every document tab opened earlier in this journey — an assertion that
   * cannot fail, which is how the first version of this passed while the feature
   * reached none of the gestures anybody uses.
   */
  // An image, which every installation previews — markdown may open in the editor
  // for this account, and then there is no viewer to look for.
  fs.writeFileSync(
    path.join(volume, 'warm.png'),
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
      'base64'
    )
  );
  await page.goto('/browse/Projects');
  await page.locator('[title="warm.png"]:not([role="tab"])').first().click({ button: 'middle' });
  await expect(tabs).toHaveCount(5);

  // A viewer for *that* tab, named by its own id: this page is reopened often
  // enough that "some hidden viewer exists" is true whatever happens, and the tabs
  // restored with the window are being got ready at the same moment.
  const warmedTabId = await strip.locator('[data-test="tab"]').last().getAttribute('data-id');
  expect(
    await strip.locator('[data-test="tab"]').last().getByRole('tab').getAttribute('title')
  ).toBe('warm.png');
  await expect
    .poll(async () =>
      page.evaluate(
        (id) =>
          Boolean(
            document
              .querySelector(`[data-tab="${id}"]`)
              ?.querySelector('[data-test="preview-surface"]')
          ),
        warmedTabId
      )
    )
    .toBe(true);
  // Hidden, and still on the folder: preparing a tab takes the reader nowhere.
  await expect
    .poll(async () =>
      page.evaluate(() =>
        [...document.querySelectorAll('[data-tab][data-active]')]
          .filter((node) => node.querySelector('[data-test="preview-surface"]'))
          .map((node) => node.dataset.active)
      )
    )
    .toContain('false');
  await expect(page).toHaveURL(/\/browse\/Projects$/);

  // Away again, so the counts below are the counts this journey expects.
  await strip
    .locator('[data-test="tab"]')
    .filter({ has: page.locator('[role="tab"][title="warm.png"]') })
    .first()
    .locator('[data-test="tab-close"]')
    .click();
  await expect(tabs).toHaveCount(4);

  /**
   * And a text file is ready on the *first* arrival, not merely quicker.
   *
   * Warming it used to mean reading the file into the browser's cache, which left
   * the page still having to mount and ask — so the first time the reader went to
   * the tab they saw a spinner and then the text. A document in ONLYOFFICE does not
   * do that, because what was prepared is the viewer itself; the text editor now
   * keeps the file for its tab, which is where the page looks before it asks
   * anything.
   *
   * Held with the file held back again: the request is refused, so the only way the
   * text can be on screen is that the tab had it before it was ever visited.
   */
  fs.writeFileSync(
    path.join(volume, 'warm.txt'),
    Array.from({ length: 40 }, (_, line) => `line ${line + 1} of a warmed file`).join('\n')
  );
  await page.goto('/browse/Projects');
  // This file's own read, not merely some read of the editor endpoint: the document
  // tabs beside it are being prepared at the same moment and their markdown preview
  // reads through the same door.
  const readWhileWarming = page.waitForResponse(
    (response) =>
      response.url().includes('/api/editor') &&
      decodeURIComponent(response.url()).includes('warm.txt')
  );
  await page.locator('[title="warm.txt"]:not([role="tab"])').first().click({ button: 'middle' });
  await expect(tabs).toHaveCount(5);
  // The warming has read it: what follows cannot be the page reading it again.
  await readWhileWarming;

  await page.route('**/api/editor?**', (request) => request.abort());
  await strip.locator('[role="tab"][title="warm.txt"]').click();
  await expect(page).toHaveURL(/\/editor\/Projects\/warm\.txt$/);
  await expect(page.locator('.cm-content')).toContainText('of a warmed file');
  await expect(page.getByText('Loading file…')).toHaveCount(0);
  await page.unroute('**/api/editor?**');

  await strip
    .locator('[data-test="tab"]')
    .filter({ has: page.locator('[role="tab"][title="warm.txt"]') })
    .first()
    .locator('[data-test="tab-close"]')
    .click();
  await expect(tabs).toHaveCount(4);
  await page.goto('/browse/Projects');

  // The menu says so too, for whoever has no middle button.
  await document().click({ button: 'right' });
  await page.getByRole('button', { name: 'Open in a new tab' }).click();
  await expect(tabs).toHaveCount(5);
  await expect(page).toHaveURL(/\/(open|editor)\/Projects\/tabbed\.md$/);

  // And the cross on the document closes the tab it was opened in, rather than
  // turning that tab back into a folder listing — which would leave two identical
  // explorer tabs and nothing to tell them apart.
  //
  // The count is the assertion: had it turned the tab back into a folder listing
  // there would still be five. Not the address — the tab that takes over here is
  // another document tab on the same file, because three of them were opened.
  await page.locator('[data-active="true"] [data-test="preview-close"]').click();
  await expect(tabs).toHaveCount(4);

  // And the tab in front afterwards is one of the others, not the one that went.
  await expect(strip.locator('[data-test="tab"][data-active="true"]')).toHaveCount(1);

  /**
   * A text file does the same, and its cross means the same thing.
   *
   * It goes to the editor rather than to the preview, which is half of everything
   * somebody opens in a tab — a `.txt`, a `.md`, a `.json` — and its cross left
   * that tab sitting on a folder listing while the office documents beside it
   * closed theirs.
   */
  await page.goto('/browse/Projects');
  await expect(tabs).toHaveCount(4);
  await page.locator('[title="tabbed.txt"]:not([role="tab"])').first().dblclick();
  await expect(tabs).toHaveCount(5);
  await expect(page).toHaveURL(/\/editor\/Projects\/tabbed\.txt$/);

  /**
   * And what was typed in it survives another tab coming forward.
   *
   * The editor is a page, and a page is unmounted the moment a tab is brought
   * forward — so everything typed since the last save went with it, silently, for
   * a click that never said "discard". The preview keeps a document by keeping its
   * session alive; the editor cannot, so the tab keeps the text.
   */
  await page.locator('.cm-content').click();
  await page.keyboard.type('typed in a tab');
  await expect(page.locator('.cm-content')).toContainText('typed in a tab');
  const editorTab = strip.locator('[role="tab"][title="tabbed.txt"]');

  await tabs.first().getByRole('tab').click();
  await expect(page).toHaveURL(/\/browse\/Projects$/);
  await editorTab.click();
  await expect(page).toHaveURL(/\/editor\/Projects\/tabbed\.txt$/);

  await expect(page.locator('.cm-content')).toContainText('typed in a tab');
  // Still unsaved, which is the other half: handed back as the document, the
  // editor would consider it written and leave the save button grey over text
  // that exists nowhere but this window.
  await expect(page.getByText('Unsaved changes')).toBeVisible();

  /**
   * The cross closes the tab it was opened in — said out loud, since the text above was
   * never saved, and said in the application's own dialog.
   *
   * `confirm` was answering here: the browser's box, headed by the server's address and
   * port, over a question about somebody's file. Nothing but a browser can tell that
   * apart from a dialog, so the browser is asked to record every box of its own that
   * opens, and the assertion is that none did.
   */
  const editorBoxes = [];
  const watchForEditorBoxes = (dialog) => {
    editorBoxes.push(dialog.message());
    return dialog.dismiss();
  };
  page.on('dialog', watchForEditorBoxes);
  await page.locator('[data-test="editor-close"]').click();
  await expect(page.locator('[data-test="ask-confirm"]')).toBeVisible();

  // Called off, and the text is still there in its tab.
  await page.locator('[data-test="ask-cancel"]').click();
  await expect(page.locator('[data-test="ask-confirm"]')).toHaveCount(0);
  await expect(tabs).toHaveCount(5);
  await expect(page.locator('.cm-content')).toContainText('typed in a tab');

  await page.locator('[data-test="editor-close"]').click();
  await page.locator('[data-test="ask-confirm"]').click();
  await expect(tabs).toHaveCount(4);
  await expect(page).not.toHaveURL(/\/editor\//);
  expect(editorBoxes).toEqual([]);
  /**
   * And the watcher goes with the assertion it was for.
   *
   * A dialog listener is not a bystander: while one is attached the browser stops
   * dismissing dialogs by itself and waits to be answered. `beforeunload` is a dialog —
   * the one dialog no page can replace — so a listener left over from an earlier
   * assertion answers it for every navigation that follows, and answers it "stay
   * here": the navigation is cancelled and the journey carries on somewhere it did not
   * mean to be.
   */
  page.off('dialog', watchForEditorBoxes);

  /**
   * And where the reader was, with nothing typed at all.
   *
   * Scrolled down and a run of text selected, then another tab in front and back:
   * the complaint was landing at the top of the file with nothing selected, which
   * no unit suite can see — jsdom has no layout, so nothing there ever scrolls.
   */
  await page.goto('/browse/Projects');
  await page.locator('[title="plain.txt"]:not([role="tab"])').first().dblclick();
  await expect(page).toHaveURL(/\/editor\/Projects\/plain\.txt$/);
  await expect(page.locator('.cm-content')).toBeVisible();

  const where = () =>
    page.evaluate(() => {
      const scroller = document.querySelector('.cm-scroller');
      const selection = window.getSelection();
      return {
        scrollTop: Math.round(scroller?.scrollTop ?? 0),
        selected: String(selection?.toString() || ''),
      };
    });

  await page.locator('.cm-scroller').evaluate((node) => {
    node.scrollTop = 600;
  });
  // A run of text selected with the keyboard, which is what a reader's selection
  // looks like to the editor.
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Shift+ArrowUp');
  await page.keyboard.press('Shift+ArrowUp');
  const before = await where();
  expect(before.selected.length).toBeGreaterThan(0);

  const plainTab = strip.locator('[role="tab"][title="plain.txt"]');
  await tabs.first().getByRole('tab').click();
  await expect(page).toHaveURL(/\/browse\/Projects$/);
  await plainTab.click();
  await expect(page).toHaveURL(/\/editor\/Projects\/plain\.txt$/);

  /**
   * And coming back reads nothing from the server.
   *
   * The page is unmounted the moment another tab comes forward, so it used to read
   * the file again on the way back: every glance at another tab cost a spinner and a
   * redraw of everything. Held with the file held back — the request never answers —
   * so the only way the text can be on screen is that the tab had it already.
   */
  await page.route('**/api/editor?**', (request) => request.abort());
  const plainTabFirst = strip.locator('[role="tab"][title="plain.txt"]');
  await tabs.first().getByRole('tab').click();
  await expect(page).toHaveURL(/\/browse\/Projects$/);
  await plainTabFirst.click();
  await expect(page).toHaveURL(/\/editor\/Projects\/plain\.txt$/);

  // Whichever lines the editor draws — it renders the window the reader is in, not
  // the whole file — they are lines of this file, arrived without asking for it.
  await expect(page.locator('.cm-content')).toContainText('of a file worth scrolling');
  await expect(page.getByText('Loading file…')).toHaveCount(0);
  await page.unroute('**/api/editor?**');

  await expect.poll(async () => (await where()).selected).toBe(before.selected);
  // Back where it was, not merely somewhere below the top: the editor draws what
  // is in view and estimates the rest, so a position written into it before it
  // has measured is clamped to whatever fits. Within a line of it, because what
  // is put back is the line that was at the top rather than a number of pixels.
  await expect.poll(async () => (await where()).scrollTop).toBeGreaterThan(before.scrollTop - 40);

  // Put back, so the counts below are the counts this journey expects.
  await tabs
    .filter({ has: page.locator('[role="tab"][title="plain.txt"]') })
    .first()
    .locator('[data-test="tab-close"]')
    .click();

  /**
   * The order of the tabs is the reader's.
   *
   * Two folders being compared belong side by side, whichever order they happened
   * to be opened in. Dragging is how every browser says it; the menu says the same
   * thing for a touch screen and for the keyboard, and both are checked here
   * because only a browser can say whether a tab can be picked up at all.
   */
  const tabButtons = strip.locator('[data-test="tab"] [role="tab"]');
  const names = () => tabButtons.evaluateAll((list) => list.map((node) => node.title));

  // Four tabs, each somewhere of its own, so the order can be read at all.
  await expect(tabButtons).toHaveCount(4);
  for (const [index, place] of ['Alpha', 'Beta', 'Gamma'].entries()) {
    await tabButtons.nth(index).click();
    await page.goto(`/browse/Projects/${place}`);
  }
  await tabButtons.nth(3).click();
  await page.goto('/browse/Projects');
  await expect.poll(names).toEqual(['Alpha', 'Beta', 'Gamma', 'Projects']);

  // The last, dragged onto the first: it takes that place and the rest shift.
  await strip
    .locator('[data-test="tab"]')
    .last()
    .dragTo(strip.locator('[data-test="tab"]').first());
  await expect.poll(names).toEqual(['Projects', 'Alpha', 'Beta', 'Gamma']);

  // And one place back the other way, from the tab's own menu.
  await tabButtons.first().click({ button: 'right' });
  await page.locator('[data-test="tab-move-right"]').click();
  await expect.poll(names).toEqual(['Alpha', 'Projects', 'Beta', 'Gamma']);

  // Where there is nowhere to go, the menu says so rather than doing nothing.
  await tabButtons.first().click({ button: 'right' });
  await expect(page.locator('[data-test="tab-move-left"]')).toBeDisabled();
  await expect(page.locator('[data-test="tab-move-right"]')).toBeEnabled();

  /**
   * A new tab lands at the end of the row, wherever it was opened from — which is
   * where Edge and Chrome put one, and where somebody who opened it will look for
   * it. It used to land beside the tab it came from, so a row built up backwards.
   */
  await tabButtons.first().click();
  await strip.locator('[data-test="tab-new"]').click();
  await expect.poll(names).toEqual(['Alpha', 'Projects', 'Beta', 'Gamma', 'Volumes']);

  /**
   * And closing every one of them means starting again: a window with no tabs has
   * nowhere to be.
   */
  await strip.locator('[data-test="tab-close-all"]').click();
  await expect(tabs).toHaveCount(1);
  await expect(page).toHaveURL(/\/browse\/?$/);
  // With one tab there is nothing left to close them all with.
  await expect(strip.locator('[data-test="tab-close-all"]')).toHaveCount(0);

  // Back to the row the rest of this journey expects.
  for (const place of ['Projects/Alpha', 'Projects/Beta', 'Projects']) {
    await strip.locator('[data-test="tab-new"]').click();
    await page.goto(`/browse/${place}`);
  }
  await expect(tabs).toHaveCount(4);

  /**
   * A folder tab comes back where it was, with what was selected still selected.
   *
   * The tab already holds its listing, its selection and the rename it is in the
   * middle of. Read again from the server, all of it goes and the reader lands at
   * the top of a folder they had scrolled — which is what it did, and no unit
   * suite can see it: jsdom has no layout, so nothing there ever scrolls.
   */
  await tabs.first().getByRole('tab').click();
  await page.goto('/browse/Projects/Many');
  const rows = page.locator('[data-selected]');
  await expect(rows.first()).toBeVisible();

  // The listing's own scroller, which is what the view scrolls and remembers.
  const folderScrollTop = () =>
    page.evaluate(() => {
      const target = document.querySelector('.upload-drop-target');
      return Math.round(target?.scrollTop ?? 0);
    });

  // Somewhere in the middle of it, and one file chosen there.
  await page.locator('.upload-drop-target').evaluate((node) => {
    node.scrollTop = 900;
  });
  await page.locator('[title="file-120.txt"]').first().scrollIntoViewIfNeeded();
  await page.locator('[title="file-120.txt"]').first().click();
  await expect(page.locator('[title="file-120.txt"][data-selected="true"]').first()).toBeVisible();
  const scrolledTo = await folderScrollTop();
  expect(scrolledTo).toBeGreaterThan(0);

  const manyTab = strip.locator('[role="tab"][title="Many"]');
  await strip.locator('[data-test="tab"]').last().getByRole('tab').click();
  await expect(page).not.toHaveURL(/\/browse\/Projects\/Many$/);
  await manyTab.click();
  await expect(page).toHaveURL(/\/browse\/Projects\/Many$/);

  // Still chosen, and back where it was rather than at the top.
  await expect(page.locator('[title="file-120.txt"][data-selected="true"]').first()).toBeVisible();
  await expect.poll(folderScrollTop).toBeGreaterThan(scrolledTo - 20);

  /**
   * And the same in a folder long enough that it is not all drawn at once.
   *
   * This is where it went wrong for real. A hundred and sixty rows are on the
   * page the moment it renders, so one frame is enough to put a tab back where
   * it was; twelve hundred are drawn a screenful at a time, and on the frame the
   * place is asked for the container is barely a screen tall. The browser clamps
   * a position no container can hold, and clamping it lands at the top — with
   * the selection sitting there intact, which is exactly how it was reported.
   */
  await page.goto('/browse/Projects/Deep');
  await expect(page.locator('[title="row-0001.txt"]').first()).toBeVisible();

  // In the list view, where a folder this long is drawn as a window over it
  // rather than as twelve hundred rows: the rows on screen are decided from the
  // scroll position and the height of the box, and on the frame a returning tab
  // asks to be put back, neither of those is known yet.
  //
  // It is also what makes this folder look different from every other one, which
  // is the other half of what is being asked here: how a folder is shown is its
  // own preference, walking into another folder applies that folder's to the
  // window, and where the reader was is remembered per view because the same
  // folder is a different height in each.
  await page.getByRole('button', { name: 'List view' }).first().click();
  await expect(page.locator('[data-test="listing"]')).toHaveAttribute('data-view', 'list');
  // Read back from the server, so what follows is not racing the save.
  await page.goto('/browse/Projects/Deep');
  await expect(page.locator('[data-test="listing"]')).toHaveAttribute('data-view', 'list');
  await expect(page.locator('[title="row-0001.txt"]').first()).toBeVisible();

  await page.locator('.upload-drop-target').evaluate((node) => {
    node.scrollTop = 4000;
  });
  await expect.poll(folderScrollTop).toBeGreaterThan(3500);
  const deepScrolledTo = await folderScrollTop();

  // The tab that was on Many is the one now on Deep: it is where `goto` went.
  const deepTab = strip.locator('[role="tab"][title="Deep"]');
  await strip.locator('[data-test="tab"]').last().getByRole('tab').click();
  await expect(page).not.toHaveURL(/\/browse\/Projects\/Deep$/);
  await deepTab.click();
  await expect(page).toHaveURL(/\/browse\/Projects\/Deep$/);

  // Shown the way this folder is shown, rather than the way the tab it was left
  // for was — and therefore asked about under the right view.
  await expect(page.locator('[data-test="listing"]')).toHaveAttribute('data-view', 'list');
  await expect.poll(folderScrollTop).toBeGreaterThan(deepScrolledTo - 40);

  // Back to the view the rest of this journey is written against.
  await page.getByRole('button', { name: 'Grid view' }).first().click();

  /**
   * A tab kept on purpose, and the same place beside itself.
   *
   * Both live in the tab's own menu, and both are only provable in a browser: a
   * pinned tab has no name and no cross, which is a question about what is drawn,
   * and a duplicate is a second tab that has to arrive beside the first rather
   * than at the end of the row.
   */
  await page.goto('/browse/Projects/Twin');
  const twinTab = strip.locator('[data-test="tab"]').filter({
    has: page.locator('[role="tab"][title="Twin"]'),
  });
  // Waited for before the row is counted, because `count` is a snapshot and does not
  // retry: `goto` answers when the document has loaded, and the strip arrives a chunk
  // later, with the route the address names. A count taken in that gap reads nothing
  // at all, and every count this journey compares against it is then measured from
  // zero — which is exactly how this read four tabs as none.
  await expect(twinTab).toHaveCount(1);
  /**
   * The tab's own menu, and a check that it can actually be pressed.
   *
   * `toBeVisible` is not that check, and said so: the menu used to be drawn inside the
   * tab, and the strip is `overflow-hidden` — which is what makes tabs share the room
   * and narrow instead of spilling out of the row — so the menu was clipped away
   * entirely. An element clipped by an ancestor still has a box and still reports
   * visible, which is why this journey watched the menu open for weeks while nobody
   * could pin a tab or duplicate one.
   *
   * What discriminates is what the browser says is *under the pointer* there.
   */
  const openTabMenu = async (tab) => {
    await tab.getByRole('tab').click({ button: 'right' });
    const menu = page.locator('[data-test="tab-menu"]');
    await expect(menu).toBeVisible();
    const box = await menu.boundingBox();
    const onTop = await page.evaluate(
      ([x, y]) => {
        const at = document.elementFromPoint(x, y);
        return Boolean(at && at.closest('[data-test="tab-menu"]'));
      },
      [box.x + box.width / 2, box.y + 8]
    );
    expect(onTop).toBe(true);
    return menu;
  };

  const openTabs = await tabs.count();
  await openTabMenu(twinTab.first());
  await page.locator('[data-test="tab-duplicate"]').click();
  await expect(tabs).toHaveCount(openTabs + 1);
  // Beside the one it came from, and in front.
  const titles = await strip
    .locator('[data-test="tab"] [role="tab"]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('title')));
  expect(titles.filter((title) => title === 'Twin')).toHaveLength(2);
  expect(titles.indexOf('Twin') + 1).toBe(titles.lastIndexOf('Twin'));
  await expect(page).toHaveURL(/\/browse\/Projects\/Twin$/);

  // And away again, so the rest of this journey counts what it expects to.
  await strip
    .locator('[data-test="tab"][data-active="true"] [data-test="tab-close"]')
    .first()
    .click();
  await expect(tabs).toHaveCount(openTabs);

  await openTabMenu(twinTab.first());
  await page.locator('[data-test="tab-pin"]').click();

  const pinned = strip.locator('[data-test="tab"][data-pinned="true"]');
  await expect(pinned).toHaveCount(1);
  // At the front of the row, its icon and nothing else, and no cross to lose it by.
  await expect(strip.locator('[data-test="tab"]').first()).toHaveAttribute('data-pinned', 'true');
  await expect(pinned.getByRole('tab')).toHaveText('');
  await expect(pinned.locator('[data-test="tab-close"]')).toHaveCount(0);

  // Closing them all leaves it: that is what keeping a tab means.
  await page.locator('[data-test="tab-close-all"]').click();
  await expect(tabs).toHaveCount(1);
  await expect(strip.locator('[data-test="tab"]').first()).toHaveAttribute('data-pinned', 'true');

  await openTabMenu(pinned.first());
  await page.locator('[data-test="tab-pin"]').click();
  await expect(strip.locator('[data-test="tab"][data-pinned="true"]')).toHaveCount(0);

  /**
   * Where a tab has been is the tab's, not the window's.
   *
   * Pressing Back with several tabs open used to take the reader to whatever
   * address they last looked at, in whichever tab that was. Only a browser can
   * answer this: it is the toolbar's own button, and it is about what the history
   * of a window does when two tabs have been walking about in it.
   */
  await page.goto('/browse/Projects');
  await page.locator('[title="Alpha"]:not([role="tab"])').first().dblclick();
  await expect(page).toHaveURL(/\/browse\/Projects\/Alpha$/);

  // A second tab, walked somewhere else entirely.
  await page.locator('[data-test="tab-new"]').click();
  await page.goto('/browse/Projects/Beta');
  await expect(page).toHaveURL(/\/browse\/Projects\/Beta$/);

  // Back in the first tab walks *its* trail, not the window's.
  await strip.locator('[data-test="tab"]').first().getByRole('tab').click();
  await expect(page).toHaveURL(/\/browse\/Projects\/Alpha$/);
  await page.locator('[data-test="nav-back"]').click();
  await expect(page).toHaveURL(/\/browse\/Projects$/);
  // And forward again, in the same tab.
  await page.locator('[data-test="nav-forward"]').click();
  await expect(page).toHaveURL(/\/browse\/Projects\/Alpha$/);

  // A tab that has been nowhere says so, rather than leaving through the window
  // into whatever another tab was looking at.
  await page.locator('[data-test="tab-new"]').click();
  await expect(page).toHaveURL(/\/browse\/?$/);
  await expect(page.locator('[data-test="nav-back"]')).toBeDisabled();

  await page.locator('[data-test="tab-close-all"]').click();

  /**
   * Files dropped onto a tab.
   *
   * A tab is a folder that is already open, which makes it the cheapest target
   * there is for a move. The drag is dispatched rather than performed: what is
   * being asked is whether the strip reads it and whether the file really moves,
   * and a synthetic drag answers both without depending on how a headless browser
   * drives a mouse.
   */
  fs.writeFileSync(path.join(volume, 'Alpha', 'to-move.txt'), 'moved by a tab\n');
  await page.goto('/browse/Projects/Alpha');
  await expect(page.locator('[title="to-move.txt"]').first()).toBeVisible();
  await page.locator('[data-test="tab-new"]').click();
  await page.goto('/browse/Projects/Beta');
  await strip.locator('[data-test="tab"]').first().getByRole('tab').click();
  await expect(page).toHaveURL(/\/browse\/Projects\/Alpha$/);

  const betaTab = strip.locator('[data-test="tab"]').filter({
    has: page.locator('[role="tab"][title="Beta"]'),
  });
  await betaTab.first().evaluate((node) => {
    const transfer = new DataTransfer();
    transfer.setData(
      'application/json',
      JSON.stringify([{ name: 'to-move.txt', path: 'Projects/Alpha', kind: 'txt' }])
    );
    for (const type of ['dragover', 'drop']) {
      node.dispatchEvent(
        new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true })
      );
    }
  });

  await expect
    .poll(() => onDisk('Beta', 'to-move.txt'), { timeout: 15_000 })
    .toBe('moved by a tab\n');
  expect(fs.existsSync(path.join(volume, 'Alpha', 'to-move.txt'))).toBe(false);

  await page.locator('[data-test="tab-close-all"]').click();

  /**
   * Several entries chosen, several tabs.
   *
   * Opening the first and dropping the rest is the kind of answer that makes
   * somebody stop using the menu — they said what they wanted, once per entry.
   */
  await page.goto('/browse/Projects');
  await page.locator('[title="Alpha"]:not([role="tab"])').first().click();
  await page
    .locator('[title="Beta"]:not([role="tab"])')
    .first()
    .click({ modifiers: ['Meta'] });
  await page.locator('[title="Beta"]:not([role="tab"])').first().click({ button: 'right' });
  await page.getByText(/Open 2 in new tabs/).click();

  await expect(tabs).toHaveCount(3);
  const opened = await strip
    .locator('[data-test="tab"] [role="tab"]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('title')));
  expect(opened).toContain('Alpha');
  expect(opened).toContain('Beta');

  await page.locator('[data-test="tab-close-all"]').click();

  /**
   * The strip does not make the page taller than the window.
   *
   * It did: added above a layout that was already a viewport tall, every screen
   * became the viewport *plus* the strip, the document grew a scrollbar and the
   * bottom of every folder sat below the fold. The reachability sweeps at the end
   * of this file did not see it — content you can scroll to is reachable — so this
   * is the assertion that would have.
   */
  const overflowing = () =>
    page.evaluate(() => {
      const root = document.scrollingElement || document.documentElement;
      return {
        scrollHeight: root.scrollHeight,
        clientHeight: root.clientHeight,
        scrollWidth: root.scrollWidth,
        clientWidth: root.clientWidth,
      };
    });

  for (const route of ['/browse/Projects', '/trash', '/settings/user-preferences']) {
    await page.goto(route);
    await expect(strip).toBeVisible();
    const box = await overflowing();
    expect(box.scrollHeight, `${route} is taller than the window: ${JSON.stringify(box)}`).toBe(
      box.clientHeight
    );
    expect(box.scrollWidth, `${route} is wider than the window: ${JSON.stringify(box)}`).toBe(
      box.clientWidth
    );
  }

  // On a phone the strip is the one thing added above everything else, and the
  // width it wants does not exist there. It has to scroll inside itself rather
  // than push the page sideways or cover anything — checked with the same reader
  // the sweeps at the end of this file use, since those run with tabs off.
  await page.setViewportSize({ width: 390, height: 844 });
  try {
    await page.goto('/browse/Projects');
    await expect(strip).toBeVisible();
    await page.mouse.move(2, 2);
    const hidden = await page.evaluate(findUnreachableContent);
    expect(
      hidden,
      `the strip hides content on a phone: ${JSON.stringify(hidden, null, 2)}`
    ).toEqual([]);
    const box = await overflowing();
    expect(box.scrollHeight, `a phone scrolls the page: ${JSON.stringify(box)}`).toBe(
      box.clientHeight
    );
  } finally {
    await page.setViewportSize({ width: 1280, height: 720 });
  }

  await page.goto('/settings/user-preferences');
  await preference.click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(preference).toHaveAttribute('aria-checked', 'false');
  await expect(strip).toHaveCount(0);
});

test('the search index and folder sizes switch on from Settings, and the About page lists the tools', async () => {
  await page.goto('/settings/search-index');
  const indexSwitch = page.locator('[data-testid="search-index-switch"]');
  // Off, and movable: this installation's environment says nothing about it.
  await expect(indexSwitch).toHaveAttribute('aria-checked', 'false');
  await expect(indexSwitch).toBeEnabled();
  await expect(page.locator('[data-testid="feature-off-notice"]')).toContainText('switch above');

  await indexSwitch.click();
  await expect(indexSwitch).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('[data-testid="feature-off-notice"]')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('[data-testid="search-index-switch"]')).toHaveAttribute(
    'aria-checked',
    'true'
  );

  await page.goto('/settings/folder-size');
  const mode = page.locator('[data-testid="folder-size-mode"]');
  await expect(mode).toHaveValue('off');
  await mode.selectOption('full');
  await expect(page.locator('[data-testid="feature-off-notice"]')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('[data-testid="folder-size-mode"]')).toHaveValue('full');

  await page.goto('/settings/about');
  const tools = page.locator('[data-testid="about-tools"]');
  await expect(tools).toBeVisible();
  // Every one, whatever this machine happens to have installed.
  await expect(tools.locator('li')).toHaveCount(7);
  await expect(page.locator('[data-testid="about-tool-status-ffmpeg"]')).toBeVisible();

  // And off again the same way, which is the other half of a switch — and
  // leaves the tests after this one the installation they were written for.
  // Left on, the index answers names from its catalogue, which learns of files
  // written straight to the disk at its next pass, not at once: the search
  // below for three hundred files planted a moment before found none.
  await page.goto('/settings/search-index');
  await page.locator('[data-testid="search-index-switch"]').click();
  await expect(page.locator('[data-testid="search-index-switch"]')).toHaveAttribute(
    'aria-checked',
    'false'
  );
  await page.goto('/settings/folder-size');
  await page.locator('[data-testid="folder-size-mode"]').selectOption('off');
  await expect(page.locator('[data-testid="feature-off-notice"]')).toBeVisible();
  await page.reload();
  await expect(page.locator('[data-testid="folder-size-mode"]')).toHaveValue('off');
  await page.goto('/settings/search-index');
  await expect(page.locator('[data-testid="search-index-switch"]')).toHaveAttribute(
    'aria-checked',
    'false'
  );
});

/**
 * A volume nothing can be written in, and a rule written for a folder.
 *
 * A volume bound `:ro`, or one the server's user may not write in, looked like
 * any other until something was attempted in it — offered New and Upload, to an
 * administrator above all — and a rule typed from the host's side of a mount
 * was saved and matched nothing (nxzai/NextExplorer#407). A read-only mount
 * cannot be made here; a folder the server may not write in can, and it is the
 * same question to the system. Root writes through any mode, so this is only
 * asked of a server that does not run as root.
 */
test('a volume nothing can be written in is marked, and a rule’s folder is chosen or corrected', async () => {
  const locked = path.join(process.env.E2E_ROOT, 'volumes', 'Locked');
  fs.mkdirSync(locked, { recursive: true });
  fs.writeFileSync(path.join(locked, 'readme.txt'), 'read me');
  const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  fs.chmodSync(locked, 0o555);
  try {
    await page.goto('/browse/');
    await page.reload();
    const lockedMarks = page
      .locator('button', { hasText: 'Locked' })
      .locator('[data-testid="volume-read-only"]');
    if (asRoot) {
      await expect(lockedMarks).toHaveCount(0);
    } else {
      // On the home page and in the sidebar alike, and on that volume only.
      await expect(lockedMarks).toHaveCount(2);
      await expect(lockedMarks.first()).toHaveAttribute('data-reason', 'permission');
      await expect(
        page.locator('button', { hasText: 'Projects' }).locator('[data-testid="volume-read-only"]')
      ).toHaveCount(0);

      // Inside it, what can be read still is, and nothing offers to write.
      await page.goto('/browse/Locked');
      await expect(page.getByText('readme.txt')).toBeVisible();
      await expect(page.locator('button[title="New"]')).toHaveCount(0);
      await page.goto('/browse/Projects');
      await expect(page.locator('button[title="New"]')).toBeVisible();
    }
  } finally {
    fs.chmodSync(locked, 0o755);
  }

  // The rule's folder, chosen rather than typed. The tab names the section, where
  // every page of the settings used to read "Volumes".
  await page.goto('/settings/access-control');
  await expect(page).toHaveTitle('Access Control | Explorer');
  await page.getByRole('button', { name: 'Add rule' }).click();
  const pathField = page.locator('[data-test="access-rule-path"]').last();
  await page.locator('[data-test="access-rule-browse"]').last().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('option', { name: 'Projects' }).click();
  await dialog.locator('[data-testid="storage-picker-choose-folder"]').click();
  await expect(pathField).toHaveValue('Projects');
  await expect(page.locator('[data-test="access-rule-path-warning"]')).toHaveCount(0);

  // Typed from the container's side of the mount, it names nothing — and the
  // folder meant is offered.
  await pathField.fill('mnt/Projects');
  const warning = page.locator('[data-test="access-rule-path-warning"]');
  await expect(warning).toBeVisible();
  await warning.locator('[data-test="access-rule-path-suggestion"]').click();
  await expect(pathField).toHaveValue('Projects');
  await expect(warning).toHaveCount(0);

  // Nothing of this is kept: the tests after this one expect no rules.
  await page.getByRole('button', { name: 'Discard' }).click();
  await expect(page.locator('[data-test="access-rule-path"]')).toHaveCount(0);
});

/**
 * No screen may hide content where nothing can scroll.
 *
 * This is the last test on purpose: it fills the installation with more than
 * fits — thirty volumes, three hundred files, a nine-hundred-line file — and
 * then looks at every screen for the shape of the defect reported as #10
 * rather than for the defect itself. That shape is content taller than its box
 * with nothing scrollable between it and the first ancestor that clips, and
 * looking for it found three more the day #10 was fixed: the search results
 * showed ten of a hundred matches, the dashboard clipped its last volumes, and
 * the sidebar could only be scrolled by a pointer that hovered it.
 *
 * A screen that does not load proves nothing, so each one names something that
 * has to be on it before it is judged.
 */
test('no screen hides content where nothing can scroll', async () => {
  const volumes = path.join(process.env.E2E_ROOT, 'volumes');
  for (let index = 1; index <= 30; index += 1) {
    const extra = path.join(volumes, `Volume-${String(index).padStart(2, '0')}`);
    fs.mkdirSync(extra, { recursive: true });
    fs.writeFileSync(path.join(extra, 'one.txt'), 'x');
  }
  for (let index = 1; index <= 300; index += 1) {
    fs.writeFileSync(path.join(volume, `many-${String(index).padStart(3, '0')}.txt`), 'x');
  }
  fs.writeFileSync(
    path.join(volume, 'wall-of-text.md'),
    Array.from({ length: 900 }, (_, line) => `line ${line + 1}`).join('\n')
  );

  // Markers that do not depend on which rows happen to be drawn: the folder
  // listing renders only what is in view and in whatever order it was last
  // sorted, so naming one file is a coin toss — any of the three hundred
  // proves the screen is there.
  const screens = [
    ['the dashboard, with thirty volumes', '/browse/', 'text=Volume-30'],
    ['a folder of three hundred files', '/browse/Projects', 'text=/many-\\d{3}\\.txt/'],
    ['the editor on a long file', '/editor/Projects/wall-of-text.md', '.cm-content'],
    ['the search results', '/search?q=many', 'text=/many-\\d{3}\\.txt/'],
    ['the accounts in the settings', '/settings/admin-users', 'text=admin@example.com'],
    ['the activity log in the settings', '/settings/activity', 'text=Activity log'],
    ['the API tokens in the settings', '/settings/account-api-tokens', 'text=New token'],
    [
      'a document at its own address',
      '/open/Projects/wall-of-text.md',
      '[data-test="preview-surface"]',
    ],
    ['the trash', '/trash', 'body'],
  ];

  for (const [what, route, marker] of screens) {
    await page.goto(route);
    // Loaded afresh rather than navigated to: the stores this page already
    // holds were filled before the volumes above existed.
    await page.reload();
    // Nothing is judged before the screen is actually there.
    await expect(page.locator(marker).first()).toBeVisible({ timeout: 15000 });
    // The pointer parked away from everything: a panel that scrolls only
    // under a hovering pointer is one a touch screen cannot scroll at all.
    await page.mouse.move(2, 2);

    const found = await page.evaluate(findUnreachableContent);
    expect(found, `${what} (${route}) hides content: ${JSON.stringify(found, null, 2)}`).toEqual(
      []
    );
  }
});

/**
 * The same question for what opens on top of a screen.
 *
 * A panel or a dialog is a box with a height of its own, which is exactly
 * where content with nowhere to go hides: the list inside it is short in the
 * seeded state of most tests and long in somebody's real installation. Each
 * one is filled with more than fits before it is looked at.
 */
test('no panel or dialog hides content where nothing can scroll', async () => {
  // Whichever row the listing drew, rather than one named in advance: it
  // renders what is in view, in the order it was last sorted.
  const aRow = () => page.getByRole('button', { name: /^Select many-/ }).first();
  const rightClick = async () => {
    await page.goto('/browse/Projects');
    await expect(aRow()).toBeVisible();
    await aRow().click({ button: 'right' });
  };

  const surfaces = [
    [
      'the info panel',
      async () => {
        await rightClick();
        // The entries of this menu are buttons, as the tests above use them.
        await page.getByRole('button', { name: 'Get Info' }).click();
      },
      '[aria-label="Info panel"]',
    ],
    [
      'the share dialog',
      async () => {
        await page.goto('/browse/Projects');
        await expect(aRow()).toBeVisible();
        await aRow().click();
        await page.getByRole('button', { name: 'Share selected item' }).click();
      },
      'role=dialog',
    ],
    [
      'the notifications panel',
      async () => {
        await page.goto('/browse/Projects');
        await page.getByRole('button', { name: 'Open notifications' }).click();
      },
      // The close button carries its label in a screen-reader span rather
      // than an attribute, so the heading is what says the panel is open.
      'role=heading[name="Notifications"]',
    ],
  ];

  for (const [what, open, marker] of surfaces) {
    await open();
    await expect(page.locator(marker).first()).toBeVisible({ timeout: 10000 });
    await page.mouse.move(2, 2);

    const found = await page.evaluate(findUnreachableContent);
    expect(found, `${what} hides content: ${JSON.stringify(found, null, 2)}`).toEqual([]);
    await page.keyboard.press('Escape');
  }
});

/**
 * And on a phone, where every box is shorter and the same content has further
 * to go. The viewport is put back afterwards whatever happens: the tests in
 * this file share one page, in order.
 */
test('nothing is hidden on a phone either', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  try {
    const screens = [
      ['the dashboard', '/browse/', 'text=Volume-30'],
      ['a folder of three hundred files', '/browse/Projects', 'text=/many-\\d{3}\\.txt/'],
      ['the editor on a long file', '/editor/Projects/wall-of-text.md', '.cm-content'],
      ['the search results', '/search?q=many', 'text=/many-\\d{3}\\.txt/'],
      ['the accounts in the settings', '/settings/admin-users', 'text=admin@example.com'],
      ['the API tokens in the settings', '/settings/account-api-tokens', 'text=New token'],
    ];
    for (const [what, route, marker] of screens) {
      await page.goto(route);
      await page.reload();
      await expect(page.locator(marker).first()).toBeVisible({ timeout: 15000 });
      await page.mouse.move(2, 2);

      const found = await page.evaluate(findUnreachableContent);
      expect(
        found,
        `${what} (${route}) hides content on a phone: ${JSON.stringify(found, null, 2)}`
      ).toEqual([]);
    }
  } finally {
    await page.setViewportSize({ width: 1280, height: 720 });
  }
});

/**
 * A document opened and shut again and again, as fast as the clicks come.
 *
 * The same gesture in the application that `e2e/preview-detach.spec.js` drives
 * against the host on its own: open, shut, open, shut, without waiting for
 * anything to settle. Here it runs through the real screens, the real router and
 * the real preferences, which is what it takes to say the whole thing holds.
 */
test('opening and shutting documents one after another leaves nothing broken', async () => {
  fs.writeFileSync(path.join(volume, 'quick-one.md'), '# One\n');
  fs.writeFileSync(path.join(volume, 'quick-two.md'), '# Two\n');

  // In tabs, which is where it hurt: each document opens in one of ours and its
  // cross closes that tab again.
  await page.goto('/settings/user-preferences');
  const inTabs = page.locator('[data-test="browse-in-tabs"]');
  if ((await inTabs.getAttribute('aria-checked')) !== 'true') {
    await inTabs.click();
    await page.getByRole('button', { name: 'Save' }).click();
  }
  await expect(inTabs).toHaveAttribute('aria-checked', 'true');

  const surface = page.locator('[data-active="true"] [data-test="preview-surface"]');
  try {
    for (const name of ['quick-one.md', 'quick-two.md', 'quick-one.md', 'quick-two.md']) {
      await page.goto('/browse/Projects');
      await page.locator(`[title="${name}"]:not([role="tab"])`).first().dblclick();
      await expect(surface).toBeVisible();
      // Shut immediately, without waiting for anything to settle.
      await page.locator('[data-active="true"] [data-test="preview-close"]').click();
    }
  } finally {
    await page.goto('/settings/user-preferences');
    await inTabs.click();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(inTabs).toHaveAttribute('aria-checked', 'false');
  }
});

/**
 * Nothing the page threw, in any of it.
 *
 * Last on purpose: a render that dies leaves the screen half built and takes
 * every later one with it, and no single step fails on that — what was being
 * clicked is usually still there. The whole journey is the assertion.
 */
test('the page threw nothing along the way', () => {
  expect(thrown, `the page threw:\n${thrown.join('\n')}`).toEqual([]);
});
