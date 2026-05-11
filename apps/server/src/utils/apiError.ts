export class ApiError extends Error {
    public readonly statusCode: number
    public readonly isOperational: boolean
    public readonly errors: string[]


    constructor (
        statusCode: number,
        message: string,
        errors: string[] = [],
        isOperational = true,
    ) {
        super(message)
        this.statusCode = statusCode
        this.errors = errors
        this.isOperational = isOperational

        Error.captureStackTrace(this, this.constructor)
        Object.setPrototypeOf(this, ApiError.prototype)
    }

    //static factory helper

    static badRequest(message: string, errors: string[] = []) {
        return new ApiError(400, message, errors)
    }
    
    static unauthorized(message = 'Unauthorized') {
        return new ApiError(401, message)
    }
    
    static forbidden(message = 'Forbidden') {
        return new ApiError(403, message)
    }
    
    static notFound(message = 'Resource not found') {
        return new ApiError(404, message)
    }
    
    static conflict(message: string) {
        return new ApiError(409, message)
    }
    
    static unprocessable(message: string, errors: string[] = []) {
        return new ApiError(422, message, errors)
    }
    
    static tooManyRequests(message = 'Too many requests') {
        return new ApiError(429, message)
    }
    
    static internal(message = 'Internal server error') {
        return new ApiError(500, message, [], false)
    }
} 