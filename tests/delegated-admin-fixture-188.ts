import {randomUUID} from "node:crypto";
import type {Database} from "../src/db.js";

/** Preserve broad business permissions while exercising the ordinary review
 * policy. Built-in super_admin identity now intentionally executes directly. */
export async function delegatedAdminFixtureRole(db:Database) {
  const key="review-fixture-"+randomUUID();
  await db.control.query("INSERT INTO admin_roles(key,name,permissions,builtin) SELECT $1,'Delegated review fixture',permissions,false FROM admin_roles WHERE key='super_admin'",[key]);
  return key;
}
