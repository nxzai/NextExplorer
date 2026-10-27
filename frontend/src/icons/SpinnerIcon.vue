<template>
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-opacity="0.25" stroke-width="3" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
  </svg>
</template>

<!--
  A spinner the size it is told to be.

  `LoadingIcon` cannot be: it is a box of twelve blades sized from `font-size: 48px`
  in a global stylesheet, and the `scale-50` that makes it *look* half that is a
  transform, which changes nothing about the room it takes. Put in a tab it was
  forty-eight pixels tall inside a row of twenty-four, so the strip grew and the
  whole page moved down.

  This one is an `svg` with a viewBox and no size of its own, so `h-4 w-4` is the
  size, `currentColor` is the colour, and `animate-spin` turns it. Nothing global,
  and nothing that can push a layout about.
-->
