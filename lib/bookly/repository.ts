import { customers, orders, policies, returns, supportTickets } from "@/data/bookly";
import type { Customer, Order, Policy, PolicyTopic, ReturnRecord, SupportTicket } from "@/lib/bookly/types";

function newestFirst(left: Order, right: Order) {
  return right.placedAt.localeCompare(left.placedAt);
}

export function getCustomerById(customerId: string): Customer | undefined {
  return customers.find((customer) => customer.customerId === customerId);
}

export function getOrdersForCustomer(customerId: string): Order[] {
  return orders.filter((order) => order.customerId === customerId).sort(newestFirst);
}

export function getOrderForCustomer(customerId: string, orderId: string): Order | undefined {
  return orders.find((order) => order.orderId === orderId && order.customerId === customerId);
}

export function getLatestActiveOrder(customerId: string): Order | undefined {
  return getOrdersForCustomer(customerId).find(
    (order) => order.status === "processing" || order.status === "shipped",
  );
}

export function getLatestDeliveredOrder(customerId: string): Order | undefined {
  return getOrdersForCustomer(customerId).find((order) => order.status === "delivered");
}

export function getPolicyByTopic(topic: PolicyTopic): Policy | undefined {
  return policies.find((policy) => policy.topic === topic);
}

export function getAllPolicies(): Policy[] {
  return policies;
}

export function getReturnsForCustomer(customerId: string): ReturnRecord[] {
  return returns.filter((record) => record.customerId === customerId);
}

export function getSupportTicketsForCustomer(customerId: string): SupportTicket[] {
  return supportTickets.filter((ticket) => ticket.customerId === customerId);
}
