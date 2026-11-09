import { ArgumentsHost, Catch, type ExceptionFilter, HttpException } from "@nestjs/common";

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<{ status: (code: number) => { json: (body: unknown) => void } }>();
    const status =
      typeof exception === "object" && exception && "status" in exception
        ? Number((exception as { status: number }).status)
        : exception instanceof HttpException
          ? exception.getStatus()
          : 500;
    const message = exception instanceof Error ? exception.message : "error";
    if (status >= 500) console.error(exception);
    response.status(status).json({ error: status >= 500 ? "internal" : message });
  }
}
