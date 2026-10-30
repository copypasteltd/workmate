import { z } from "zod";
import { writeFile } from "node:fs/promises";
import {
  desktopReleaseSchema,
  desktopUpdatePayloadSchema,
  desktopUpdateEnvelopeSchema,
} from "../src/desktop-update-schema.js";
import {
  desktopUpdateStage,
  desktopUpdatePart,
  desktopUpdatePublication,
} from "../src/desktop-update-routes.js";
const schemas = Object.fromEntries(
  Object.entries({
    DesktopRelease: desktopReleaseSchema,
    DesktopUpdatePayload: desktopUpdatePayloadSchema,
    DesktopUpdateEnvelope: desktopUpdateEnvelopeSchema,
    DesktopUpdateStage: desktopUpdateStage,
    DesktopUpdatePart: desktopUpdatePart,
    DesktopUpdatePublication: desktopUpdatePublication,
  }).map(([name, schema]) => [name, z.toJSONSchema(schema, { io: "input" })]),
);
await writeFile(
  "contracts/desktop-updates-schemas.json",
  JSON.stringify({ version: 1, schemas }, null, 2) + "\n",
);
