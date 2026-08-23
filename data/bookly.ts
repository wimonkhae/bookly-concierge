import type { Customer, Order, Policy, ReturnRecord, SupportTicket } from "@/lib/bookly/types";

export const customers: Customer[] = [
  {
    customerId: "CUST-001",
    firstName: "Sarah",
    lastName: "Chen",
    email: "sarah.chen@example.com",
    membership: "Bookly Plus",
    preferredChannel: "voice",
  },
  {
    customerId: "CUST-002",
    firstName: "Daniel",
    lastName: "Ortiz",
    email: "daniel.ortiz@example.com",
    membership: "Standard",
    preferredChannel: "chat",
  },
  {
    customerId: "CUST-003",
    firstName: "Maya",
    lastName: "Patel",
    email: "maya.patel@example.com",
    membership: "Bookly Plus",
    preferredChannel: "chat",
  },
];

export const orders: Order[] = [
  {
    orderId: "ORD-1048",
    customerId: "CUST-001",
    status: "shipped",
    placedAt: "2026-08-19",
    carrier: "Royal Mail",
    trackingNumber: "RM-847201993",
    expectedDelivery: "2026-08-22",
    items: [
      {
        itemId: "ITEM-ORB-01",
        title: "Orbital",
        price: 14.99,
        returnable: true,
      },
    ],
  },
  {
    orderId: "ORD-1031",
    customerId: "CUST-001",
    status: "delivered",
    placedAt: "2026-08-07",
    deliveredAt: "2026-08-13",
    items: [
      {
        itemId: "ITEM-WOLF-01",
        title: "Wolf Hall",
        price: 18.99,
        returnable: true,
      },
      {
        itemId: "ITEM-MIDNIGHT-01",
        title: "The Midnight Library",
        price: 10.99,
        returnable: true,
      },
    ],
  },
  {
    orderId: "ORD-1010",
    customerId: "CUST-001",
    status: "delivered",
    placedAt: "2026-06-04",
    deliveredAt: "2026-06-09",
    items: [
      {
        itemId: "ITEM-SEA-01",
        title: "The Sea",
        price: 12.5,
        returnable: true,
      },
    ],
  },
  {
    orderId: "ORD-0988",
    customerId: "CUST-001",
    status: "returned",
    placedAt: "2026-07-01",
    deliveredAt: "2026-07-04",
    items: [
      {
        itemId: "ITEM-KLARA-01",
        title: "Klara and the Sun",
        price: 16.99,
        returnable: true,
        returnId: "RMA-1734",
      },
    ],
  },
  {
    orderId: "ORD-2042",
    customerId: "CUST-002",
    status: "delivered",
    placedAt: "2026-08-10",
    deliveredAt: "2026-08-15",
    items: [
      {
        itemId: "ITEM-SONG-01",
        title: "The Song of Achilles",
        price: 13.99,
        returnable: true,
      },
    ],
  },
  {
    orderId: "ORD-3055",
    customerId: "CUST-003",
    status: "processing",
    placedAt: "2026-08-20",
    items: [
      {
        itemId: "ITEM-TOMORROW-01",
        title: "Tomorrow, and Tomorrow, and Tomorrow",
        price: 15.99,
        returnable: true,
      },
    ],
  },
];

export const policies: Policy[] = [
  {
    policyId: "POL-RETURNS",
    topic: "returns",
    title: "Returns policy",
    summary: "Physical books can be returned within 30 days of delivery when they are returnable and in resellable condition.",
    rules: [
      "The item must belong to the customer requesting the return.",
      "The order must have been delivered within the previous 30 days.",
      "Previously returned and non-returnable items cannot be returned again.",
    ],
  },
  {
    policyId: "POL-REFUNDS",
    topic: "refunds",
    title: "Refunds policy",
    summary: "Approved refunds return to the original payment method within 3 to 5 business days after Bookly receives the item.",
    rules: [
      "A return must be registered before refund processing begins.",
      "Refund timing starts after Bookly receives the return.",
    ],
  },
  {
    policyId: "POL-SHIPPING",
    topic: "shipping",
    title: "Shipping policy",
    summary: "Tracking becomes available after dispatch. Bookly Plus members receive the fastest available standard delivery option.",
    rules: ["Expected delivery dates are estimates supplied by the carrier."],
  },
  {
    policyId: "POL-DAMAGED",
    topic: "damaged-items",
    title: "Damaged items policy",
    summary: "Damaged books may be eligible for a replacement or refund after Bookly support reviews the issue.",
    rules: ["Bookly may request supporting details before resolving a damaged-item claim."],
  },
  {
    policyId: "POL-PASSWORD",
    topic: "password-reset",
    title: "Password reset policy",
    summary: "Customers can use the password reset link from the Bookly sign-in page to regain account access.",
    rules: ["Bookly support will never ask for a customer password."],
  },
];

export const returns: ReturnRecord[] = [
  {
    returnId: "RMA-1734",
    orderId: "ORD-0988",
    itemId: "ITEM-KLARA-01",
    customerId: "CUST-001",
    status: "refunded",
    refundAmount: 16.99,
    createdAt: "2026-07-08",
  },
];

export const supportTickets: SupportTicket[] = [];
