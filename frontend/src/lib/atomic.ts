export function parseAtomic(value: string, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 30) {
    throw new Error("Unsupported asset precision.");
  }
  const normalized = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(normalized)) {
    throw new Error("Enter a positive decimal amount.");
  }
  const [whole, fraction = ""] = normalized.split(".");
  if (fraction.length > decimals) {
    throw new Error(`Use no more than ${decimals} decimal places.`);
  }
  const atomic = `${whole}${fraction.padEnd(decimals, "0")}`.replace(
    /^0+(?=\d)/,
    "",
  );
  if (!/^[1-9]\d*$/.test(atomic)) {
    throw new Error("Amount must be greater than zero.");
  }
  if (atomic.length > 78) throw new Error("Amount is too large.");
  return atomic;
}

export function formatAtomic(value: string, decimals: number): string {
  if (!/^\d+$/.test(value) || !Number.isInteger(decimals) || decimals < 0) {
    return value;
  }
  const padded = value.padStart(decimals + 1, "0");
  const whole = decimals ? padded.slice(0, -decimals) : padded;
  const fraction = decimals ? padded.slice(-decimals).replace(/0+$/, "") : "";
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

export function assetLabel(assetId: string): string {
  if (assetId === "mock:near:usdc") return "Mock USDC · NEAR";
  if (assetId === "mock:base:usdc") return "Mock USDC · Base";
  if (assetId === "near:testnet:native") return "NEAR · testnet";
  return assetId;
}
