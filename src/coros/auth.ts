import { buildUrl, postJson } from "./http.ts";
import { md5Hex } from "./md5.ts";
import type { Credentials, LoginData } from "./types/auth.ts";
import type { RequestOptions } from "./http.ts";

/** POST account/login with an MD5-hashed password. */
export async function login(
    credentials: Credentials,
    options: RequestOptions,
): Promise<Omit<LoginData, "accessToken"> & { accessToken: string }> {
    const body = {
        account: credentials.email,
        accountType: 2,
        pwd: md5Hex(credentials.password),
    };
    const data = await postJson<LoginData>(
        buildUrl(options.baseUrl, "account/login"),
        body,
        options,
    );
    return data as LoginData;
}
