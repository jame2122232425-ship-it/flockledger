type BatchType = "Broiler" | "Kienyeji";

function initials(value: string) {
  const parts = value.split(/[^a-z0-9]+/i).filter(Boolean);
  return parts.map((part) => part[0]).join("").slice(0, 8).toUpperCase() || "FL";
}

function houseToken(value: string) {
  const parts = value.trim().split(/[^a-z0-9]+/i).filter(Boolean);
  return parts.length ? parts[parts.length - 1].slice(0, 8).toUpperCase() : "";
}

export function generateBatchCode(
  farmName: string,
  batchType: BatchType,
  datePlaced: string,
  house: string,
  existingCodes: string[],
) {
  const dateParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePlaced);
  if (!dateParts) return "";
  const date = new Date(Date.UTC(
    Number(dateParts[1]),
    Number(dateParts[2]) - 1,
    Number(dateParts[3]),
  ));
  if (date.toISOString().slice(0, 10) !== datePlaced) return "";

  const typeCode = batchType === "Broiler" ? "BR" : "KJ";
  const houseCode = houseToken(house);
  const yearMonth = `${dateParts[1].slice(-2)}${dateParts[2]}`;
  const stem = [initials(farmName), typeCode, houseCode, yearMonth]
    .filter(Boolean)
    .join("-");
  const sequencePrefix = `${stem}-`;
  const lastUsed = existingCodes.reduce((highest, code) => {
    const normalizedCode = code.toUpperCase();
    if (!normalizedCode.startsWith(sequencePrefix)) return highest;
    const sequence = normalizedCode.slice(sequencePrefix.length);
    if (!/^\d+$/.test(sequence)) return highest;
    return Math.max(highest, Number(sequence));
  }, 0);

  return `${sequencePrefix}${String(lastUsed + 1).padStart(2, "0")}`;
}
