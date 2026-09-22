import type { ApiResponse } from "./common.ts";

/**
 * Credentials for login.
 */
export interface Credentials {
    email: string;
    password: string;
}

/**
 * User fields returned on login and account/query.
 */
export interface User {
    userId: string;
    nickname: string;
    email: string;
    headPic?: string;
    countryCode?: string;
    /** YYYYMMDD as number */
    birthday?: number;
    [key: string]: unknown;
}

/**
 * Login success: data contains accessToken and user fields.
 */
export interface LoginData {
    accessToken: string;
    [key: string]: unknown;
}

export type LoginResponse = ApiResponse<LoginData>;

export type AccountResponse = ApiResponse<User>;
