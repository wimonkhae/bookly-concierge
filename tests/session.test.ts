import { afterEach, describe, expect, test } from "vitest";
import { getOrderForCustomer } from "@/lib/bookly/repository";
import {
  getAuthenticatedCustomer,
  getAuthenticatedCustomerId,
  getSession,
  resetMockSessionsForTests,
  signInAsCustomer,
  signOut,
} from "@/lib/session/session";

afterEach(() => {
  resetMockSessionsForTests();
});

describe("mock authentication sessions", () => {
  test("signs in a seeded customer with an immutable customer identity", () => {
    const result = signInAsCustomer("CUST-001");

    expect(result).toMatchObject({
      success: true,
      session: { customerId: "CUST-001" },
    });
    expect(result.success && Object.isFrozen(result.session)).toBe(true);
  });

  test("rejects sign-in for an unknown customer", () => {
    expect(signInAsCustomer("CUST-404")).toEqual({
      success: false,
      errorCode: "CUSTOMER_NOT_FOUND",
    });
  });

  test("keeps customers isolated when separate sessions are created", () => {
    const sarah = signInAsCustomer("CUST-001");
    const daniel = signInAsCustomer("CUST-002");

    if (!sarah.success || !daniel.success) {
      throw new Error("Seeded customers must be able to sign in.");
    }

    expect(getAuthenticatedCustomerId(sarah.session.sessionId)).toBe("CUST-001");
    expect(getAuthenticatedCustomerId(daniel.session.sessionId)).toBe("CUST-002");
    expect(getOrderForCustomer(getAuthenticatedCustomerId(sarah.session.sessionId)!, "ORD-2042")).toBeUndefined();
    expect(getOrderForCustomer(getAuthenticatedCustomerId(daniel.session.sessionId)!, "ORD-2042")).toMatchObject({
      customerId: "CUST-002",
    });
  });

  test("can switch the mocked signed-in customer only by creating a new session", () => {
    const sarah = signInAsCustomer("CUST-001");
    const maya = signInAsCustomer("CUST-003");

    if (!sarah.success || !maya.success) {
      throw new Error("Seeded customers must be able to sign in.");
    }

    expect(sarah.session.sessionId).not.toBe(maya.session.sessionId);
    expect(getAuthenticatedCustomer(sarah.session.sessionId)?.firstName).toBe("Sarah");
    expect(getAuthenticatedCustomer(maya.session.sessionId)?.firstName).toBe("Maya");
  });

  test("invalidates a session on sign-out", () => {
    const result = signInAsCustomer("CUST-001");

    if (!result.success) {
      throw new Error("Sarah must be able to sign in.");
    }

    signOut(result.session.sessionId);

    expect(getSession(result.session.sessionId)).toBeUndefined();
  });
});
