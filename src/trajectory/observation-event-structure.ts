import type {
  TrajectoryObservationEventClass,
  TrajectoryObservationFunctionDirection,
} from "./observation-contract"

export type ObservationEventStructure = Readonly<{
  eventClass: TrajectoryObservationEventClass
  functionDirection: TrajectoryObservationFunctionDirection
}>

export const observationEventStructureForKind = (kind: string): ObservationEventStructure => {
  if (kind === "function_enter") {
    return { eventClass: "step", functionDirection: "enter" }
  }
  if (kind === "function_exit") {
    return { eventClass: "step", functionDirection: "exit" }
  }
  if (kind === "session_start" || kind === "session_end") {
    return { eventClass: "session", functionDirection: "not_applicable" }
  }
  if (kind === "llm_call") return { eventClass: "llm", functionDirection: "not_applicable" }
  if (kind === "tool_call") {
    return { eventClass: "tool_call", functionDirection: "not_applicable" }
  }
  if (kind === "tool_result") {
    return { eventClass: "tool_result", functionDirection: "not_applicable" }
  }
  if (kind === "verification") {
    return { eventClass: "verification", functionDirection: "not_applicable" }
  }
  if (kind === "error" || kind === "exception" || kind === "runtime_error") {
    return { eventClass: "error", functionDirection: "not_applicable" }
  }
  return { eventClass: "other", functionDirection: "not_applicable" }
}
