/**
 * Errors raised by the domain carry a code and arguments instead of text,
 * so the presentation layer can translate them.
 */
export class DomainError extends Error {
  constructor(public readonly code: string, public readonly args: Array<string | number> = []) {
    super(code + (args.length ? ': ' + args.join(', ') : ''));
  }
}
