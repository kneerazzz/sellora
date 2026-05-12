export interface PaginationMeta {
    page: number
    limit: number
    total: number
    totalPages: number
    hasNextPage: boolean
    hasPrevPage: boolean
}

export class ApiResponse<T = unknown> {
    public readonly success: boolean
    public readonly statusCode: number
    public readonly message: string
    public readonly data: T | null
    public readonly meta?: PaginationMeta

    constructor (
        statusCode: number,
        message: string,
        data: T | null = null,
        meta?: PaginationMeta
    ) {
        this.success = statusCode >= 200 && statusCode < 400
        this.statusCode = statusCode
        this.message = message
        this.data = data
        if(meta) this.meta = meta
    }

    //Static Factory Helpers

    static ok<T>(message: string, data: T, meta?: PaginationMeta) {
        return new ApiResponse<T>(200, message, data, meta)
    }

    static created<T>(message: string, data: T) {
        return new ApiResponse<T>(201, message, data)
    }

    static noContent(message = "Deleted Successfully"){
        return new ApiResponse<void>(204, message, null)
    }
}