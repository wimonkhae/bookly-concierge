# Bookly Concierge

An AI customer-support concierge for Bookly. It handles order status, returns, policy questions, human escalation, and text or voice conversations through a constrained tool surface.

## Features

- Order status
- Returns with clarification and explicit confirmation
- Policy questions
- Human escalation for unverified outcomes
- Text and voice conversations

## Tech Stack

- Next.js 16 with the App Router
- React 19 and TypeScript
- OpenAI JavaScript SDK with the Responses API, speech-to-text, and text-to-speech
- CSS modules-free global styling in `app/globals.css`
- Vitest for unit and evaluation tests
- ESLint and TypeScript for static checks

## Prerequisites

- Node.js 20 or later
- An OpenAI API key for chat and voice functionality

## Getting Started

Install dependencies and create a local environment file:

```bash
npm install
cp .env.example .env.local
```

Set your OpenAI API key in `.env.local`:

```bash
OPENAI_API_KEY=your_key_here
```

`OPENAI_MODEL` is optional and defaults to `gpt-5`.

Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The mock data and in-memory session state reset whenever the development server restarts.

## Available Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Next.js development server. |
| `npm run build` | Create a production build. |
| `npm run start` | Run the production build locally. |
| `npm run lint` | Run ESLint. |
| `npm run typecheck` | Run TypeScript without emitting files. |
| `npm test` | Run the complete Vitest test suite. |
| `npm run evals` | Run the focused adversarial evaluation cases. |
| `npm run test:watch` | Run Vitest in watch mode. |

## Prototype Accounts

The UI offers three mock Bookly customers. No password is required:

| Customer | Customer ID | Suggested use |
| --- | --- | --- |
| Sarah Chen | `CUST-001` | Primary prototype flow: recent order lookup and an eligible return for `Wolf Hall`. |
| Daniel Ortiz | `CUST-002` | Alternate customer and authorization-boundary checks. |
| Maya Patel | `CUST-003` | Alternate customer and policy questions. |

The primary prototype flow is: sign in as Sarah Chen, ask about the latest order, request a return, select `Wolf Hall`, and explicitly confirm the proposal. Ask about an unverified refund to see the escalation path.

## Architecture

![Bookly Concierge model and tool architecture](./detailed-architecture-diagram.png)

### Architecture Principle

**The model orchestrates; Bookly controls data, policy, and actions.**

OpenAI understands intent, continues the conversation, selects from a constrained tool set, and generates the customer-facing response. The Bookly application owns customer identity, retrieves data and policy, enforces business rules, holds pending state, executes approved actions, and creates human handoffs.

The exact [Responses API prompt](./lib/agent/bookly-concierge.ts#L153), [strict function schemas](./lib/agent/bookly-concierge.ts#L33), and [tool-call orchestrator](./lib/agent/bookly-concierge.ts) are kept in source so a reviewer can inspect the agent contract directly.

## Agent Flow

```text
User
  -> chat or voice
  -> OpenAI Responses agent
  -> function call
  -> Bookly tool
  -> deterministic validation
  -> tool result
  -> agent response
```

Conversation continuity uses the Responses API `previous_response_id`. Authorization and transactional state remain in Bookly-owned session and pending-action state, rather than in model-generated arguments.

## Tools

| Tool | Purpose |
| --- | --- |
| `get_recent_orders` | Retrieve the authenticated customer's orders. |
| `get_order_status` | Check authoritative delivery or fulfillment status. |
| `get_order_details` | Retrieve order items and delivery details. |
| `check_return_eligibility` | Validate ownership, return rules, refund amount, and deadline. |
| `prepare_return` | Create a pending proposal for one eligible item. |
| `prepare_returns` | Create one pending proposal for multiple eligible items from the same order. |
| `lookup_policy` | Retrieve an approved Bookly policy answer. |
| `get_refund_status` | Check the refund state for a customer-owned order. |
| `escalate_to_human` | Create a contextual support handoff. |

The full model-accessible tool surface is defined in [`bookly-concierge.ts`](./lib/agent/bookly-concierge.ts#L33); the deterministic implementations are in [`bookly-tools.ts`](./lib/tools/bookly-tools.ts).

## Safe Actions

```text
prepare_return
  -> pending proposal
  -> explicit customer confirmation
     -> yes: confirm and create return
     -> no:  cancel proposal
```

The model cannot directly create a return. `prepare_return` validates the authenticated customer's ownership and the item's eligibility, then creates a pending action. The application recognizes a narrow set of explicit confirmations and only then calls the application-only `confirmReturn` and `createReturn` operations.

Inspect the [confirmation resolver](./lib/agent/bookly-concierge.ts#L345), [eligibility and return implementation](./lib/tools/bookly-tools.ts#L149), and [pending-action state machine](./lib/guardrails/return-actions.ts#L54) to follow this boundary end to end.

## Grounding And Policy

The prototype uses structured Bookly policy data. This is deliberate: the policy set is small and controlled, so additional search infrastructure would add complexity without meaningful benefit. `lookup_policy` remains an abstraction boundary as Bookly's knowledge base grows.

## Customer Identity And Authorization

Customer identity comes from the authenticated Bookly session, never from a model-generated customer ID. Tools enforce customer ownership before returning order data or performing an action. The relevant [session implementation](./lib/session/session.ts), [order ownership check](./lib/tools/bookly-tools.ts#L62), and [pending-action ownership check](./lib/guardrails/return-actions.ts#L37) are linked for review.

## Voice

```text
Microphone -> speech-to-text -> same Bookly agent -> text response -> text-to-speech
```

Text and voice share the same agent, tools, guardrails, and conversation logic.

## Evaluation

Key scenarios covered by the test suite:

- Latest-order lookup
- Ambiguous return leading to clarification
- Eligible return proposal and confirmation
- Return attempt without confirmation
- Expired or ineligible return
- Cross-customer order and action access
- Policy question grounding
- Refund escalation
- Tool failures and confirmation-bypass attempts

Run the checks with:

```bash
npm run lint
npm run typecheck
npm test
npm run evals
npm run build
```

See the [concierge tests](./tests/bookly-concierge.test.ts), [return guardrail tests](./tests/return-guardrails.test.ts), and [functional/adversarial evals](./tests/bookly-evals.test.ts).

## What I Would Change In Production

| Prototype | Production |
| --- | --- |
| Mock customer data | Bookly customer APIs |
| Mock orders and returns | Order-management system |
| Structured policies | Production knowledge source |
| Mock authentication | Production identity and authorization |
| Local trace store | Central observability and audit trail |
| Small evaluation set | Continuous evaluation from support data |
| Mock escalation | Support-platform integration |

The mock data and in-memory state reset when the development server restarts. The existing tool and guardrail boundaries are intended to let production integrations replace the local implementations without changing the agent's safety model.
