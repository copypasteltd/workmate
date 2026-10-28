import { z } from "zod";
import { writeFile } from "node:fs/promises";
import { recoverySummaryDTO, recoveryReceiptDTO } from "../src/native-recovery-routes.js";
const schemas = { RecoverySummary: z.toJSONSchema(recoverySummaryDTO), RecoveryReceipt: z.toJSONSchema(recoveryReceiptDTO) };
await writeFile("contracts/native-recovery-schemas.json", JSON.stringify({ protocol: "copypaste-native-recovery-api/1", schemas }, null, 2) + "\n");
