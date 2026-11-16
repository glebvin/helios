import { uuid } from "./api-input.js";
import { httpError } from "./errors.js";
import { strictObject } from "./time-input.js";

function requestId(value: unknown) {
  return uuid(value).toLowerCase();
}
function version(value: unknown) {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw httpError(400, "invalid_version");
  return value as number;
}
function organizationId(value: unknown) {
  return uuid(value).toLowerCase();
}
function reason(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 500) throw httpError(400, "invalid_reason");
  return value.trim();
}

export function closeCommand(value: unknown) {
  const body = strictObject(value, ["requestId", "expectedCloseVersion", "organizationId", "sourceHash"]);
  if (typeof body.sourceHash !== "string" || !/^[0-9a-f]{64}$/.test(body.sourceHash)) throw httpError(400, "invalid_source_hash");
  return { requestId: requestId(body.requestId), expectedCloseVersion: version(body.expectedCloseVersion), organizationId: organizationId(body.organizationId), sourceHash: body.sourceHash as string };
}

export function correctionCommand(value: unknown) {
  const body = strictObject(value, ["requestId", "organizationId", "reason", "expectedCorrectionVersion", "sourceHash"]);
  if (typeof body.sourceHash !== "string" || !/^[0-9a-f]{64}$/.test(body.sourceHash)) throw httpError(400, "invalid_source_hash");
  return { sourceHash: body.sourceHash, requestId: requestId(body.requestId), organizationId: organizationId(body.organizationId), reason: reason(body.reason), expectedCorrectionVersion: version(body.expectedCorrectionVersion) };
}

export function revisionCommand(value: unknown) {
  const body = strictObject(value, ["requestId", "expectedRevision", "correctionId"]);
  const expectedRevision = version(body.expectedRevision);
  if (expectedRevision === 0 && body.correctionId !== undefined) throw httpError(400, "invalid_input");
  if (expectedRevision > 0 && body.correctionId === undefined) throw httpError(400, "invalid_input");
  return { requestId: requestId(body.requestId), expectedRevision, correctionId: body.correctionId === undefined ? null : uuid(body.correctionId).toLowerCase() };
}
