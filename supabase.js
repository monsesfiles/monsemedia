/* ==========================================
   MONSE MEDIA | SUPABASE.JS
   Shared Backend Connection
   Node.js + Express + SQLite
   ========================================== */

"use strict";

(() => {

    const ROOT = "/api/client/account";


    /* ==========================================
       01 | API ERROR HANDLING
       ========================================== */

    class ApiError extends Error {

        constructor(message, status = 0) {

            super(message);

            this.name = "ApiError";

            this.status = status;

        }

    }


    /* ==========================================
       02 | SERVER CONFIGURATION
       ========================================== */

    function getBase() {

        const local =

            location.protocol === "http:" &&

            [
                "localhost",
                "127.0.0.1",
                "[::1]"
            ].includes(location.hostname);


        /* REQUIRE SECURE BACKEND CONNECTION */

        if (

            location.protocol !== "https:" &&

            !local

        ) {

            throw new ApiError(

                "Open Monse Media through its backend server."

            );

        }


        /* GITHUB PAGES DOES NOT RUN NODE.JS */

        if (

            location.hostname.endsWith(".github.io")

        ) {

            throw new ApiError(

                "Open the hosted Node.js website instead of GitHub Pages."

            );

        }

        return new URL(location.origin);

    }


    /* CHECK BACKEND CONFIGURATION */

    function isConfigured() {

        try {

            getBase();

            return true;

        } catch {

            return false;

        }

    }


    /* ==========================================
       03 | SECURE API ADDRESSES
       ========================================== */

    function apiURL(path) {

        if (

            typeof path !== "string" ||

            !path.startsWith("/api/")

        ) {

            throw new ApiError(

                "Invalid API path."

            );

        }

        const base = getBase();

        const url = new URL(path, base);


        /* VALIDATE API DESTINATION */

        if (

            url.origin !== base.origin ||

            !url.pathname.startsWith("/api/") ||

            url.username ||

            url.password ||

            url.hash

        ) {

            throw new ApiError(

                "Invalid API address."

            );

        }

        return url;

    }


    /* ==========================================
       04 | SEND SERVER REQUESTS
       ========================================== */

    async function request(

        path,

        method = "GET",

        data,

        options = {}

    ) {

        const url = apiURL(path);

        const verb = String(method).toUpperCase();


        /* VALIDATE REQUEST METHOD */

        if (

            ![
                "GET",
                "POST",
                "PUT",
                "PATCH",
                "DELETE"
            ].includes(verb)

        ) {

            throw new ApiError(

                "Unsupported request method."

            );

        }

        if (

            verb === "GET" &&

            data !== undefined

        ) {

            throw new ApiError(

                "GET requests cannot contain a body."

            );

        }


        /* PREPARE REQUEST HEADERS */

        const headers = {

            Accept: "application/json"

        };

        let body;


        /* SUPPORT FILE UPLOADS AND JSON */

        if (data instanceof FormData) {

            body = data;

        } else if (data !== undefined) {

            headers["Content-Type"] =
                "application/json";

            body = JSON.stringify(data);

        }


        /* CONNECT TO MONSE MEDIA SERVER */

        let response;

        try {

            response = await fetch(url, {

                method: verb,

                headers,

                body,

                credentials:

                    options.public === true

                        ? "omit"

                        : "include",

                cache: "no-store",

                redirect: "error",

                referrerPolicy: "same-origin",

                signal: options.signal

            });

        } catch (error) {

            if (error.name === "AbortError") {

                throw error;

            }

            throw new ApiError(

                "Could not reach the Monse Media server."

            );

        }


        /* ==========================================
           05 | SAFE SERVER ERROR MESSAGES
           ========================================== */

        if (!response.ok) {

            const messages = {

                400:

                    "Check your information and try again.",

                401:

                    "Account access could not be verified.",

                403:

                    "This action is not authorized.",

                404:

                    "The requested resource is unavailable.",

                409:

                    "This request conflicts with an existing record.",

                410:

                    "This link has expired or is no longer available.",

                413:

                    "The request is too large.",

                429:

                    "Too many requests. Try again later.",

                503:

                    "This service is not available yet. Please try again later."

            };

            throw new ApiError(

                messages[response.status] ||

                "The server could not confirm your request.",

                response.status

            );

        }


        /* SUCCESSFUL EMPTY RESPONSE */

        if (response.status === 204) {

            return { ok: true };

        }


        /* VERIFY SERVER RESPONSE FORMAT */

        const type =

            response.headers.get("content-type") || "";

        if (

            !type.toLowerCase().includes("json")

        ) {

            throw new ApiError(

                "Unexpected server response. Use the Node.js server."

            );

        }


        /* RETURN SERVER INFORMATION */

        try {

            return await response.json();

        } catch {

            throw new ApiError(

                "The server returned invalid JSON."

            );

        }

    }


    /* ==========================================
       06 | SERVER HEALTH CHECK
       ========================================== */

    async function checkHealth(options = {}) {

        const result = await request(

            "/api/health",

            "GET",

            undefined,

            {

                public: true,

                signal: options.signal

            }

        );


        /* VERIFY SQLITE DATABASE CONNECTION */

        if (

            result?.ok !== true ||

            result.database !== "sqlite"

        ) {

            throw new ApiError(

                "The Monse Media backend could not be verified."

            );

        }


        /* RETURN SERVER CAPABILITIES */

        return {

            connected: true,

            database: "sqlite",

            clientAccounts:

                result.clientAccounts === true,

            emailConfigured:

                result.emailConfigured === true

        };

    }


    /* ==========================================
       07 | PRIVATE CLIENT ACCOUNT REQUESTS
       ========================================== */

    function account(

        path,

        method = "GET",

        data,

        options = {}

    ) {

        if (

            typeof path !== "string" ||

            !path.startsWith("/")

        ) {

            throw new ApiError(

                "Invalid account path."

            );

        }

        const url = apiURL(ROOT + path);


        /* VERIFY ACCOUNT API DESTINATION */

        if (

            !url.pathname.startsWith(ROOT + "/")

        ) {

            throw new ApiError(

                "Invalid account address."

            );

        }


        /* INCLUDE SECURE ACCOUNT SESSION */

        return request(

            url.pathname + url.search,

            method,

            data,

            {

                ...options,

                public: false

            }

        );

    }


    /* ==========================================
       08 | PRIVATE GALLERY DOWNLOAD LINKS
       ========================================== */

    function privateURL(address) {

        if (

            typeof address !== "string" ||

            !address

        ) {

            throw new ApiError(

                "Private file unavailable."

            );

        }

        const base = getBase();

        let url;


        /* VALIDATE PRIVATE FILE ADDRESS */

        try {

            url = new URL(address, base);

        } catch {

            throw new ApiError(

                "Invalid private file address."

            );

        }


        /* REQUIRE SIGNED PRIVATE DOWNLOAD LINK */

        if (

            url.origin !== base.origin ||

            !/^\/api\/access\/[A-Za-z0-9_-]+\.[a-f0-9]{64}$/

                .test(url.pathname) ||

            url.username ||

            url.password ||

            url.search ||

            url.hash

        ) {

            throw new ApiError(

                "Invalid private file address."

            );

        }

        return url.href;

    }


    /* ==========================================
       09 | SHARE BACKEND CONNECTION
       ========================================== */

    window.MonseAPI = Object.freeze({

        isConfigured,

        checkHealth,

        request,

        account,

        privateURL,

        ApiError

    });

})();


/* ==========================================
   END OF MONSE MEDIA SUPABASE.JS
   ========================================== */