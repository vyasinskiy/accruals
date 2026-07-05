import { config } from '../../config';

export function printSwaggerUrl(logFn: (msg: string) => void = console.log): void {
  logFn(`Swagger UI: http://localhost:${config.PORT}/docs`);
}
