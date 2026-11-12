/** Fait télécharger `data` au navigateur sous le nom `name`. */
export function download(name: string, data: BlobPart, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000); // libérer tout de suite peut interrompre le téléchargement sur certains navigateurs
}
