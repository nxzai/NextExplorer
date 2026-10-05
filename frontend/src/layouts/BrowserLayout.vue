<template>
  <!--
    What is left of a layout: the screen for this address, and nothing around it.

    Everything that used to be here — the sidebar, the bar, the dialogs, the
    panes — belongs to the window and is drawn once in `App.vue`. It had to move:
    the panes were here, so a pane could only ever hold something *this* layout
    drew, and a document, a shell, the editor and a comparison are all outside it
    on purpose. A pane now draws the screen for its tab's address, whatever that
    address is.

    Kept as a record in the router rather than removed from it, so every address
    and every guard stays exactly as it was.
  -->
  <RouterView />
</template>
