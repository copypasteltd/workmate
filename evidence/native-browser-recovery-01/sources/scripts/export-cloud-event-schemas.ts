import { z } from "zod";
import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import * as event from "../src/cloud-event-model.js";
import {
  adminEventMetadataDTO,
  adminEventQuery,
  adminEventPause,
} from "../src/cloud-event-admin.js";

const definitions = {
  EventOptions: event.eventOptions,
  EventRequest: event.eventRequest,
  EventProposalRequest: event.eventProposalRequest,
  EventDecision: event.eventDecision,
  EventControl: event.eventControl,
  EventRotate: event.eventRotateRequest,
  EventHistoryQuery: event.eventHistoryQuery,
  EventListQuery: event.eventListQuery,
  EventBody: event.eventBodyDTO,
  EventReceipt: event.eventReceiptDTO,
  EventTrigger: event.eventTriggerDTO,
  EventEnvelope: event.eventEnvelope,
  AdminEventMetadata: adminEventMetadataDTO,
  AdminEventQuery: adminEventQuery,
  AdminEventPause: adminEventPause,
};
const schemas = Object.fromEntries(
  Object.entries(definitions).map(([key, schema]) => [
    key,
    z.toJSONSchema(schema),
  ]),
);
const bytes =
  JSON.stringify(
    { schema: "copypaste-cloud-events-schemas-1", schemas },
    null,
    2,
  ) + "\n";
await writeFile("contracts/cloud-events-schemas.json", bytes);
console.log(
  JSON.stringify({
    schemas: Object.keys(schemas).length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  }),
);
