/*
 * The Document Server's script, in as much as anything here depends on it.
 *
 * `DocumentEditor` loads this from `<documentServerUrl>/web-apps/apps/api/documents/api.js`
 * and then calls `DocsAPI.DocEditor(id, config)`. The one thing the real one does
 * that matters to the page around it is this: the element it is handed is taken
 * out of the document and an `iframe` is put in its place. Everything the browser
 * bench exists to catch happens because of that — Vue goes on believing it owns a
 * node the page no longer has.
 *
 * Served as a real file at a real path, so the component's own `loadScript` runs
 * exactly as it does against a Document Server.
 */
(function () {
  window.DocEditor = window.DocEditor || { instances: {} };

  function DocEditor(placeholderId, config) {
    var placeholder = document.getElementById(placeholderId);
    var frame = document.createElement('iframe');
    frame.id = placeholderId;
    frame.className = 'h-full w-full';
    frame.dataset.document = (config && config.document && config.document.key) || placeholderId;
    frame.setAttribute('src', 'about:blank');
    if (placeholder && placeholder.parentNode) {
      placeholder.parentNode.replaceChild(frame, placeholder);
    }

    var events = (config && config.events) || {};
    var instance = {
      frame: frame,
      destroyEditor: function () {
        if (frame.parentNode) frame.parentNode.removeChild(frame);
      },
      requestClose: function () {
        if (events.onRequestClose) events.onRequestClose();
      },
      serviceCommand: function () {},
      showMessage: function () {},
      refreshHistory: function () {},
      setHistoryData: function () {},
      downloadAs: function () {},
      denyEditingRights: function () {},
    };

    // The editor reports itself ready a moment later, exactly as it does over a
    // network: that is when the page takes its own fallback close button away.
    setTimeout(function () {
      if (events.onAppReady) events.onAppReady();
      if (events.onDocumentReady) events.onDocumentReady();
    }, 0);

    window.DocEditor.instances[placeholderId] = instance;
    return instance;
  }

  window.DocsAPI = { DocEditor: DocEditor };
})();
