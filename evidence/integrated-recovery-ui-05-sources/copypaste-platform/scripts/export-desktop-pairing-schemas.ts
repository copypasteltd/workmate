import { writeFile } from "node:fs/promises";
import { z } from "zod";
import {
  desktopPairingSchema,
  desktopPairingReceiptSchema,
  desktopPairingRetirementSchema,
} from "../src/desktop-pairing-routes.js";
const convert = (schema: z.ZodType) => {
  const { $schema, ...value } = z.toJSONSchema(schema);
  return value;
};
await writeFile(
  "contracts/desktop-pairing-schemas.json",
  JSON.stringify(
    {
      protocol: "copypaste.desktop-pairing.v1",
      schemas: {
        DesktopPairingRequest: convert(desktopPairingSchema),
        DesktopPairingReceipt: convert(desktopPairingReceiptSchema),
        DesktopPairingRetirement: convert(desktopPairingRetirementSchema),
      },
    },
    null,
    2,
  ) + "\n",
);
