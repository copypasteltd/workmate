import { writeFile } from "node:fs/promises";
import { z } from "zod";
import {
  desktopDisconnectSchema,
  desktopDisconnectReceiptSchema,
} from "../src/desktop-disconnect-routes.js";
const convert = (schema: z.ZodType) => {
  const { $schema, ...value } = z.toJSONSchema(schema);
  return value;
};
await writeFile(
  "contracts/desktop-removal-schemas.json",
  JSON.stringify(
    {
      protocol: "copypaste.desktop-disconnect.v1",
      schemas: {
        DesktopDisconnectRequest: convert(desktopDisconnectSchema),
        DesktopDisconnectReceipt: convert(desktopDisconnectReceiptSchema),
      },
    },
    null,
    2,
  ) + "\n",
);
