const SUPPORTED = new Set([
  'docx', 'doc', 'odt', 'rtf',
  'xlsx', 'xls', 'ods', 'csv',
  'pptx', 'ppt', 'odp',
]);

export const onlyofficePreviewPlugin = () => ({
  id: 'onlyoffice-editor',
  label: 'ONLYOFFICE',
  priority: 50,
  match: (ctx) => {
    const ext = String(ctx.extension || '').toLowerCase();
    return SUPPORTED.has(ext);
  },
  component: () => import('./OnlyOfficePreview.vue'),
  actions: (ctx) => [
    {
      id: 'download',
      label: 'Download',
      run: () => ctx.api.download(ctx.filePath),
    },
  ],
});
