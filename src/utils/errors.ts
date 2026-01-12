/**
 * Custom error classes for Glint server errors.
 */

export class ForbiddenError extends Error {
    constructor(message: string = 'Forbidden') {
        super(message);
        this.name = 'ForbiddenError';
    }
}

export class NotFoundError extends Error {
    constructor(message: string = 'Not Found') {
        super(message);
        this.name = 'NotFoundError';
    }
}

/**
 * Type guard to check if an error is a ForbiddenError.
 */
export function isForbiddenError(err: unknown): err is ForbiddenError {
    return err instanceof ForbiddenError;
}

/**
 * Type guard to check if an error is a NotFoundError.
 */
export function isNotFoundError(err: unknown): err is NotFoundError {
    return err instanceof NotFoundError ||
        (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT');
}
