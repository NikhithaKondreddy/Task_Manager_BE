Ticket lifecycle: check → assign → escalate

1) Ticket Check Flow
- Source: API /tickets (POST) or inbound email/webhook creates a ticket row in `tickets`.
- Validate required fields: requester, description, category, location (state/region/cluster/branch).
- Enrich: resolve location ids, category ids, SLA rules (from `ticket_sla`), and compute `escalationDueAt`.
- Persist and emit socket event `ticket_created` to relevant queues (e.g., `queue_it_support`).
- Create initial history entry `TICKET_CREATED`.

2) Assignment Flow (auto-assignment + manual)
- Auto-assignment steps (engine):
  - Build candidate set from `engineer_mapping` for the ticket's location and category.
  - Apply filters (engineer availability, working hours, current workload, skills, tags).
  - Score candidates (weight by proximity in hierarchy: branch > cluster > region > state, workload, priority match).
  - Pick top candidate; set `assigned_to`, `assignedAt`, `assignmentMode='auto'`, and write history `TICKET_ASSIGNED`.
  - Notify assigned engineer via `NotificationService.createAndSend(userIds, ...)` and emit `ticket_assigned` socket event.
- Manual assignment: API `PUT /tickets/:id` with `{ assignedTo: <userId>, assignmentReason: 'manual' }` sets `assigned_to` and writes history.

3) Escalation Flow
- Escalation levels: 0 = L1 (Branch Engineer), 1 = L2 / Cluster Lead, 2 = Regional IT Manager, 3 = Central IT Admin.
- Each ticket carries `currentEscalationLevel`, `escalationDueAt`, and `nextEscalationAt`.
- When `escalationDueAt` passes without resolution, scheduler/job runs `escalationProcessor`:
  - Increase `currentEscalationLevel` by 1.
  - Lookup users for the next level (e.g., cluster lead -> regional manager) using `engineer_mapping` and `users` role.
  - Set `escalated_to_user_id`, write history `TICKET_ESCALATED`, and notify `escalated_to_user_id`.
  - Optionally re-assign ticket to the escalated user or add them as watcher depending on policy.

APIs & Implementation Notes
- Create ticket: `POST /tickets` — controller should call `TicketService.createTicket(payload)` which performs validation/enrichment and triggers assignment.
- Assign ticket: `PUT /tickets/:id/assign` — permitted to roles with `tickets.assign` permission.
- Escalation processor: small scheduled job or worker that queries open tickets with `nextEscalationAt <= NOW()` and runs escalation logic.

DB fields used (examples)
- `tickets.assigned_to`, `tickets.assigned_team_id`, `tickets.current_escalation_level`, `tickets.escalation_due_at`, `tickets.next_escalation_at`, `tickets.assignment_mode`, `tickets.assignment_reason`, `tickets.escalated_to_user_id`.

Socket events
- `ticket_created`, `ticket_assigned`, `ticket_updated`, `ticket_escalated` — each contains ticket id, short payload (ticketId, status, assignedTo, escalationLevel).

Testing & Postman
- Use existing login fixtures for Regional IT Manager / Central IT Admin to call `GET /tickets?scope=REGION` or `GET /tickets?scope=ALL` and verify visibility.
- Use `POST /tickets` to create tickets and observe socket events and notifications.

If you want, I can implement the escalation processor job and add example endpoints or a small scheduler script next.

Running the escalation processor
- Start continuous processor (keeps running, uses cron schedule `TICKET_SLA_MONITOR_CRON` or default `*/5 * * * *`):
  - `npm run start:escalation-processor`
- Run the processor once (one-shot):
  - `npm run run:escalation-once`

Environment variables
- `TICKET_SLA_MONITOR_CRON`: cron expression for the monitor schedule (default: `*/5 * * * *`).

Notes
- The processor uses `monitorSlaBreaches()` from `src/modules/tickets/services/ticketAutomationService.js` to find tickets whose SLA timers expired and escalates them according to `ESCALATION_CHAIN`.