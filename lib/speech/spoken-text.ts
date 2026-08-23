function formatSpokenDate(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return value;
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function formatSpokenReference(reference: string): string {
  const [prefix, suffix] = reference.split("-");
  const spokenPrefix = prefix.split("").join(" ");
  const spokenSuffix = suffix.split("").join(" ");

  return `${spokenPrefix} ${spokenSuffix}`;
}

function formatSpokenOrder(orderId: string): string {
  const digits = orderId.replace(/^ORD-/i, "").split("");
  const digitNames = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

  return `order number ${digits.map((digit) => digitNames[Number(digit)] ?? digit).join(" ")}`;
}

function formatSpokenAmount(value: string): string {
  const [pounds, pence] = value.split(".");

  if (!pence) {
    return `${pounds} pounds`;
  }

  return `${pounds} pounds and ${pence} pence`;
}

/** Converts structured support details into an utterance that sounds complete when read aloud. */
export function getSpeechText(chatText: string): string {
  return chatText
    // A return reference is useful after the action completes, so say it clearly.
    .replace(/your return reference:\s*(RMA-\d+)\.?/gi, (_match, reference: string) => (
      `Your return reference is ${formatSpokenReference(reference)}.`
    ))
    // Speak the useful numeric part of an order ID, without the system-style ORD prefix.
    .replace(/\bfor order\s+(ORD-\d+)\b/gi, (_match, orderId: string) => (
      `For ${formatSpokenOrder(orderId)}`
    ))
    .replace(/\border\s+(ORD-\d+)\b/gi, (_match, orderId: string) => formatSpokenOrder(orderId))
    .replace(/\b(?:ORD|RMA)-[A-Z0-9-]+\b/gi, "")
    .replace(/\bITEM-[A-Z0-9-]+\b/gi, "")
    .replace(/\b[A-Z]{2,5}-\d{5,}\b/g, "")
    .replace(/[-\s]*(?:Order ID|Return ID|Item ID|Tracking number|Tracking):\s*/gi, "")
    .replace(/\(\s*\)/g, "")
    .replace(/Item:\s*/gi, "for ")
    .replace(/Refund status:\s*Refunded/gi, "It has been refunded")
    .replace(/Refund amount:\s*£?(\d+(?:\.\d{2})?)/gi, (_match, amount: string) => (
      `The refund amount was ${formatSpokenAmount(amount)}`
    ))
    .replace(/\bfor\s+£?(\d+\.\d{2})(?=\s*[.!?])/gi, (_match, amount: string) => (
      `for ${formatSpokenAmount(amount)}`
    ))
    .replace(/Processed on:\s*/gi, "It was processed on ")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, formatSpokenDate)
    .replace(/\s*[-•]\s*/g, ". ")
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/\.\s*\./g, ".")
    .replace(/\s{2,}/g, " ")
    .trim();
}
