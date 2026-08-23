import { getCustomerById } from "@/lib/bookly/repository";
import type { Customer } from "@/lib/bookly/types";

export type AuthenticatedSession = Readonly<{
  sessionId: string;
  customerId: string;
  createdAt: string;
}>;

export type SignInResult =
  | { success: true; session: AuthenticatedSession }
  | { success: false; errorCode: "CUSTOMER_NOT_FOUND" };

const sessions = new Map<string, AuthenticatedSession>();
let nextSessionId = 1;

export function signInAsCustomer(customerId: string): SignInResult {
  if (!getCustomerById(customerId)) {
    return { success: false, errorCode: "CUSTOMER_NOT_FOUND" };
  }

  const session = Object.freeze({
    sessionId: `mock-session-${nextSessionId++}`,
    customerId,
    createdAt: new Date().toISOString(),
  });

  sessions.set(session.sessionId, session);

  return { success: true, session };
}

export function getSession(sessionId: string): AuthenticatedSession | undefined {
  return sessions.get(sessionId);
}

export function getAuthenticatedCustomerId(sessionId: string): string | undefined {
  return getSession(sessionId)?.customerId;
}

export function getAuthenticatedCustomer(sessionId: string): Customer | undefined {
  const customerId = getAuthenticatedCustomerId(sessionId);

  return customerId ? getCustomerById(customerId) : undefined;
}

export function signOut(sessionId: string): void {
  sessions.delete(sessionId);
}

export function resetMockSessionsForTests(): void {
  sessions.clear();
  nextSessionId = 1;
}
