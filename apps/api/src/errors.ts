import { HttpException } from "@nestjs/common";

export function httpError(status: number, message: string): HttpException {
  return new HttpException(message, status);
}

export function mapPgError(error: unknown): never {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  if (code === "23503" || code === "23514") throw httpError(422, "reference_denied");
  throw error;
}
