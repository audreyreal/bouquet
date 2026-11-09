import { type ActionSpec, REGION_CONTROL_PATH } from "../spec";

/* region_control's embassy verbs: the POST field naming the other region, and the success text. */
export const EMBASSY_VERBS = {
  close: { field: "cancelembassyregion", needle: " has been scheduled for demolition." },
  reject: { field: "rejectembassyregion", needle: " rejected." },
  abort: { field: "abortembassyregion", needle: " aborted." },
  withdraw: { field: "withdrawembassyregion", needle: " withdrawn." },
  cancelClosure: {
    field: "cancelembassyclosureregion",
    needle: "Embassy closure order cancelled.",
  },
} as const;
export type EmbassyVerb = keyof typeof EMBASSY_VERBS;

export function embassyVerbSpec(verb: EmbassyVerb, region: string): ActionSpec {
  const { field, needle } = EMBASSY_VERBS[verb];
  return { kind: "text", path: REGION_CONTROL_PATH, body: { [field]: region }, needle };
}
