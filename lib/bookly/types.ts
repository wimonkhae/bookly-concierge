export type Customer = {
  customerId: string;
  firstName: string;
  lastName: string;
  email: string;
  membership: "Bookly Plus" | "Standard";
  preferredChannel: "chat" | "voice";
};

export type OrderStatus = "processing" | "shipped" | "delivered" | "returned";

export type OrderItem = {
  itemId: string;
  title: string;
  price: number;
  returnable: boolean;
  returnId?: string;
};

export type Order = {
  orderId: string;
  customerId: string;
  status: OrderStatus;
  placedAt: string;
  deliveredAt?: string;
  carrier?: string;
  trackingNumber?: string;
  expectedDelivery?: string;
  items: OrderItem[];
};

export type PolicyTopic = "returns" | "refunds" | "shipping" | "damaged-items" | "password-reset";

export type Policy = {
  policyId: string;
  topic: PolicyTopic;
  title: string;
  summary: string;
  rules: string[];
};

export type ReturnRecord = {
  returnId: string;
  orderId: string;
  itemId: string;
  customerId: string;
  status: "registered" | "received" | "refunded";
  refundAmount: number;
  createdAt: string;
};

export type SupportTicket = {
  ticketId: string;
  customerId: string;
  status: "queued" | "open" | "resolved";
  reason: string;
  summary: string;
  createdAt: string;
};
