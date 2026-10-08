export function formatFileSize(size: number) {
  if (size < 1024) return `${size}B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)}KB`;
  return `${(size / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")}MB`;
}

export function fileIconKind(name: string) {
  const extension = name.split(".").at(-1)?.toLowerCase();
  if (["doc", "docx", "pdf", "txt", "md"].includes(extension ?? ""))
    return "document";
  if (["xls", "xlsx", "csv"].includes(extension ?? "")) return "spreadsheet";
  if (["ppt", "pptx", "key"].includes(extension ?? "")) return "presentation";
  if (["zip", "gz", "tar", "7z", "rar"].includes(extension ?? ""))
    return "archive";
  return "file";
}
