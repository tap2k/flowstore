// Shared browser download helper. (Three older private copies exist in
// csvIO.tsx, ImportExport.tsx, and SimulatePanel.tsx — migrate them here
// when touched; the appendChild/remove dance matters on some Safari
// versions.)
export function downloadBlob(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
