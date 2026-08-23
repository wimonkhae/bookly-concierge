import { describe, expect, test } from "vitest";
import {
  getAllPolicies,
  getLatestActiveOrder,
  getLatestDeliveredOrder,
  getOrderForCustomer,
  getOrdersForCustomer,
  getReturnsForCustomer,
} from "@/lib/bookly/repository";

describe("Bookly fixture repository", () => {
  test("returns Sarah's current shipment as her latest active order", () => {
    const order = getLatestActiveOrder("CUST-001");

    expect(order).toMatchObject({
      orderId: "ORD-1048",
      status: "shipped",
      expectedDelivery: "2026-08-22",
    });
  });

  test("returns Sarah's latest delivered order with two return candidates", () => {
    const order = getLatestDeliveredOrder("CUST-001");

    expect(order?.orderId).toBe("ORD-1031");
    expect(order?.items.map((item) => item.title)).toEqual(["Wolf Hall", "The Midnight Library"]);
  });

  test("keeps Sarah's orders ordered from newest to oldest", () => {
    expect(getOrdersForCustomer("CUST-001").map((order) => order.orderId)).toEqual([
      "ORD-1048",
      "ORD-1031",
      "ORD-0988",
      "ORD-1010",
    ]);
  });

  test("does not return another customer's order", () => {
    expect(getOrderForCustomer("CUST-001", "ORD-2042")).toBeUndefined();
  });

  test("includes an expired-return and a previously returned scenario", () => {
    const oldOrder = getOrderForCustomer("CUST-001", "ORD-1010");
    const completedReturn = getReturnsForCustomer("CUST-001");

    expect(oldOrder?.deliveredAt).toBe("2026-06-09");
    expect(completedReturn).toContainEqual(
      expect.objectContaining({ returnId: "RMA-1734", status: "refunded" }),
    );
  });

  test("provides the five Bookly policy topics", () => {
    expect(getAllPolicies().map((policy) => policy.topic)).toEqual([
      "returns",
      "refunds",
      "shipping",
      "damaged-items",
      "password-reset",
    ]);
  });
});
