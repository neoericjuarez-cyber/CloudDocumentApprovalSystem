/** Saves a file in the browser (what a "Download" button does). */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Opens the person's mail app with a new message (what a "Contact student" button does). */
export function openMail(to: string, subject: string) {
  const a = document.createElement("a");
  a.href = `mailto:${to}?subject=${encodeURIComponent(subject)}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
