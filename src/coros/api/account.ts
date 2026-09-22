import { AuthError } from "../errors.ts";
import { buildUrl, getJson } from "../http.ts";
import type { User } from "../types/auth.ts";
import type { RequestOptions } from "../http.ts";

/** GET account/query — the current user profile. */
export async function getAccount(options: RequestOptions): Promise<User> {
    if (!options.accessToken) {
        throw new AuthError();
    }
    return await getJson<User>(buildUrl(options.baseUrl, "account/query"), options);
}
