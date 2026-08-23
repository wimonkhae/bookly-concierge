import { describe, expect, test } from "vitest";
import { getSpeechText } from "../lib/speech/spoken-text";

describe("getSpeechText", () => {
  test("turns a raw refund response into a complete natural utterance", () => {
    expect(getSpeechText(
      "I checked your recent orders. For order ORD-0988, the return was refunded on 2026-07-08 for 16.99. If you don't see that credit on your statement around that date, I can open a ticket to trace the refund. Would you like me to do that?",
    )).toBe(
      "I checked your recent orders. For order number zero nine eight eight, the return was refunded on 8 July 2026 for 16 pounds and 99 pence. If you don't see that credit on your statement around that date, I can open a ticket to trace the refund. Would you like me to do that?",
    );
  });

  test("speaks the return reference instead of dropping it", () => {
    expect(getSpeechText("Done. Your return reference: RMA-1842. Is there anything else I can help with today?")).toBe(
      "Done. Your return reference is R M A 1 8 4 2. Is there anything else I can help with today?",
    );
  });
});
