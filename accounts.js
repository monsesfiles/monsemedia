/* ==========================================
   MONSE MEDIA | ACCOUNTS.JS
   Secure Client Account Authentication
   ========================================== */

"use strict";

const express = require("express");
const rateLimit = require("express-rate-limit");

const {
    randomBytes,
    randomUUID,
    createHash,
    scrypt,
    timingSafeEqual
} = require("node:crypto");

const { promisify } = require("node:util");

const deriveKey = promisify(scrypt);


/* ==========================================
   01 | SECURITY CONFIGURATION
   ========================================== */

const LOGIN_COOKIE = "monse_client";
const RECOVERY_COOKIE = "monse_recovery";
const VERIFY_COOKIE = "monse_verify";

const LOGIN_TTL = 7 * 24 * 60 * 60 * 1000;
const VERIFY_TTL = 24 * 60 * 60 * 1000;
const RESET_TTL = 30 * 60 * 1000;
const RECOVERY_TTL = 15 * 60 * 1000;

const SCRYPT_OPTIONS = {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024
};

let activeHashes = 0;


/* ==========================================
   02 | GENERAL HELPERS
   ========================================== */

const now = () => new Date().toISOString();

const expires = ms =>
    new Date(Date.now() + ms).toISOString();

const newToken = () =>
    randomBytes(32).toString("base64url");

const hash = value =>
    createHash("sha256")
        .update(String(value))
        .digest("hex");

function validToken(value) {

    return typeof value === "string" &&
        /^[A-Za-z0-9_-]{43}$/.test(value);

}

function normalizeEmail(value) {

    return typeof value === "string"
        ? value.trim().toLowerCase()
        : "";

}

function validEmail(value) {

    return value.length <= 254 &&
        /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/
            .test(value);

}

function validPassword(value) {

    return typeof value === "string" &&
        value.length >= 12 &&
        value.length <= 128;

}

function validName(value) {

    return typeof value === "string" &&
        value.trim().length >= 1 &&
        value.trim().length <= 80;

}

function fail(res, message, status = 400) {

    return res.status(status).json({
        error: message
    });

}

function same(a, b) {

    const x = Buffer.from(String(a));
    const y = Buffer.from(String(b));

    return x.length === y.length &&
        timingSafeEqual(x, y);

}


/* ==========================================
   03 | SECURE PASSWORD HASHING
   ========================================== */

async function calculateKey(password, salt) {

    // Limit expensive password operations.

    if (activeHashes >= 4) {

        const error = new Error(
            "Authentication is temporarily busy."
        );

        error.status = 503;

        throw error;

    }

    activeHashes++;

    try {

        return await deriveKey(
            password,
            salt,
            64,
            SCRYPT_OPTIONS
        );

    } finally {

        activeHashes--;

    }

}

async function hashPassword(password) {

    const salt = randomBytes(16);

    const key = await calculateKey(
        password,
        salt
    );

    return [
        "scrypt",
        salt.toString("hex"),
        key.toString("hex")
    ].join("$");

}

async function verifyPassword(password, stored) {

    if (

        typeof password !== "string" ||
        password.length > 128 ||
        typeof stored !== "string"

    ) return false;

    const [algorithm, salt, key] =
        stored.split("$");

    if (

        algorithm !== "scrypt" ||
        !/^[a-f0-9]{32}$/.test(salt || "") ||
        !/^[a-f0-9]{128}$/.test(key || "")

    ) return false;

    const calculated = await calculateKey(
        password,
        Buffer.from(salt, "hex")
    );

    return timingSafeEqual(
        calculated,
        Buffer.from(key, "hex")
    );

}


/* Dummy hash reduces login timing differences. */

const DUMMY_HASH = [

    "scrypt",

    randomBytes(16).toString("hex"),

    randomBytes(64).toString("hex")

].join("$");


/* ==========================================
   04 | CREATE ACCOUNT ROUTER
   ========================================== */

