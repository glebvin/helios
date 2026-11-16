import { day, uuid } from './api-input.js';
import { httpError } from './errors.js';
import { integer, object, text } from './people-input.js';
import { quantity } from './task-input.js';
import type { EvidenceType } from './evidence-input.js';

const types = ['image/jpeg', 'image/png', 'application/pdf'];

function documentInput(value: unknown) {
  const body = object(value, ['filename', 'contentType', 'sizeBytes', 'sha256']);
  if (!Number.isSafeInteger(body.sizeBytes) || Number(body.sizeBytes) < 1 || Number(body.sizeBytes) > 8 * 1024 * 1024) throw httpError(400, 'invalid_size');
  if (typeof body.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(body.sha256)) throw httpError(400, 'invalid_sha256');
  if (!types.includes(String(body.contentType))) throw httpError(400, 'invalid_content_type');
  const filename = text(body.filename, 255);
  if (/[\u0000-\u001f\u007f]/u.test(filename)) throw httpError(400, 'invalid_filename');
  return { filename, contentType: body.contentType as EvidenceType, sizeBytes: body.sizeBytes as number, sha256: body.sha256 };
}

function documents(value: unknown, required: boolean) {
  if (!Array.isArray(value) || value.length > 3 || (required && value.length < 1)) throw httpError(400, 'invalid_documents');
  return value.map(documentInput);
}

function fields(body: Record<string, unknown>) {
  const deliveredOn = day(body.deliveredOn);
  if (!deliveredOn) throw httpError(400, 'invalid_day');
  return {
    materialName: text(body.materialName),
    unit: text(body.unit, 40),
    batchCode: text(body.batchCode, 80),
    supplierName: text(body.supplierName),
    deliveryDocument: text(body.deliveryDocument, 80),
    deliveredOn,
    deliveredQuantity: quantity(body.deliveredQuantity),
  };
}

export function materialBatchCreate(input: unknown) {
  const body = object(input, ['requestId', 'organizationId', 'materialName', 'unit', 'batchCode', 'supplierName', 'deliveryDocument', 'deliveredOn', 'deliveredQuantity', 'documents']);
  return { requestId: uuid(body.requestId).toLowerCase(), organizationId: uuid(body.organizationId).toLowerCase(), ...fields(body), documents: documents(body.documents, true) };
}

export function materialBatchEdit(input: unknown) {
  const body = object(input, ['requestId', 'expectedVersion', 'materialName', 'unit', 'batchCode', 'supplierName', 'deliveryDocument', 'deliveredOn', 'deliveredQuantity', 'documents']);
  return { requestId: uuid(body.requestId).toLowerCase(), expectedVersion: integer(body.expectedVersion, 1), ...fields(body), documents: documents(body.documents, false) };
}
