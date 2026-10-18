// A typed money amount → number (NaN if it isn't one). Forgiving about how
// people type on a phone: "$5", "4,99" (comma decimal), "1,234.50", " 3 ".
export function parseAmount(value) {
  let s = String(value ?? '').replace(/[$\s]/g, '')
  // A lone comma is a decimal point ("4,99"); with a dot, commas group thousands
  s = s.includes('.') ? s.replace(/,/g, '') : s.replace(',', '.')
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return NaN
  return Number(s)
}

// For totals and optional fields: blank or invalid counts as 0
export const amountOrZero = value => parseAmount(value) || 0
