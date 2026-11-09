import { passwordFor } from "../../state";
import { canon } from "../../utils";
import { type ActionSpec, specError } from "../spec";

/* The NS login form fields, in NS's order; shared by the pipeline login and the native button. */
export function loginBody(nation: string, password: string): Record<string, string> {
  return { nation: canon(nation.trim()), password, logging_in: "1", submit: "Login" };
}

export function buildLoginSpec(actor: string): ActionSpec {
  const password = passwordFor(actor);
  if (!password) return specError("password required");
  return {
    kind: "login",
    path: "/page=display_region/region=rwby",
    body: loginBody(actor, password),
  };
}
