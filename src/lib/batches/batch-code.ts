const batchCodeAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export function generateBatchCodeSuffix() {
  const suffix: string[] = [];
  while (suffix.length < 8) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    for (const byte of bytes) {
      if (byte >= 252) continue;
      suffix.push(batchCodeAlphabet[byte % batchCodeAlphabet.length]);
      if (suffix.length === 8) break;
    }
  }
  return suffix.join("");
}

export function generateBatchCode(
  datePlaced: string,
  suffix: string,
) {
  const dateParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePlaced);
  if (!dateParts) return "";
  const date = new Date(Date.UTC(
    Number(dateParts[1]),
    Number(dateParts[2]) - 1,
    Number(dateParts[3]),
  ));
  if (date.toISOString().slice(0, 10) !== datePlaced) return "";

  if (!/^[A-Z0-9]{8}$/.test(suffix)) return "";
  return `BAT-${suffix}`;
}
