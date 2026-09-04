import { expect, test } from '@playwright/test';

const dispatchTouchSwipe = async (page, locator, deltaX, deltaY) => {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Media preview is not visible');

  const session = await page.context().newCDPSession(page);
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  const touchPoint = (x, y) => ({
    force: 1,
    id: 1,
    radiusX: 1,
    radiusY: 1,
    x,
    y,
  });

  try {
    await session.send('Input.dispatchTouchEvent', {
      touchPoints: [touchPoint(startX, startY)],
      type: 'touchStart',
    });

    for (let step = 1; step <= 3; step += 1) {
      await session.send('Input.dispatchTouchEvent', {
        touchPoints: [touchPoint(startX + (deltaX * step) / 3, startY + (deltaY * step) / 3)],
        type: 'touchMove',
      });
    }

    await session.send('Input.dispatchTouchEvent', {
      touchPoints: [],
      type: 'touchEnd',
    });
  } finally {
    await session.detach();
  }
};

test('swipes through mixed media without treating vertical gestures as navigation', async ({ page }) => {
  await page.goto('/e2e/media-preview.html');

  const preview = page.locator('[data-test="media-preview"]');
  await expect(preview).toBeVisible();
  await expect(preview).toHaveCSS('touch-action', 'pan-y');

  await dispatchTouchSwipe(page, preview, -160, 0);
  await expect(page.locator('video')).toBeVisible();

  await dispatchTouchSwipe(page, preview, 160, 0);
  await expect(page.locator('img')).toBeVisible();

  await dispatchTouchSwipe(page, preview, 0, 160);
  await expect(page.locator('img')).toBeVisible();
});