function createAccounts({
    db,
    mailer,
    siteUrl
}) {

    const router = express.Router();

    const site = new URL(siteUrl);

    const secure = site.protocol === "https:";


    /* PRIVATE COOKIE CONFIGURATION */

    const cookieOptions = {

        httpOnly: true,

        secure,

        sameSite: "strict",

        path: "/api/client"

    };

    const recoveryOptions = {

        ...cookieOptions,

        path: "/api/client/account/password/recovery"

    };


    /* READ COOKIE */

    function readCookie(req, name) {

        const entry = (req.headers.cookie || "")

            .split(";")

            .map(part => part.trim())

            .find(part =>
                part.startsWith(name + "=")
            );

        return entry
            ? entry.slice(name.length + 1)
            : "";

    }


    /* PREVENT CROSS-SITE ACCOUNT REQUESTS */

    router.use((req, res, next) => {

        res.set("Cache-Control", "no-store");

        if (

            !["GET", "HEAD", "OPTIONS"]
                .includes(req.method) &&

            req.get("origin") !== site.origin

        ) {

            return fail(
                res,
                "Invalid request origin.",
                403
            );

        }

        next();

    });


    /* AUTHENTICATION RATE LIMITING */

    const authLimiter = rateLimit({

        windowMs: 15 * 60 * 1000,

        limit: 8,

        standardHeaders: "draft-7",

        legacyHeaders: false

    });


    /* HANDLE ASYNC ACCOUNT ERRORS */

    function route(handler) {

        return async (req, res, next) => {

            try {

                await handler(req, res, next);

            } catch (error) {

                if (

                    error.status === 503 &&
                    !res.headersSent

                ) {

                    return fail(
                        res,
                        "Authentication is temporarily busy.",
                        503
                    );

                }

                next(error);

            }

        };

    }


    /* ==========================================
       05 | DATABASE ACCOUNT HELPERS
       ========================================== */

    function findAccount(email) {

        return db.prepare(`

            SELECT *
            FROM client_accounts
            WHERE email = ?

        `).get(email);

    }

    function findById(id) {

        return db.prepare(`

            SELECT *
            FROM client_accounts
            WHERE id = ?

        `).get(id);

    }


    /* RETURN ONLY SAFE ACCOUNT INFORMATION */

    function safeProfile(account) {

        return {

            id: account.id,

            first_name: account.first_name,

            last_name: account.last_name,

            name: [

                account.first_name,

                account.last_name

            ].filter(Boolean).join(" "),

            email: account.email,

            preferred_language:
                account.preferred_language,

            emailVerified:
                Boolean(account.email_verified_at),

            created_at: account.created_at

        };

    }


    /* ==========================================
       06 | EMAIL VERIFICATION TOKENS
       ========================================== */

    function issueToken(accountId, purpose, ttl) {

        const token = newToken();

        db.prepare(`

            UPDATE account_tokens

            SET revoked_at = ?

            WHERE account_id = ?
            AND purpose = ?
            AND used_at IS NULL
            AND revoked_at IS NULL

        `).run(now(), accountId, purpose);

        db.prepare(`

            INSERT INTO account_tokens (

                token_hash,
                account_id,
                purpose,
                created_at,
                expires_at

            ) VALUES (?, ?, ?, ?, ?)

        `).run(

            hash(token),

            accountId,

            purpose,

            now(),

            expires(ttl)

        );

        return token;

    }


    function findToken(token, purpose) {

        if (!validToken(token)) return null;

        return db.prepare(`

            SELECT *

            FROM account_tokens

            WHERE token_hash = ?
            AND purpose = ?
            AND used_at IS NULL
            AND revoked_at IS NULL
            AND expires_at > ?

        `).get(

            hash(token),

            purpose,

            now()

        );

    }


    function consumeToken(tokenHash) {

        return db.prepare(`

            UPDATE account_tokens

            SET used_at = ?

            WHERE token_hash = ?
            AND used_at IS NULL
            AND revoked_at IS NULL
            AND expires_at > ?

        `).run(

            now(),

            tokenHash,

            now()

        ).changes === 1;

    }


    /* ==========================================
       07 | CLIENT SESSION MANAGEMENT
       ========================================== */

    function issueSession(accountId, purpose, ttl) {

        const token = newToken();

        db.prepare(`

            INSERT INTO client_sessions (

                token_hash,
                account_id,
                purpose,
                created_at,
                expires_at

            ) VALUES (?, ?, ?, ?, ?)

        `).run(

            hash(token),

            accountId,

            purpose,

            now(),

            expires(ttl)

        );

        return token;

    }


    function findSession(token, purpose) {

        if (!validToken(token)) return null;

        return db.prepare(`

            SELECT *

            FROM client_sessions

            WHERE token_hash = ?
            AND purpose = ?
            AND revoked_at IS NULL
            AND expires_at > ?

        `).get(

            hash(token),

            purpose,

            now()

        );

    }


    /* REVOKE ALL ACCOUNT SESSIONS */

    function revokeSessions(accountId) {

        db.prepare(`

            UPDATE client_sessions

            SET revoked_at = ?

            WHERE account_id = ?
            AND revoked_at IS NULL

        `).run(now(), accountId);

    }


    /* VERIFY AUTHENTICATED CLIENT */

    function requireAccount(req, res, next) {

        const session = findSession(

            readCookie(req, LOGIN_COOKIE),

            "login"

        );

        if (!session) {

            return fail(
                res,
                "Please sign in.",
                401
            );

        }

        const account = findById(
            session.account_id
        );

        if (

            !account ||
            !account.email_verified_at ||
            account.disabled_at

        ) {

            return fail(
                res,
                "Account unavailable.",
                401
            );

        }

        req.account = account;

        req.accountSession = session;

        next();

    }


    /* ==========================================
       08 | REGISTER NEW CLIENT
       ========================================== */

    router.post(

        "/register",

        authLimiter,

        route(async (req, res) => {

            if (!mailer.isConfigured()) {

                return fail(

                    res,

                    "Account verification email is unavailable.",

                    503

                );

            }

            const body = req.body || {};

            const email = normalizeEmail(body.email);

            const password = body.password;


            /* VALIDATE REGISTRATION */

            if (

                !validEmail(email) ||

                !validPassword(password) ||

                !validName(body.first_name) ||

                !validName(body.last_name)

            ) {

                return fail(

                    res,

                    "Enter your name, valid email and a password of at least 12 characters."

                );

            }


            const passwordHash =
                await hashPassword(password);


            /* CREATE OR UPDATE UNVERIFIED ACCOUNT */

            const register = db.transaction(() => {

                const existing = findAccount(email);

                if (

                    existing?.email_verified_at ||

                    existing?.disabled_at

                ) return null;

                const accountId =
                    existing?.id || randomUUID();

                if (existing) {

                    db.prepare(`

                        UPDATE client_accounts

                        SET first_name = ?,
                            last_name = ?,
                            password_hash = ?,
                            updated_at = ?

                        WHERE id = ?

                    `).run(

                        body.first_name.trim(),

                        body.last_name.trim(),

                        passwordHash,

                        now(),

                        accountId

                    );

                } else {

                    db.prepare(`

                        INSERT INTO client_accounts (

                            id,
                            email,
                            password_hash,
                            first_name,
                            last_name,
                            created_at,
                            updated_at

                        ) VALUES (?, ?, ?, ?, ?, ?, ?)

                    `).run(

                        accountId,

                        email,

                        passwordHash,

                        body.first_name.trim(),

                        body.last_name.trim(),

                        now(),

                        now()

                    );


                    /* SMS DISABLED BY DEFAULT */

                    db.prepare(`

                        INSERT INTO sms_preferences (

                            account_id,
                            opted_in,
                            updated_at

                        ) VALUES (?, 0, ?)

                    `).run(accountId, now());

                }

                return issueToken(

                    accountId,

                    "verify_email",

                    VERIFY_TTL

                );

            });


            const token = register.immediate();


            /* BIND VERIFICATION TO REGISTRATION BROWSER */

            res.cookie(

                VERIFY_COOKIE,

                hash(token || newToken()),

                {

                    ...cookieOptions,

                    maxAge: VERIFY_TTL

                }

            );


            /* SEND VERIFICATION EMAIL */

            if (token) {

                void mailer.sendVerification(
                    email,
                    token
                ).catch(() => {

                    console.error(
                        "Verification email failed."
                    );

                });

            }


            /* AVOID DISCLOSING EXISTING ACCOUNTS */

            res.status(202).json({

                ok: true

            });

        })

    );


    /* ==========================================
       09 | VERIFY CLIENT EMAIL ADDRESS
       ========================================== */

    router.post(

        "/verify-email",

        authLimiter,

        (req, res) => {

            const token = req.body?.token;

            const proof = readCookie(
                req,
                VERIFY_COOKIE
            );

            if (

                !validToken(token) ||

                !same(proof, hash(token))

            ) {

                return fail(

                    res,

                    "Open the verification link in the browser used to register.",

                    403

                );

            }

            const verify = db.transaction(() => {

                const record = findToken(
                    token,
                    "verify_email"
                );

                if (!record) return false;

                const account = findById(
                    record.account_id
                );

                if (

                    !account ||
                    account.disabled_at ||
                    account.email_verified_at

                ) return false;

                if (!consumeToken(record.token_hash)) {

                    return false;

                }

                db.prepare(`

                    UPDATE client_accounts

                    SET email_verified_at = ?,
                        updated_at = ?

                    WHERE id = ?

                `).run(

                    now(),

                    now(),

                    account.id

                );

                return true;

            });


            if (!verify.immediate()) {

                return fail(

                    res,

                    "Invalid or expired verification link.",

                    410

                );

            }

            res.clearCookie(
                VERIFY_COOKIE,
                cookieOptions
            );

            res.json({
                ok: true
            });

        }

    );


    /* ==========================================
       10 | CLIENT LOGIN
       ========================================== */

    router.post(

        "/login",

        authLimiter,

        route(async (req, res) => {

            const email = normalizeEmail(
                req.body?.email
            );

            const password = req.body?.password;

            if (

                !validEmail(email) ||

                typeof password !== "string" ||

                password.length > 128

            ) {

                return fail(
                    res,
                    "Invalid login.",
                    401
                );

            }

            const account = findAccount(email);

            const correct = await verifyPassword(

                password,

                account?.password_hash || DUMMY_HASH

            );


            /* RECHECK ACCOUNT AFTER PASSWORD HASHING */

            const current = account
                ? findById(account.id)
                : null;

            if (

                !correct ||

                !current ||

                current.password_hash !==
                    account.password_hash ||

                !current.email_verified_at ||

                current.disabled_at

            ) {

                return fail(

                    res,

                    "Incorrect login or unverified account.",

                    401

                );

            }


            /* REVOKKE PREVIOUS SESSION IN THIS BROWSER */

            const previous = findSession(

                readCookie(req, LOGIN_COOKIE),

                "login"

            );

            if (previous) {

                db.prepare(`

                    UPDATE client_sessions

                    SET revoked_at = ?

                    WHERE token_hash = ?

                `).run(now(), previous.token_hash);

            }


            /* CREATE NEW LOGIN SESSION */

            const token = issueSession(

                current.id,

                "login",

                LOGIN_TTL

            );

            res.cookie(

                LOGIN_COOKIE,

                token,

                {

                    ...cookieOptions,

                    maxAge: LOGIN_TTL

                }

            );

            res.json({
                ok: true
            });

        })

    );


    /* ==========================================
       11 | VERIFY CURRENT SESSION
       ========================================== */

    router.get(

        "/session",

        requireAccount,

        (req, res) => {

            res.json({

                authenticated: true,

                profile: safeProfile(req.account)

            });

        }

    );


    /* ==========================================
       12 | CLIENT LOGOUT
       ========================================== */

    router.post("/logout", (req, res) => {

        const session = findSession(

            readCookie(req, LOGIN_COOKIE),

            "login"

        );

        if (session) {

            db.prepare(`

                UPDATE client_sessions

                SET revoked_at = ?

                WHERE token_hash = ?

            `).run(now(), session.token_hash);

        }

        res.clearCookie(
            LOGIN_COOKIE,
            cookieOptions
        );

        res.json({
            ok: true
        });

    });


    /* ==========================================
       13 | REQUEST PASSWORD RECOVERY
       ========================================== */

    router.post(

        "/password/recovery/request",

        authLimiter,

        (req, res) => {

            if (!mailer.isConfigured()) {

                return fail(

                    res,

                    "Password recovery is unavailable.",

                    503

                );

            }

            const email = normalizeEmail(
                req.body?.email
            );

            if (!validEmail(email)) {

                return fail(
                    res,
                    "Enter a valid email."
                );

            }

            const account = findAccount(email);

            if (

                account?.email_verified_at &&

                !account.disabled_at

            ) {

                const createReset = db.transaction(() => {

                    return issueToken(

                        account.id,

                        "reset_password",

                        RESET_TTL

                    );

                });

                const token = createReset.immediate();

                void mailer.sendPasswordReset(

                    email,

                    token

                ).catch(() => {

                    console.error(
                        "Password recovery email failed."
                    );

                });

            }


            /* SAME RESPONSE FOR EVERY VALID EMAIL */

            res.status(202).json({

                ok: true

            });

        }

    );


    /* ==========================================
       14 | VERIFY PASSWORD RECOVERY TOKEN
       ========================================== */

    router.post(

        "/password/recovery/verify",

        authLimiter,

        (req, res) => {

            const token = req.body?.token;

            const verifyRecovery = db.transaction(() => {

                const record = findToken(

                    token,

                    "reset_password"

                );

                if (!record) return null;

                const account = findById(
                    record.account_id
                );

                if (

                    !account ||
                    !account.email_verified_at ||
                    account.disabled_at

                ) return null;

                if (!consumeToken(record.token_hash)) {

                    return null;

                }


                /* REVOKE PREVIOUS RECOVERY SESSIONS */

                db.prepare(`

                    UPDATE client_sessions

                    SET revoked_at = ?

                    WHERE account_id = ?
                    AND purpose = 'recovery'
                    AND revoked_at IS NULL

                `).run(now(), account.id);


                /* CREATE RESTRICTED RECOVERY SESSION */

                return issueSession(

                    account.id,

                    "recovery",

                    RECOVERY_TTL

                );

            });

            const recovery = verifyRecovery.immediate();

            if (!recovery) {

                return fail(

                    res,

                    "Invalid or expired recovery link.",

                    410

                );

            }

            res.cookie(

                RECOVERY_COOKIE,

                recovery,

                {

                    ...recoveryOptions,

                    maxAge: RECOVERY_TTL

                }

            );

            res.json({

                ok: true,

                recoveryAuthorized: true

            });

        }

    );


    /* ==========================================
       15 | SAVE NEW CLIENT PASSWORD
       ========================================== */

    router.post(

        "/password/recovery/complete",

        authLimiter,

        route(async (req, res) => {

            const token = readCookie(

                req,

                RECOVERY_COOKIE

            );

            const session = findSession(

                token,

                "recovery"

            );

            if (!session) {

                return fail(

                    res,

                    "Recovery session expired.",

                    401

                );

            }

            const password = req.body?.new_password;

            if (!validPassword(password)) {

                return fail(

                    res,

                    "Password must contain 12 to 128 characters."

                );

            }

            const passwordHash =
                await hashPassword(password);


            /* ATOMIC PASSWORD RESET */

            const completeReset = db.transaction(() => {

                const current = findSession(

                    token,

                    "recovery"

                );

                if (!current) return false;

                const account = findById(

                    current.account_id

                );

                if (

                    !account ||
                    !account.email_verified_at ||
                    account.disabled_at

                ) return false;


                /* UPDATE PASSWORD */

                db.prepare(`

                    UPDATE client_accounts

                    SET password_hash = ?,
                        updated_at = ?

                    WHERE id = ?

                `).run(

                    passwordHash,

                    now(),

                    account.id

                );


                /* REVOKE ALL PREVIOUS LOGIN SESSIONS */

                revokeSessions(account.id);


                /* REVOKE UNUSED RECOVERY TOKENS */

                db.prepare(`

                    UPDATE account_tokens

                    SET revoked_at = ?

                    WHERE account_id = ?
                    AND used_at IS NULL
                    AND revoked_at IS NULL

                `).run(now(), account.id);

                return true;

            });

            if (!completeReset.immediate()) {

                return fail(

                    res,

                    "Recovery session expired.",

                    401

                );

            }


            /* CLEAR AUTHENTICATION COOKIES */

            res.clearCookie(

                RECOVERY_COOKIE,

                recoveryOptions

            );

            res.clearCookie(

                LOGIN_COOKIE,

                cookieOptions

            );

            res.json({

                ok: true

            });

        })

    );


    /* ==========================================
       16 | EXPORT ACCOUNT FUNCTIONS
       ========================================== */

    return {

        router,

        requireAccount,

        safeProfile,

        findById,

        findAccount,

        hashPassword,

        verifyPassword,

        revokeSessions,

        issueToken,

        findToken,

        consumeToken

    };

}


module.exports = {

    createAccounts

};


/* ==========================================
   END OF MONSE MEDIA ACCOUNTS.JS
   ========================================== */