import { ConsoleLogger, Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class FileLogger extends ConsoleLogger {
  private readonly logDir: string;

  constructor(context?: string) {
    super(context || 'App');
    this.logDir = process.env.IS_DOCKER === 'true' || fs.existsSync('/app')
      ? '/app/logs'
      : path.join(process.cwd(), 'logs');

    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
    } catch (err) {
      console.error('Failed to create log directory:', err);
    }
  }

  log(message: unknown, ...optionalParams: unknown[]) {
    super.log(message, ...optionalParams);
    this.writeToFile('INFO', message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]) {
    super.error(message, ...optionalParams);
    this.writeToFile('ERROR', message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]) {
    super.warn(message, ...optionalParams);
    this.writeToFile('WARN', message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]) {
    super.debug(message, ...optionalParams);
    this.writeToFile('DEBUG', message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]) {
    super.verbose(message, ...optionalParams);
    this.writeToFile('VERBOSE', message, optionalParams);
  }

  private writeToFile(level: string, message: unknown, optionalParams: unknown[] = []) {
    try {
      const now = new Date();
      const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
      const logFile = path.join(this.logDir, `${(this.context || 'app').toLowerCase()}-${dateStr}.log`);

      const timeStr = now.toISOString();
      const cleanMessage = typeof message === 'object' && message !== null ? JSON.stringify(message) : String(message);

      let contextName = this.context || 'App';
      if (optionalParams.length > 0) {
        const lastParam = optionalParams[optionalParams.length - 1];
        if (typeof lastParam === 'string') {
          contextName = lastParam;
        }
      }

      const logLine = `[${timeStr}] [${level}] [${contextName}] ${cleanMessage}\n`;

      fs.appendFileSync(logFile, logLine, 'utf8');
    } catch (err) {
      console.error('Failed to write log to file:', err);
    }
  }
}
