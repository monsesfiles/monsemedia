/* ==========================================
   MONSE MEDIA | SERVER.JS
   Client Accounts, Contracts, Galleries,
   Appointments & Automatic Email Reminders
   ========================================== */

"use strict";

require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const Database = require("better-sqlite3");
const PDFDocument = require("pdfkit");
const fs = require("node:fs");
const path = require("node:path");

const { migrateDatabase } = require("./database");
const { createMailer } = require("./mailer");
const { createAccounts } = require("./accounts");
const { createReminders, localToUTC } = require("./reminders");

const {
    randomBytes,
    randomUUID,
    createHash,
    createHmac,
    timingSafeEqual
} = require("node:crypto");


/* ==========================================
   01 | SERVER CONFIGURATION
   ========================================== */

const app = express();
const ROOT = __dirname;

const PRODUCTION =
    process.env.NODE_ENV === "production";

const PORT = Number(process.env.PORT || 3000);

const SITE_URL = (
    process.env.SITE_URL ||
    `http://localhost:${PORT}`
).replace(/\/$/, "");

const site = new URL(SITE_URL);

if (
    !Number.isInteger(PORT) ||
    PORT < 1 ||
    PORT > 65535 ||
    !["http:", "https:"].includes(site.protocol) ||
    site.username ||
    site.password ||
    site.search ||
    site.hash ||
    site.pathname !== "/" ||
    (PRODUCTION && site.protocol !== "https:")
) {
    throw new Error(
        "Set PORT and SITE_URL to a valid website origin."
    );
}

const SECURE_COOKIE = site.protocol === "https:";

const HOST = process.env.HOST ||
    (PRODUCTION ? "0.0.0.0" : "127.0.0.1");

const SECRET = process.env.SESSION_SECRET || "";

const ADMIN_EMAIL = (
    process.env.ADMIN_EMAIL || ""
).trim().toLowerCase();

const ADMIN_PASSWORD =
    process.env.ADMIN_PASSWORD || "";

const PRIVATE_DIR = path.join(ROOT, "private");

const UPLOAD_DIR = path.join(
    PRIVATE_DIR,
    "uploads"
);

if (
    SECRET.length < 32 ||
    ADMIN_PASSWORD.length < 12 ||
    !ADMIN_EMAIL
) {
    throw new Error(
        "Set SESSION_SECRET (32+ characters), " +
        "ADMIN_EMAIL, and ADMIN_PASSWORD " +
        "(12+ characters) in .env"
    );
}

fs.mkdirSync(UPLOAD_DIR, {
    recursive: true,
    mode: 0o700
});


/* ==========================================
   02 | PRIVATE DATABASE
   ========================================== */

const db = new Database(
    path.join(PRIVATE_DIR, "monse.sqlite")
);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

db.exec(`

    CREATE TABLE IF NOT EXISTS projects (

        id TEXT PRIMARY KEY,

        name TEXT NOT NULL,

        email TEXT NOT NULL,

        service TEXT NOT NULL,

        event_type TEXT NOT NULL,

        event_date TEXT,

        event_location TEXT,

        message TEXT NOT NULL,

        status TEXT NOT NULL DEFAULT 'pending',

        token_hash TEXT NOT NULL UNIQUE,

        created_at TEXT NOT NULL,

        quote TEXT,

        duration TEXT,

        deliverables TEXT,

        turnaround TEXT,

        cancellation TEXT,

        usage_rights TEXT,

        contract_text TEXT,

        signed_name TEXT,

        signed_at TEXT,

        signed_ip TEXT,

        signed_agent TEXT,

        pinterest TEXT,

        inspiration TEXT,

        published INTEGER NOT NULL DEFAULT 0

    );

    CREATE TABLE IF NOT EXISTS files (

        id TEXT PRIMARY KEY,

        project_id TEXT NOT NULL
            REFERENCES projects(id),

        kind TEXT NOT NULL,

        stored TEXT NOT NULL,

        filename TEXT NOT NULL,

        mime TEXT NOT NULL,

        bytes INTEGER NOT NULL,

        created_at TEXT NOT NULL

    );

`);

migrateDatabase(db);


/* CONNECT BACKEND MODULES */

const mailer = createMailer({
    siteUrl: SITE_URL,
    adminEmail: ADMIN_EMAIL
});

const accounts = createAccounts({
    db,
    mailer,
    siteUrl: SITE_URL
});

const reminders = createReminders({
    db,
    mailer
});


/* ==========================================
   03 | SERVER SECURITY
   ========================================== */

app.disable("x-powered-by");

if (process.env.TRUST_PROXY_HOPS) {

    const hops = Number(
        process.env.TRUST_PROXY_HOPS
    );

    if (
        !Number.isInteger(hops) ||
        hops < 1 ||
        hops > 10
    ) {
        throw new Error(
            "Invalid TRUST_PROXY_HOPS"
        );
    }

    app.set("trust proxy", hops);

}

app.use(helmet({

    // Existing website contains inline scripts.
    // Tighten CSP before production deployment.

    contentSecurityPolicy: false,

    strictTransportSecurity:
        PRODUCTION ? undefined : false,

    referrerPolicy: {
        policy: "no-referrer"
    }

}));

app.use(express.json({
    limit: "100kb"
}));

app.use(express.urlencoded({
    extended: false,
    limit: "100kb"
}));

app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
});


/* ==========================================
   04 | WEBSITE FILE CONNECTIONS
   ========================================== */

const publicFiles = new Set([

    /* WEBSITE PAGES */

    "index.html",
    "about.html",
    "portfolio.html",
    "services.html",
    "contact.html",
    "client.html",
    "admin.html",
    "webdesign.html",
    "dashboard.html",
    "client-gallery.html",
    "booking.html",
    "client-settings.html",
    "reset-password.html",

    /* WEBSITE STYLESHEETS */

    "style.css",
    "about.css",
    "portfolio.css",
    "services.css",
    "contact.css",
    "client.css",
    "portal.css",
    "admin.css",
    "archive.css",
    "dashboard.css",
    "client-gallery.css",
    "booking.css",
    "client-settings.css",

    /* BROWSER JAVASCRIPT */

    "client.js",
    "admin.js",
    "booking.js",
    "site-shell.js",
    "homepage.js",
    "about.js",
    "portfolio.js",
    "dashboard.js",
    "client-gallery.js",
    "client-settings.js",
    "supabase.js",
    "auth.js"

]);

const privatePages = new Set([

    "admin.html",
    "client.html",
    "dashboard.html",
    "client-gallery.html",
    "booking.html",
    "client-settings.html",
    "reset-password.html"

]);


/* HOMEPAGE */

app.get("/", (req, res) => {
    res.sendFile(path.join(ROOT, "index.html"));
});


/* OLD HOMEPAGE REDIRECT */

app.get("/homepage.html", (req, res) => {
    res.redirect(301, "/index.html");
});


/* SERVE APPROVED WEBSITE FILES ONLY */

app.get("/:filename", (req, res, next) => {

    const filename = req.params.filename;

    if (!publicFiles.has(filename)) {
        return next();
    }

    if (privatePages.has(filename)) {

        res.set("Cache-Control", "no-store");

        res.set(
            "X-Robots-Tag",
            "noindex, nofollow"
        );

    } else {

        res.set("Cache-Control", "no-cache");

    }

    res.sendFile(path.join(ROOT, filename));

});


/* PUBLIC WEBSITE ASSETS */

for (const folder of [

    "images",
    "audio",
    "videos",
    "js",
    "fonts",
    "inspiration"

]) {

    app.use(
        "/" + folder,
        express.static(
            path.join(ROOT, folder),
            {
                dotfiles: "deny",
                index: false,
                fallthrough: true
            }
        )
    );

}


/* ==========================================
   05 | HELPER FUNCTIONS
   ========================================== */

const hash = value =>
    createHash("sha256")
        .update(String(value))
        .digest("hex");

const hmac = value =>
    createHmac("sha256", SECRET)
        .update(value)
        .digest("hex");

function same(a, b) {

    const x = Buffer.from(String(a));
    const y = Buffer.from(String(b));

    return (
        x.length === y.length &&
        timingSafeEqual(x, y)
    );

}

const now = () =>
    new Date().toISOString();

const clean = (value, maximum = 1000) =>
    String(value ?? "").trim().slice(0, maximum);

const findProject = id =>
    db.prepare(
        "SELECT * FROM projects WHERE id = ?"
    ).get(id);

function safeProject(project) {

    if (!project) return null;

    const {
        token_hash,
        signed_ip,
        signed_agent,
        sms_opted_in,
        sms_phone,
        sms_consent_at,
        sms_consent_version,
        account_id,
        ...visible
    } = project;

    return visible;

}

const fail = (res, message, status = 400) =>
    res.status(status).json({
        error: message
    });


/* ==========================================
   06 | REQUEST RATE LIMITS
   ========================================== */

const inquiryLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-7",
    legacyHeaders: false
});

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 6,
    standardHeaders: "draft-7",
    legacyHeaders: false
});


/* VERIFY REQUEST ORIGIN */

app.use("/api", (req, res, next) => {

    if (
        ["GET", "HEAD", "OPTIONS"]
            .includes(req.method)
    ) {
        return next();
    }

    const origin = req.get("origin");

    const cookieMutation =
        req.path.startsWith("/admin/") ||
        req.path.startsWith("/client/account/") ||
        (
            req.path.startsWith("/client/") &&
            req.query.project !== undefined
        );

    if (
        (
            origin &&
            origin !== "null" &&
            origin !== site.origin
        ) ||
        (
            cookieMutation &&
            origin !== site.origin &&
            !(
                (!origin || origin === "null") &&
                req.get("sec-fetch-site") === "same-origin"
            )
        )
    ) {
        return fail(
            res,
            "Invalid request origin",
            403
        );
    }

    next();

});


/* ==========================================
   07 | ADMINISTRATOR AUTHENTICATION
   ========================================== */

const ADMIN_COOKIE = "monse_admin";

const ADMIN_TTL = 8 * 60 * 60 * 1000;

const adminSessions = new Map();

const cookieOptions = {
    httpOnly: true,
    secure: SECURE_COOKIE,
    sameSite: "strict",
    path: "/"
};

function cookieValue(req, name) {

    const entry = (req.headers.cookie || "")
        .split(";")
        .map(part => part.trim())
        .find(part => part.startsWith(name + "="));

    return entry
        ? entry.slice(name.length + 1)
        : "";

}

function purgeAdminSessions() {

    const current = Date.now();

    for (const [key, expires] of adminSessions) {

        if (expires <= current) {
            adminSessions.delete(key);
        }

    }

}

function makeAdminCookie() {

    purgeAdminSessions();

    const token =
        randomBytes(32).toString("base64url");

    adminSessions.clear();

    adminSessions.set(
        hash(token),
        Date.now() + ADMIN_TTL
    );

    return token;

}

function requireAdmin(req, res, next) {

    purgeAdminSessions();

    const token = cookieValue(
        req,
        ADMIN_COOKIE
    );

    const key =
        /^[A-Za-z0-9_-]{43}$/.test(token)
            ? hash(token)
            : "";

    if (!adminSessions.has(key)) {

        return fail(
            res,
            "Admin login required",
            401
        );

    }

    req.adminSessionKey = key;

    next();

}


/* ==========================================
   08 | CLIENT PROJECT AUTHENTICATION
   ========================================== */

function requireClient(req, res, next) {

    /* RETURNING CLIENT ACCOUNT ACCESS */

    if (req.query.project !== undefined) {

        return accounts.requireAccount(
            req,
            res,
            () => {

                if (
                    typeof req.query.project !== "string"
                ) {
                    return fail(
                        res,
                        "Invalid project"
                    );
                }

                const project = db.prepare(`

                    SELECT *
                    FROM projects
                    WHERE id = ?
                    AND account_id = ?

                `).get(
                    req.query.project,
                    req.account.id
                );

                if (!project) {

                    return fail(
                        res,
                        "Project not found",
                        404
                    );

                }

                req.project = project;

                next();

            }
        );

    }


    /* ORIGINAL PRIVATE PROJECT LINKS */

    const token = (
        req.get("authorization") || ""
    ).replace(/^Bearer\s+/i, "");

    if (
        !/^[A-Za-z0-9_-]{40,100}$/.test(token)
    ) {

        return fail(
            res,
            "Private client link required",
            401
        );

    }

    const project = db.prepare(
        "SELECT * FROM projects WHERE token_hash = ?"
    ).get(hash(token));

    if (!project || project.account_id) {

        return fail(
            res,
            "Invalid private client link",
            401
        );

    }

    req.project = project;

    next();

}


/* EMAIL SERVICE */

const sendEmail = mailer.sendEmail;


/* ==========================================
   09 | PUBLIC BOOKING INQUIRIES
   ========================================== */

app.post(

    "/api/inquiries",

    inquiryLimiter,

    multer({
        limits: {
            fields: 30,
            fieldSize: 100 * 1024,
            parts: 30
        }
    }).none(),

    (req, res) => {

        const body = req.body || {};

        /* HIDDEN SPAM FIELD */

        if (body.website) {
            return res.json({ ok: true });
        }

        const project = {

            id: randomUUID(),

            name: clean(body.name, 120),

            email: clean(
                body.email,
                200
            ).toLowerCase(),

            service: clean(body.service, 80),

            event_type: clean(
                body.event_type || "Custom project",
                100
            ),

            event_date: clean(body.event_date, 30),

            event_location: clean(
                body.event_location,
                200
            ),

            message: clean(body.message, 5000)

        };

        if (
            !project.name ||
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/
                .test(project.email) ||
            !project.service ||
            !project.message
        ) {

            return fail(
                res,
                "Please enter a name, valid email, service and message."
            );

        }

        const token =
            randomBytes(32).toString("base64url");

        db.prepare(`

            INSERT INTO projects (

                id,
                name,
                email,
                service,
                event_type,
                event_date,
                event_location,
                message,
                status,
                token_hash,
                created_at

            ) VALUES (

                @id,
                @name,
                @email,
                @service,
                @event_type,
                @event_date,
                @event_location,
                @message,
                'pending',
                @token_hash,
                @created_at

            )

        `).run({

            ...project,

            token_hash: hash(token),

            created_at: now()

        });

        const portalUrl =
            `${SITE_URL}/client.html#token=${token}`;


        /* NOTIFY STUDIO OWNER */

        void sendEmail(

            ADMIN_EMAIL,

            `ACCEPT PROJECT? ${project.event_type} — ${project.name}`,

            `New inquiry from ${project.name}\n\n` +
            `Email: ${project.email}\n` +
            `Service: ${project.service}\n` +
            `Event: ${project.event_type}\n\n` +
            `${project.message}\n\n` +
            `Review: ${SITE_URL}/admin.html`

        );


        /* NOTIFY CLIENT */

        void sendEmail(

            project.email,

            "Monse Media — Inquiry Received",

            `Hi ${project.name},\n\n` +
            "Your inquiry has been received and is awaiting review.\n\n" +
            `Your private client portal:\n${portalUrl}\n\n` +
            "Keep this link confidential."

        );

        res.status(201).json({
            ok: true,
            portalUrl
        });

    }

);


/* ==========================================
   10 | ADMIN LOGIN & LOGOUT
   ========================================== */

app.post(

    "/api/admin/login",

    loginLimiter,

    (req, res) => {

        const email = clean(
            req.body?.email,
            200
        ).toLowerCase();

        const password = String(
            req.body?.password || ""
        );

        if (
            email !== ADMIN_EMAIL ||
            !same(
                hash(password),
                hash(ADMIN_PASSWORD)
            )
        ) {

            return fail(
                res,
                "Incorrect login",
                401
            );

        }

        res.cookie(

            ADMIN_COOKIE,

            makeAdminCookie(),

            {
                ...cookieOptions,
                maxAge: ADMIN_TTL
            }

        );

        res.json({ ok: true });

    }

);

app.post(

    "/api/admin/logout",

    requireAdmin,

    (req, res) => {

        adminSessions.delete(
            req.adminSessionKey
        );

        res.clearCookie(
            ADMIN_COOKIE,
            cookieOptions
        );

        res.json({ ok: true });

    }

);


/* ==========================================
   11 | ADMIN PROJECT MANAGEMENT
   ========================================== */

app.get(

    "/api/admin/projects",

    requireAdmin,

    (req, res) => {

        const projects = db.prepare(

            "SELECT * FROM projects ORDER BY created_at DESC"

        ).all();

        res.json(
            projects.map(safeProject)
        );

    }

);


/* INDIVIDUAL CLIENT PROJECT */

app.get(

    "/api/admin/projects/:id",

    requireAdmin,

    (req, res) => {

        const project =
            findProject(req.params.id);

        if (!project) {

            return fail(
                res,
                "Project not found",
                404
            );

        }

        const files = db.prepare(`

            SELECT
                id,
                kind,
                filename,
                bytes,
                created_at

            FROM files

            WHERE project_id = ?

            ORDER BY created_at DESC

        `).all(project.id);

        res.json({

            project: safeProject(project),

            files,

            ...adminAppointmentDetails(project)

        });

    }

);


/* ==========================================
   12 | PERSONALIZED CLIENT CONTRACTS
   ========================================== */

const eventNotes = {

    wedding:
        "Ceremony, reception, portraits, timeline and travel coverage must be specified.",

    quinceanera:
        "Include ceremony, family portraits, formal entrances and reception details.",

    graduation:
        "Specify locations, outfits and whether group portraits are included.",

    branding:
        "Specify commercial use, advertising rights and any brand restrictions.",

    concert:
        "Confirm venue credentials, access and performance photography rules.",

    "family-portraits":
        "Specify participants, location, outfit changes and minor-consent requirements."

};

function makeContract(project, details) {

    return [

        "MONSE MEDIA — CREATIVE SERVICES AGREEMENT",

        `Client: ${project.name} (${project.email})`,

        `Project: ${project.service} / ${project.event_type}`,

        `Event Date: ${
            project.event_date ||
            "To be agreed in writing"
        }`,

        `Location: ${
            project.event_location ||
            "To be agreed in writing"
        }`,

        `Total Fee and Payment Schedule: ${details.quote}`,

        `Coverage Duration: ${details.duration}`,

        `Deliverables: ${details.deliverables}`,

        `Delivery Timeline: ${details.turnaround}`,

        `Cancellation and Rescheduling: ${details.cancellation}`,

        `Copyright and Usage Rights: ${details.usage_rights}`,

        `Event-Specific Notes: ${
            eventNotes[project.event_type.toLowerCase()] ||
            "See the agreed scope above."
        }`,

        "Changes to the scope, cost or dates must be agreed in writing by both parties.",

        "Both parties should retain a copy of the signed agreement."

    ].join("\n\n");

}


/* APPROVE, DECLINE OR REQUEST INFORMATION */

app.post(

    "/api/admin/projects/:id/decision",

    requireAdmin,

    (req, res) => {

        const project =
            findProject(req.params.id);

        if (!project) {
            return fail(res, "Project not found", 404);
        }

        if (project.signed_at) {

            return fail(
                res,
                "A signed agreement cannot be overwritten.",
                409
            );

        }

        const decision = clean(
            req.body?.decision,
            30
        );

        if (
            !["approved", "declined", "more_info"]
                .includes(decision)
        ) {
            return fail(res, "Invalid decision");
        }


        /* ACCEPT PROJECT */

        if (decision === "approved") {

            const details = {};

            const fields = [

                "quote",
                "duration",
                "deliverables",
                "turnaround",
                "cancellation",
                "usage_rights"

            ];

            for (const field of fields) {

                details[field] = clean(
                    req.body?.[field],
                    2000
                );

                if (!details[field]) {

                    return fail(
                        res,
                        `Complete the ${field} field before approving.`
                    );

                }

            }

            db.prepare(`

                UPDATE projects

                SET
                    status = 'approved',
                    quote = @quote,
                    duration = @duration,
                    deliverables = @deliverables,
                    turnaround = @turnaround,
                    cancellation = @cancellation,
                    usage_rights = @usage_rights,
                    contract_text = @contract_text

                WHERE id = @id

            `).run({

                ...details,

                id: project.id,

                contract_text:
                    makeContract(project, details)

            });

        } else {

            db.prepare(`

                UPDATE projects

                SET
                    status = ?,
                    contract_text = NULL,
                    published = 0

                WHERE id = ?

            `).run(decision, project.id);

        }


        /* CANCEL INELIGIBLE APPOINTMENTS */

        if (decision !== "approved") {

            const appointment =
                appointmentFor(project.id);

            if (appointment?.status === "confirmed") {

                db.transaction(() => {

                    db.prepare(`

                        UPDATE appointments

                        SET
                            status = 'cancelled',
                            revision = revision + 1,
                            updated_at = ?

                        WHERE id = ?

                    `).run(now(), appointment.id);

                    db.prepare(`

                        UPDATE email_reminders

                        SET
                            status = 'cancelled',
                            updated_at = ?

                        WHERE appointment_id = ?
                        AND status = 'pending'

                    `).run(now(), appointment.id);

                }).immediate();

            }

        }


        /* EMAIL CLIENT DECISION */

        const message =

            decision === "approved"

                ? "Your project has been accepted! Your contract is ready to review and sign."

                : decision === "more_info"

                ? "Please add more details to your inspiration form."

                : "We cannot accept your project at this time.";

        void sendEmail(

            verifiedRecipient(project),

            `Monse Media — ${decision}`,

            message + (

                project.account_id

                    ? `\n\n${SITE_URL}/dashboard.html`

                    : "\n\nUse your original private client link."

            )

        );

        res.json({

            project: safeProject(
                findProject(project.id)
            )

        });

    }

);


/* ==========================================
   13 | CLIENT PROJECT INFORMATION
   ========================================== */

const imageTypes = new Set([

    "image/jpeg",
    "image/png",
    "image/webp"

]);

app.get(

    "/api/client/project",

    requireClient,

    (req, res) => {

        const project = req.project;

        let files = [];

        if (project.published && project.signed_at) {

            files = db.prepare(`

                SELECT
                    id,
                    filename,
                    mime,
                    bytes

                FROM files

                WHERE project_id = ?

                AND kind = 'deliverable'

                ORDER BY created_at

            `).all(project.id);

            files = files.map(file => ({

                ...file,

                mimeType: file.mime,

                previewUrl: imageTypes.has(file.mime)

                    ? makeTicket(
                        project,
                        file.id,
                        true
                    )

                    : null

            }));

        }

        res.json({

            project: safeProject(project),

            files

        });

    }

);


/* ==========================================
   14 | CLIENT INSPIRATION FORM
   ========================================== */

app.post(

    "/api/client/inspiration",

    requireClient,

    (req, res) => {

        const pinterest = clean(
            req.body?.pinterest,
            500
        );

        if (pinterest) {

            try {

                if (
                    new URL(pinterest).protocol !== "https:"
                ) {
                    throw new Error();
                }

            } catch {

                return fail(
                    res,
                    "Use a complete HTTPS inspiration link."
                );

            }

        }

        db.prepare(`

            UPDATE projects

            SET
                inspiration = ?,
                pinterest = ?

            WHERE id = ?

        `).run(

            clean(req.body?.inspiration, 6000),

            pinterest,

            req.project.id

        );

        res.json({ ok: true });

    }

);


/* ==========================================
   15 | ELECTRONIC CONTRACT SIGNATURES
   ========================================== */

app.post(

    "/api/client/sign",

    requireClient,

    (req, res) => {

        const project =
            findProject(req.project.id);

        if (
            !project ||
            project.status !== "approved" ||
            !project.contract_text ||
            project.signed_at
        ) {

            return fail(
                res,
                "Contract unavailable for signing.",
                409
            );

        }

        const signedName = clean(
            req.body?.signedName,
            120
        );

        if (
            signedName.length < 3 ||
            req.body?.agree !== true
        ) {

            return fail(
                res,
                "Enter your legal name and agree to sign."
            );

        }

        db.prepare(`

            UPDATE projects

            SET
                signed_name = ?,
                signed_at = ?,
                signed_ip = ?,
                signed_agent = ?,
                status = 'signed'

            WHERE id = ?

            AND signed_at IS NULL

        `).run(

            signedName,

            now(),

            clean(req.ip, 100),

            clean(req.get("user-agent"), 300),

            project.id

        );

        void sendEmail(

            ADMIN_EMAIL,

            `SIGNED CONTRACT — ${project.name}`,

            `${signedName} signed an agreement.\n\n` +
            `Review: ${SITE_URL}/admin.html`

        );

        res.json({ ok: true });

    }

);


/* ==========================================
   16 | CONTRACT PDF GENERATION
   ========================================== */

function contractPDF(res, project) {

    if (!project.contract_text) {

        return fail(
            res,
            "Contract not available",
            404
        );

    }

    res.type("application/pdf")
        .attachment("Monse-Media-Agreement.pdf");

    const pdf = new PDFDocument({
        size: "LETTER",
        margin: 50
    });

    pdf.pipe(res);

    pdf.font("Helvetica-Bold")
        .fontSize(19)
        .text("MONSE MEDIA | AGREEMENT");

    pdf.moveDown()
        .font("Helvetica")
        .fontSize(10)
        .text(
            project.contract_text,
            { lineGap: 4 }
        );

    pdf.moveDown(2)
        .font("Helvetica-Bold")
        .fontSize(12)
        .text("SIGNATURE RECORD");

    pdf.font("Helvetica")
        .fontSize(10)
        .text(
            `Signed By: ${
                project.signed_name || "Not signed"
            }`
        )
        .text(
            `Signed At (UTC): ${
                project.signed_at || "Not signed"
            }`
        )
        .text(
            `Agreement SHA-256: ${
                hash(project.contract_text)
            }`
        );

    pdf.end();

}


/* CLIENT CONTRACT DOWNLOAD */

app.get(

    "/api/client/contract",

    requireClient,

    (req, res) => {

        contractPDF(res, req.project);

    }

);


/* ADMIN CONTRACT DOWNLOAD */

app.get(

    "/api/admin/projects/:id/contract",

    requireAdmin,

    (req, res) => {

        const project =
            findProject(req.params.id);

        if (!project) {

            return fail(
                res,
                "Project not found",
                404
            );

        }

        contractPDF(res, project);

    }

);


/* ==========================================
   17 | PRIVATE FILE UPLOADS
   ========================================== */

const deliverableTypes = new Set([

    ...imageTypes,

    "video/mp4",

    "video/quicktime",

    "application/pdf",

    "application/zip"

]);

function upload(maximumBytes, allowedTypes) {

    return multer({

        storage: multer.diskStorage({

            destination: UPLOAD_DIR,

            filename: (req, file, callback) => {

                callback(null, randomUUID());

            }

        }),

        limits: {

            files: 12,

            fileSize: maximumBytes

        },

        fileFilter: (req, file, callback) => {

            if (!allowedTypes.has(file.mimetype)) {

                return callback(
                    new Error("Unsupported file type")
                );

            }

            callback(null, true);

        }

    }).array("files", 12);

}


/* SAVE FILE RECORDS */

function recordFiles(req, kind) {

    const statement = db.prepare(`

        INSERT INTO files (

            id,
            project_id,
            kind,
            stored,
            filename,
            mime,
            bytes,
            created_at

        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)

    `);

    for (const file of req.files || []) {

        const filename = path.basename(
            file.originalname
        )
            .replace(/[\x00-\x1f\x7f]/g, "")
            .slice(0, 180) || "file";

        statement.run(

            randomUUID(),

            req.project.id,

            kind,

            file.filename,

            filename,

            file.mimetype,

            file.size,

            now()

        );

    }

    return (req.files || []).length;

}


/* CLIENT REFERENCE PHOTOGRAPHS */

app.post(

    "/api/client/references",

    requireClient,

    upload(10 * 1024 * 1024, imageTypes),

    (req, res) => {

        const count = recordFiles(
            req,
            "reference"
        );

        if (!count) {

            return fail(
                res,
                "Select at least one JPG, PNG or WebP image."
            );

        }

        res.json({
            ok: true,
            count
        });

    }

);


/* ADMIN FINAL DELIVERABLE UPLOADS */

app.post(

    "/api/admin/projects/:id/files",

    requireAdmin,

    (req, res, next) => {

        req.project =
            findProject(req.params.id);

        if (!req.project) {

            return fail(
                res,
                "Project not found",
                404
            );

        }

        next();

    },

    upload(
        500 * 1024 * 1024,
        deliverableTypes
    ),

    (req, res) => {

        const count = recordFiles(
            req,
            "deliverable"
        );

        if (!count) {

            return fail(
                res,
                "Choose files to upload."
            );

        }

        res.json({
            ok: true,
            count
        });

    }

);


/* ==========================================
   18 | PUBLISH CLIENT GALLERY
   ========================================== */

app.post(

    "/api/admin/projects/:id/publish",

    requireAdmin,

    (req, res) => {

        const project =
            findProject(req.params.id);

        if (!project) {

            return fail(
                res,
                "Project not found",
                404
            );

        }

        if (!project.signed_at) {

            return fail(
                res,
                "Client must sign the contract first.",
                409
            );

        }

        if (project.published) {

            return res.json({
                ok: true
            });

        }

        const hasFiles = db.prepare(`

            SELECT 1

            FROM files

            WHERE project_id = ?

            AND kind = 'deliverable'

            LIMIT 1

        `).get(project.id);

        if (!hasFiles) {

            return fail(
                res,
                "Upload at least one completed file first."
            );

        }

        db.prepare(`

            UPDATE projects

            SET
                published = 1,
                status = 'delivered'

            WHERE id = ?

        `).run(project.id);


        /* MARK PAST APPOINTMENT COMPLETED */

        db.prepare(`

            UPDATE appointments

            SET
                status = 'completed',
                updated_at = ?

            WHERE project_id = ?

            AND status = 'confirmed'

            AND starts_at <= ?

        `).run(
            now(),
            project.id,
            now()
        );


        /* SEND GALLERY READY EMAIL */

        const recipient =
            verifiedRecipient(project);

        if (recipient && project.account_id) {

            void mailer.sendGalleryReady(
                recipient,
                project.name
            );

        } else if (recipient) {

            void sendEmail(

                recipient,

                "Monse Media — Your Gallery Is Ready",

                "Your finished files are ready! Use your original private project link."

            );

        }

        res.json({ ok: true });

    }

);


/* ==========================================
   19 | SECURE DOWNLOAD TICKETS
   ========================================== */

function makeTicket(
    project,
    fileId,
    preview = false,
    admin = false
) {

    const details = {

        p: project.id,

        f: fileId,

        i: preview,

        a: admin,

        x: Date.now() + 2 * 60 * 1000

    };

    const data = Buffer.from(
        JSON.stringify(details)
    ).toString("base64url");

    return `/api/access/${data}.${hmac(data)}`;

}


/* CLIENT FILE DOWNLOAD REQUEST */

app.post(

    "/api/client/download-link",

    requireClient,

    (req, res) => {

        const project = req.project;

        if (!project.published || !project.signed_at) {

            return fail(
                res,
                "Gallery not ready",
                403
            );

        }

        const fileId = clean(
            req.body?.fileId,
            80
        );

        if (

            fileId !== "all" &&

            !db.prepare(`

                SELECT 1

                FROM files

                WHERE id = ?

                AND project_id = ?

                AND kind = 'deliverable'

            `).get(fileId, project.id)

        ) {

            return fail(
                res,
                "File not found",
                404
            );

        }

        res.json({

            url: makeTicket(
                project,
                fileId
            )

        });

    }

);


/* ADMIN FILE DOWNLOAD REQUEST */

app.post(

    "/api/admin/projects/:id/download-link",

    requireAdmin,

    (req, res) => {

        const project =
            findProject(req.params.id);

        if (!project) {

            return fail(
                res,
                "Project not found",
                404
            );

        }

        const fileId = clean(
            req.body?.fileId,
            80
        );

        const exists = db.prepare(

            "SELECT 1 FROM files " +
            "WHERE id = ? AND project_id = ?"

        ).get(fileId, project.id);

        if (!exists) {

            return fail(
                res,
                "File not found",
                404
            );

        }

        res.json({

            url: makeTicket(
                project,
                fileId,
                false,
                true
            )

        });

    }

);


/* ==========================================
   20 | PRIVATE GALLERY DOWNLOADS
   ========================================== */

app.get(

    "/api/access/:ticket",

    async (req, res) => {

        const [data, signature] =
            req.params.ticket.split(".");

        if (
            !data ||
            !signature ||
            !same(signature, hmac(data))
        ) {

            return fail(
                res,
                "Invalid download link",
                403
            );

        }

        let ticket;

        try {

            ticket = JSON.parse(

                Buffer.from(
                    data,
                    "base64url"
                ).toString()

            );

        } catch {

            return fail(
                res,
                "Invalid download link",
                403
            );

        }

        if (
            !Number.isFinite(ticket.x) ||
            Date.now() > ticket.x
        ) {

            return fail(
                res,
                "Download link expired",
                403
            );

        }


        /* VERIFY ADMIN DOWNLOAD SESSION */

        if (ticket.a) {

            let authorized = false;

            requireAdmin(
                req,
                res,
                () => {
                    authorized = true;
                }
            );

            if (!authorized) return;

        }

        const project =
            findProject(ticket.p);

        if (
            !project ||
            (
                !ticket.a &&
                (
                    !project.published ||
                    !project.signed_at
                )
            )
        ) {

            return fail(
                res,
                "Gallery unavailable",
                403
            );

        }


        /* FIND PRIVATE GALLERY FILES */

        const files = ticket.a

            ? db.prepare(

                "SELECT * FROM files WHERE project_id = ?"

            ).all(project.id)

            : db.prepare(

                "SELECT * FROM files " +
                "WHERE project_id = ? " +
                "AND kind = 'deliverable'"

            ).all(project.id);


        /* DOWNLOAD COMPLETE GALLERY */

        if (ticket.f === "all") {

            if (!files.length) {

                return fail(
                    res,
                    "No files available",
                    404
                );

            }

            const { ZipArchive } =
                await import("archiver");

            const zip = new ZipArchive({
                zlib: { level: 1 }
            });

            res.attachment(
                "Monse-Media-Gallery.zip"
            );

            zip.on("error", error =>
                res.destroy(error)
            );

            zip.on("warning", error =>
                res.destroy(error)
            );

            res.on("close", () => {

                if (!res.writableFinished) {
                    zip.abort();
                }

            });

            zip.pipe(res);

            const names = new Set();

            for (const file of files) {

                const original = path.basename(
                    file.filename.replace(/\\/g, "/")
                ) || "file";

                const ext =
                    path.extname(original);

                const stem =
                    path.basename(original, ext);

                let name = original;

                let n = 2;

                while (
                    names.has(name.toLowerCase())
                ) {

                    name = `${stem}-${n++}${ext}`;

                }

                names.add(name.toLowerCase());

                zip.file(

                    path.join(
                        UPLOAD_DIR,
                        file.stored
                    ),

                    { name }

                );

            }

            await zip.finalize();

            return;

        }


        /* DOWNLOAD INDIVIDUAL FILE */

        const file = files.find(
            item => item.id === ticket.f
        );

        if (!file) {

            return fail(
                res,
                "File unavailable",
                404
            );

        }

        const filePath = path.join(
            UPLOAD_DIR,
            file.stored
        );


        /* PRIVATE IMAGE OR VIDEO PREVIEW */

        if (
            ticket.i &&
            (
                imageTypes.has(file.mime) ||
                ["video/mp4", "video/quicktime"]
                    .includes(file.mime)
            )
        ) {

            res.type(file.mime);

            return res.sendFile(
                filePath,
                {
                    cacheControl: false,
                    acceptRanges: true
                }
            );

        }

        res.download(
            filePath,
            file.filename
        );

    }

);


/* ==========================================
   21 | CLIENT ACCOUNT INTEGRATION
   ========================================== */

const accountRoot = "/api/client/account";

const requireAccount =
    accounts.requireAccount;

const preferenceKeys = [

    "week_before",

    "day_before",

    "morning_of"

];

const settingsLimiter = rateLimit({

    windowMs: 15 * 60 * 1000,

    limit: 10,

    standardHeaders: "draft-7",

    legacyHeaders: false

});


/* GET CLIENT EMAIL PREFERENCES */

function prefsFor(id) {

    const row = db.prepare(

        "SELECT * FROM email_preferences WHERE account_id = ?"

    ).get(id);

    return Object.fromEntries(

        preferenceKeys.map(key => [

            key,

            row?.[key] === 1

        ])

    );

}


/* VALIDATE EMAIL PREFERENCES */

function validPrefs(p) {

    return (

        p &&

        typeof p === "object" &&

        !Array.isArray(p) &&

        preferenceKeys.every(
            key => typeof p[key] === "boolean"
        ) &&

        Object.keys(p).length === 3

    );

}


/* SAVE EMAIL PREFERENCES */

function savePrefs(id, preferences) {

    db.prepare(`

        INSERT INTO email_preferences (

            account_id,
            week_before,
            day_before,
            morning_of,
            updated_at

        ) VALUES (?, ?, ?, ?, ?)

        ON CONFLICT(account_id) DO UPDATE SET

            week_before = excluded.week_before,

            day_before = excluded.day_before,

            morning_of = excluded.morning_of,

            updated_at = excluded.updated_at

    `).run(

        id,

        ...preferenceKeys.map(
            key => Number(preferences[key])
        ),

        now()

    );

}


/* FIND APPOINTMENT */

function appointmentFor(id) {

    return db.prepare(

        "SELECT * FROM appointments WHERE project_id = ?"

    ).get(id) || null;

}


/* VERIFY PROJECT OWNERSHIP */

function ownedProject(req, res) {

    const project = db.prepare(`

        SELECT *

        FROM projects

        WHERE id = ?

        AND account_id = ?

    `).get(
        req.params.id,
        req.account.id
    );

    if (!project) {

        fail(
            res,
            "Project not found",
            404
        );

    }

    return project;

}


/* GET CLIENT GALLERY FILES */

function fileRows(project) {

    return db.prepare(`

        SELECT
            id,
            filename,
            mime,
            bytes

        FROM files

        WHERE project_id = ?

        AND kind = 'deliverable'

        ORDER BY created_at

    `).all(project.id);

}


/* VERIFY GALLERY AVAILABILITY */

function readyGallery(project) {

    return (
        !!project.published &&
        !!project.signed_at
    );

}


/* FORMAT CLIENT PROJECT */

function accountProject(project) {

    const appointment =
        appointmentFor(project.id);

    const files = readyGallery(project)

        ? fileRows(project)

        : [];

    const cover = files.find(
        file => imageTypes.has(file.mime)
    );

    return {

        ...safeProject(project),

        published: !!project.published,

        appointment,

        fileCount: files.length,

        coverUrl: cover

            ? makeTicket(
                project,
                cover.id,
                true
            )

            : null

    };

}


/* GET ALL PROJECTS OWNED BY ACCOUNT */

function accountProjects(id) {

    return db.prepare(`

        SELECT *

        FROM projects

        WHERE account_id = ?

        ORDER BY created_at DESC

    `).all(id);

}


/* SAFE CLIENT PROFILE */

function profileFor(account) {

    return accounts.safeProfile(account);

}


/* GET CURRENT VERIFIED EMAIL */

function verifiedRecipient(project) {

    if (!project.account_id) {

        return project.email;

    }

    const account = db.prepare(`

        SELECT
            email,
            email_verified_at,
            disabled_at,
            deletion_requested_at

        FROM client_accounts

        WHERE id = ?

    `).get(project.account_id);

    return (

        account?.email_verified_at &&

        !account.disabled_at &&

        !account.deletion_requested_at

    ) ? account.email : null;

}


/* ==========================================
   22 | RETURNING CLIENT DASHBOARD
   ========================================== */

app.get(

    accountRoot + "/dashboard",

    requireAccount,

    (req, res) => {

        const rows =
            accountProjects(req.account.id)
                .map(accountProject);

        const upcoming = [];

        const past = [];

        const requests = [];

        for (const project of rows) {

            if (
                project.published ||
                project.appointment?.status === "completed" ||
                project.status === "completed"
            ) {

                past.push(project);

            } else if (
                project.appointment?.status === "confirmed" &&
                project.appointment.starts_at > now()
            ) {

                upcoming.push(project);

            } else if (
                project.appointment?.status === "confirmed" &&
                project.appointment.starts_at <= now()
            ) {

                past.push(project);

            } else {

                requests.push(project);

            }

        }

        upcoming.sort(
            (a, b) =>
                a.appointment.starts_at.localeCompare(
                    b.appointment.starts_at
                )
        );

        res.json({

            authenticated: true,

            profile: profileFor(req.account),

            upcoming,

            past,

            requests,

            email_preferences:
                prefsFor(req.account.id),

            capabilities: {

                sessionDetails: true,

                emailReminders:
                    reminders.isConfigured()

            }

        });

    }

);


/* ==========================================
   23 | CLIENT GALLERY COLLECTIONS
   ========================================== */

app.get(

    accountRoot + "/galleries",

    requireAccount,

    (req, res) => {

        res.json({

            authenticated: true,

            profile: profileFor(req.account),

            collections:

                accountProjects(req.account.id)

                    .filter(readyGallery)

                    .map(accountProject)

        });

    }

);


/* INDIVIDUAL CLIENT GALLERY */

app.get(

    accountRoot + "/projects/:id/gallery",

    requireAccount,

    (req, res) => {

        const project =
            ownedProject(req, res);

        if (!project) return;

        if (!readyGallery(project)) {

            return fail(
                res,
                "Gallery not ready",
                403
            );

        }

        res.json({

            project: accountProject(project),

            files: fileRows(project).map(file => ({

                ...file,

                mimeType: file.mime,

                previewUrl:

                    imageTypes.has(file.mime) ||

                    ["video/mp4", "video/quicktime"]
                        .includes(file.mime)

                        ? makeTicket(
                            project,
                            file.id,
                            true
                        )

                        : null

            }))

        });

    }

);


/* ACCOUNT GALLERY DOWNLOADS */

app.post(

    accountRoot + "/projects/:id/download-link",

    requireAccount,

    (req, res) => {

        const project =
            ownedProject(req, res);

        if (!project) return;

        if (!readyGallery(project)) {

            return fail(
                res,
                "Gallery not ready",
                403
            );

        }

        const id = clean(
            req.body?.fileId,
            80
        );

        if (
            id !== "all" &&
            !fileRows(project)
                .some(file => file.id === id)
        ) {

            return fail(
                res,
                "File not found",
                404
            );

        }

        res.json({

            url: makeTicket(
                project,
                id
            )

        });

    }

);


/* ==========================================
   24 | RETURNING CLIENT BOOKING REQUESTS
   ========================================== */

app.post(

    accountRoot + "/inquiries",

    inquiryLimiter,

    requireAccount,

    (req, res) => {

        const body = req.body || {};

        const account = req.account;

        if (account.deletion_requested_at) {

            return fail(
                res,
                "Account deletion is pending",
                409
            );

        }

        const service =
            clean(body.service, 80);

        const event =
            clean(
                body.event_type || "Custom project",
                100
            );

        const date =
            clean(body.event_date, 10);

        const time =
            clean(body.event_time, 5);

        const timezone =
            clean(
                body.timezone || "America/Chicago",
                100
            );

        const location =
            clean(body.event_location, 200);

        const message =
            clean(body.message, 5000);

        if (
            !service ||
            !message ||
            body.booking_acknowledgment !== true
        ) {

            return fail(
                res,
                "Complete the required booking details"
            );

        }


        /* VALIDATE REQUESTED DATE AND TIME */

        try {

            new Intl.DateTimeFormat(
                "en-US",
                { timeZone: timezone }
            );

            if (
                date &&
                !/^\d{4}-\d{2}-\d{2}$/.test(date)
            ) {
                throw new Error();
            }

            if (date) {

                localToUTC(
                    date,
                    time || "12:00",
                    timezone
                );

            }

            if (time && !date) {
                throw new Error();
            }

        } catch {

            return fail(
                res,
                "Invalid requested appointment date or time"
            );

        }


        /* OPTIONAL EMAIL PREFERENCE UPDATE */

        const update = Object.hasOwn(
            body,
            "email_preferences"
        );

        if (
            update &&
            !validPrefs(body.email_preferences)
        ) {

            return fail(
                res,
                "Invalid email preferences"
            );

        }

        const id = randomUUID();

        const name = [

            account.first_name,

            account.last_name

        ].filter(Boolean).join(" ") ||
            account.email;


        /* SAVE ACCOUNT BOOKING */

        db.transaction(() => {

            db.prepare(`

                INSERT INTO projects (

                    id,
                    account_id,
                    name,
                    email,
                    service,
                    event_type,
                    event_date,
                    event_time,
                    timezone,
                    event_location,
                    message,
                    status,
                    token_hash,
                    created_at

                ) VALUES (

                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                    'pending', ?, ?

                )

            `).run(

                id,

                account.id,

                name,

                account.email,

                service,

                event,

                date || null,

                time || null,

                timezone,

                location,

                message,

                hash(
                    randomBytes(32)
                        .toString("base64url")
                ),

                now()

            );

            if (update) {

                savePrefs(
                    account.id,
                    body.email_preferences
                );

            }

        }).immediate();


        /* SEND BOOKING NOTIFICATIONS */

        void mailer.notifyAdmin(

            "Monse Media — New client request",

            `${name} submitted a ${service} request. ` +
            `Review: ${SITE_URL}/admin.html`

        );

        void sendEmail(

            account.email,

            "Monse Media — Request received",

            `Hi ${name},\n\n` +
            "Your request is awaiting review. It is not confirmed yet.\n" +
            `${SITE_URL}/dashboard.html`

        );

        res.status(201).json({

            ok: true,

            id,

            emailPreferencesSaved: update

        });

    }

);


/* ==========================================
   25 | CLIENT ACCOUNT SETTINGS
   ========================================== */

app.get(

    accountRoot + "/settings",

    requireAccount,

    (req, res) => {

        const account = req.account;

        const pending = !!db.prepare(`

            SELECT 1

            FROM account_tokens

            WHERE account_id = ?

            AND purpose = 'change_email'

            AND used_at IS NULL

            AND revoked_at IS NULL

            AND expires_at > ?

        `).get(account.id, now());

        res.json({

            authenticated: true,

            profile: {

                ...profileFor(account),

                emailChangePending: pending

            },

            email_preferences:
                prefsFor(account.id),

            deletionPending:
                !!account.deletion_requested_at,

            capabilities: {

                profile: true,

                email:

                    mailer.isConfigured() &&

                    !account.deletion_requested_at,

                notifications:
                    !account.deletion_requested_at,

                password: true,

                deletion: true

            }

        });

    }

);


/* UPDATE PERSONAL INFORMATION */

app.post(

    accountRoot + "/profile",

    requireAccount,

    (req, res) => {

        const body = req.body || {};

        const first = clean(
            body.first_name,
            80
        );

        const last = clean(
            body.last_name,
            80
        );

        if (
            !first ||
            !last ||
            !["en", "es"].includes(
                body.preferred_language
            )
        ) {

            return fail(
                res,
                "Invalid profile details"
            );

        }

        db.prepare(`

            UPDATE client_accounts

            SET
                first_name = ?,
                last_name = ?,
                preferred_language = ?,
                updated_at = ?

            WHERE id = ?

        `).run(

            first,

            last,

            body.preferred_language,

            now(),

            req.account.id

        );

        res.json({ ok: true });

    }

);


/* ==========================================
   26 | EMAIL NOTIFICATION PREFERENCES
   ========================================== */

app.post(

    accountRoot + "/notifications",

    requireAccount,

    (req, res) => {

        if (req.account.deletion_requested_at) {

            return fail(
                res,
                "Account deletion is pending",
                409
            );

        }

        const preferences =
            req.body?.email_preferences;

        if (!validPrefs(preferences)) {

            return fail(
                res,
                "Invalid email preferences"
            );

        }

        savePrefs(
            req.account.id,
            preferences
        );

        res.json({ ok: true });

    }

);


/* ==========================================
   27 | ACCOUNT PASSWORD VERIFICATION
   ========================================== */

async function passwordOK(req) {

    const secret =
        req.body?.current_password;

    return (

        typeof secret === "string" &&

        secret.length <= 128 &&

        await accounts.verifyPassword(

            secret,

            req.account.password_hash

        )

    );

}

function unchangedAccount(account) {

    const current = db.prepare(

        "SELECT * FROM client_accounts WHERE id = ?"

    ).get(account.id);

    return (

        current &&

        !current.disabled_at &&

        current.password_hash === account.password_hash &&

        current.email === account.email

    );

}


/* ==========================================
   28 | CHANGE CLIENT PASSWORD
   ========================================== */

app.post(

    accountRoot + "/password",

    settingsLimiter,

    requireAccount,

    async (req, res) => {

        const next = req.body?.new_password;

        if (
            typeof next !== "string" ||
            next.length < 12 ||
            next.length > 128 ||
            next === req.body?.current_password
        ) {

            return fail(
                res,
                "Choose a different password (12–128 characters)"
            );

        }

        if (!await passwordOK(req)) {

            return fail(
                res,
                "Incorrect current password",
                400
            );

        }

        const digest =
            await accounts.hashPassword(next);

        if (!unchangedAccount(req.account)) {

            return fail(
                res,
                "Account changed; sign in again",
                409
            );

        }

        db.transaction(() => {

            db.prepare(`

                UPDATE client_accounts

                SET
                    password_hash = ?,
                    updated_at = ?

                WHERE id = ?

            `).run(

                digest,

                now(),

                req.account.id

            );

            db.prepare(`

                UPDATE client_sessions

                SET revoked_at = ?

                WHERE account_id = ?

                AND revoked_at IS NULL

            `).run(now(), req.account.id);

            db.prepare(`

                UPDATE account_tokens

                SET revoked_at = ?

                WHERE account_id = ?

                AND used_at IS NULL

                AND revoked_at IS NULL

            `).run(now(), req.account.id);

        }).immediate();

        res.clearCookie("monse_client", {

            path: "/api/client",

            httpOnly: true,

            sameSite: "strict",

            secure: SECURE_COOKIE

        });

        res.json({ ok: true });

    }

);


/* ==========================================
   29 | CHANGE CLIENT EMAIL ADDRESS
   ========================================== */

app.post(

    accountRoot + "/email",

    settingsLimiter,

    requireAccount,

    async (req, res) => {

        if (!mailer.isConfigured()) {

            return fail(
                res,
                "Email service unavailable",
                503
            );

        }

        const address = clean(
            req.body?.new_email,
            254
        ).toLowerCase();

        if (
            !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/
                .test(address) ||
            address === req.account.email.toLowerCase() ||
            req.account.deletion_requested_at
        ) {

            return fail(
                res,
                "Invalid email change"
            );

        }

        if (!await passwordOK(req)) {

            return fail(
                res,
                "Incorrect current password"
            );

        }

        if (!unchangedAccount(req.account)) {

            return fail(
                res,
                "Account changed",
                409
            );

        }

        if (

            db.prepare(

                "SELECT 1 FROM client_accounts WHERE email = ? COLLATE NOCASE"

            ).get(address)

        ) {

            return fail(
                res,
                "Email unavailable",
                409
            );

        }

        const token =
            randomBytes(32).toString("base64url");

        const stamp = now();

        db.transaction(() => {

            db.prepare(`

                UPDATE account_tokens

                SET revoked_at = ?

                WHERE account_id = ?

                AND purpose = 'change_email'

                AND used_at IS NULL

                AND revoked_at IS NULL

            `).run(stamp, req.account.id);

            db.prepare(`

                INSERT INTO account_tokens (

                    token_hash,
                    account_id,
                    purpose,
                    new_email,
                    created_at,
                    expires_at

                ) VALUES (

                    ?, ?, 'change_email', ?, ?, ?

                )

            `).run(

                hash(token),

                req.account.id,

                address,

                stamp,

                new Date(
                    Date.now() + 30 * 60 * 1000
                ).toISOString()

            );

        }).immediate();


        /* SEND EMAIL VERIFICATION */

        if (
            !await mailer.sendEmailChange(
                address,
                token
            )
        ) {

            db.prepare(`

                UPDATE account_tokens

                SET revoked_at = ?

                WHERE token_hash = ?

                AND used_at IS NULL

            `).run(now(), hash(token));

            return fail(
                res,
                "Email could not be confirmed as sent",
                503
            );

        }


        /* NOTIFY ORIGINAL EMAIL ADDRESS */

        void sendEmail(

            req.account.email,

            "Monse Media — Email change requested",

            "A change to your account email was requested. Contact Monse Media if this was not you."

        );

        res.json({ ok: true });

    }

);


/* ==========================================
   30 | VERIFY NEW EMAIL ADDRESS
   ========================================== */

app.post(

    accountRoot + "/verify-email-change",

    settingsLimiter,

    (req, res) => {

        const token = req.body?.token;

        if (
            typeof token !== "string" ||
            !/^[A-Za-z0-9_-]{43,128}$/.test(token)
        ) {

            return fail(
                res,
                "Invalid link",
                410
            );

        }

        const stamp = now();

        const success = db.transaction(() => {

            const row = db.prepare(`

                SELECT
                    t.*,
                    c.disabled_at,
                    c.deletion_requested_at

                FROM account_tokens t

                JOIN client_accounts c

                    ON c.id = t.account_id

                WHERE token_hash = ?

                AND purpose = 'change_email'

                AND used_at IS NULL

                AND revoked_at IS NULL

                AND expires_at > ?

            `).get(hash(token), stamp);

            if (

                !row ||

                !row.new_email ||

                row.disabled_at ||

                row.deletion_requested_at ||

                db.prepare(

                    "SELECT 1 FROM client_accounts WHERE email = ? COLLATE NOCASE"

                ).get(row.new_email)

            ) {

                return false;

            }

            db.prepare(`

                UPDATE client_accounts

                SET
                    email = ?,
                    email_verified_at = ?,
                    updated_at = ?

                WHERE id = ?

            `).run(

                row.new_email,

                stamp,

                stamp,

                row.account_id

            );

            db.prepare(`

                UPDATE account_tokens

                SET used_at = ?

                WHERE token_hash = ?

            `).run(stamp, row.token_hash);

            db.prepare(`

                UPDATE account_tokens

                SET revoked_at = ?

                WHERE account_id = ?

                AND used_at IS NULL

                AND revoked_at IS NULL

            `).run(stamp, row.account_id);

            db.prepare(`

                UPDATE client_sessions

                SET revoked_at = ?

                WHERE account_id = ?

                AND revoked_at IS NULL

            `).run(stamp, row.account_id);

            return true;

        }).immediate();

        if (!success) {

            return fail(
                res,
                "Invalid or expired email change",
                410
            );

        }

        res.clearCookie("monse_client", {

            path: "/api/client",

            httpOnly: true,

            sameSite: "strict",

            secure: SECURE_COOKIE

        });

        res.json({ ok: true });

    }

);


/* ==========================================
   31 | ACCOUNT DELETION REQUESTS
   ========================================== */

app.post(

    accountRoot + "/deletion-request",

    settingsLimiter,

    requireAccount,

    async (req, res) => {

        if (
            req.body?.acknowledge !== true ||
            !await passwordOK(req)
        ) {

            return fail(
                res,
                "Confirm the request and current password"
            );

        }

        if (!unchangedAccount(req.account)) {

            return fail(
                res,
                "Account changed",
                409
            );

        }

        const stamp = now();

        db.transaction(() => {

            db.prepare(`

                UPDATE client_accounts

                SET

                    deletion_requested_at =
                        COALESCE(deletion_requested_at, ?),

                    updated_at = ?

                WHERE id = ?

            `).run(

                stamp,

                stamp,

                req.account.id

            );


            /* DISABLE OPTIONAL EMAIL REMINDERS */

            savePrefs(req.account.id, {

                week_before: false,

                day_before: false,

                morning_of: false

            });

        }).immediate();


        /* NOTIFY STUDIO OWNER */

        void mailer.notifyAdmin(

            "Monse Media — Account deletion requested",

            `Account: ${req.account.id}\n` +

            `Reason: ${
                clean(req.body?.reason, 1000)
            }\n` +

            "Review manually before deleting records."

        );

        res.json({ ok: true });

    }

);


/* ==========================================
   32 | LINK PREVIOUS CLIENT BOOKINGS
   ========================================== */

/*
   A client must possess the original private
   project link AND a matching verified account.

   Email address alone is not sufficient.
*/

app.post(

    accountRoot + "/claim-project",

    requireAccount,

    settingsLimiter,

    (req, res) => {

        const token = req.body?.token;

        if (
            typeof token !== "string" ||
            !/^[A-Za-z0-9_-]{40,100}$/.test(token) ||
            req.account.deletion_requested_at
        ) {

            return fail(
                res,
                "Invalid claim",
                400
            );

        }

        const changed = db.prepare(`

            UPDATE projects

            SET account_id = ?

            WHERE token_hash = ?

            AND account_id IS NULL

            AND email = ? COLLATE NOCASE

        `).run(

            req.account.id,

            hash(token),

            req.account.email

        ).changes;

        if (!changed) {

            return fail(
                res,
                "Project cannot be linked",
                409
            );

        }

        res.json({ ok: true });

    }

);


/* CONNECT ACCOUNT AUTHENTICATION ROUTES */

app.use(
    accountRoot,
    accounts.router
);


/* ==========================================
   33 | ADMIN APPOINTMENT INFORMATION
   ========================================== */

function adminAppointmentDetails(project) {

    const appointment =
        appointmentFor(project.id);

    const account = project.account_id

        ? db.prepare(

            "SELECT * FROM client_accounts WHERE id = ?"

        ).get(project.account_id)

        : null;

    const rows = appointment

        ? db.prepare(`

            SELECT
                kind,
                status,
                due_at,
                sent_at

            FROM email_reminders

            WHERE appointment_id = ?

            AND appointment_revision = ?

        `).all(

            appointment.id,

            appointment.revision

        )

        : [];

    return {

        appointment,

        email_preferences: account

            ? prefsFor(account.id)

            : null,

        reminder_email:

            account?.email_verified_at &&

            !account.disabled_at &&

            !account.deletion_requested_at

                ? account.email

                : null,

        email_reminders:

            Object.fromEntries(

                rows.map(row => [

                    row.kind,

                    row

                ])

            ),

        clientHistory: account

            ? db.prepare(`

                SELECT
                    id,
                    service,
                    event_date,
                    status

                FROM projects

                WHERE account_id = ?

                AND id <> ?

                ORDER BY created_at DESC

            `).all(

                account.id,

                project.id

            )

            : [],

        capabilities: {

            appointments: true,

            emailReminders:
                reminders.isConfigured()

        }

    };

}


/* ==========================================
   34 | CONFIRM OR RESCHEDULE APPOINTMENT
   ========================================== */

app.post(

    "/api/admin/projects/:id/appointment",

    requireAdmin,

    (req, res) => {

        const project =
            findProject(req.params.id);

        if (!project) {

            return fail(
                res,
                "Project not found",
                404
            );

        }

        if (
            !["approved", "signed"]
                .includes(project.status) ||
            project.published
        ) {

            return fail(
                res,
                "Approve the project before scheduling",
                409
            );

        }

        const body = req.body || {};

        const date =
            clean(body.date, 10);

        const time =
            clean(body.time, 5);

        const timezone =
            clean(body.timezone, 100);

        const location =
            clean(body.location, 200);

        let start;

        try {

            start = localToUTC(
                date,
                time,
                timezone
            );

        } catch {

            return fail(
                res,
                "Choose a valid unambiguous session time"
            );

        }

        if (!location || start <= now()) {

            return fail(
                res,
                "Choose a future appointment and location"
            );

        }

        const previous =
            appointmentFor(project.id);


        /* PREVENT IDENTICAL APPOINTMENT UPDATES */

        if (

            previous?.status === "confirmed" &&

            previous.starts_at === start &&

            previous.date === date &&

            previous.time === time &&

            previous.timezone === timezone &&

            previous.location === location

        ) {

            return res.json({
                ok: true
            });

        }

        const stamp = now();


        /* SAVE CONFIRMED APPOINTMENT */

        db.transaction(() => {

            db.prepare(`

                INSERT INTO appointments (

                    id,
                    project_id,
                    date,
                    time,
                    timezone,
                    location,
                    starts_at,
                    status,
                    revision,
                    created_at,
                    updated_at

                ) VALUES (

                    ?, ?, ?, ?, ?, ?, ?,
                    'confirmed', 1, ?, ?

                )

                ON CONFLICT(project_id) DO UPDATE SET

                    date = excluded.date,

                    time = excluded.time,

                    timezone = excluded.timezone,

                    location = excluded.location,

                    starts_at = excluded.starts_at,

                    status = 'confirmed',

                    revision = appointments.revision + 1,

                    updated_at = excluded.updated_at

            `).run(

                randomUUID(),

                project.id,

                date,

                time,

                timezone,

                location,

                start,

                stamp,

                stamp

            );


            /* CANCEL OLD PENDING REMINDERS */

            if (previous) {

                db.prepare(`

                    UPDATE email_reminders

                    SET
                        status = 'cancelled',
                        updated_at = ?

                    WHERE appointment_id = ?

                    AND status = 'pending'

                `).run(stamp, previous.id);

            }

        }).immediate();


        /* SEND APPOINTMENT CONFIRMATION EMAIL */

        const recipient =
            verifiedRecipient(project);

        if (recipient) {

            if (project.account_id) {

                void mailer.sendAppointmentConfirmation(

                    recipient,

                    {

                        date,

                        time,

                        timezone,

                        location,

                        name: project.name

                    }

                );

            } else {

                void sendEmail(

                    recipient,

                    "Monse Media — Appointment confirmed",

                    `Your appointment: ${date} ${time} (${timezone})\n` +

                    `Location: ${location}\n` +

                    "Use your original private project link."

                );

            }

        }


        /* UPDATE AUTOMATIC EMAIL SCHEDULE */

        void reminders.tick();

        res.json({ ok: true });

    }

);


/* ==========================================
   35 | CANCEL APPOINTMENT
   ========================================== */

app.post(

    "/api/admin/projects/:id/appointment/cancel",

    requireAdmin,

    (req, res) => {

        const project =
            findProject(req.params.id);

        if (!project) {

            return fail(
                res,
                "Project not found",
                404
            );

        }

        const appointment =
            appointmentFor(project.id);

        if (!appointment) {

            return fail(
                res,
                "Appointment not found",
                404
            );

        }

        if (appointment.status === "cancelled") {

            return res.json({
                ok: true
            });

        }

        if (
            appointment.status === "completed" ||
            project.published
        ) {

            return fail(
                res,
                "Completed appointment cannot be cancelled",
                409
            );

        }

        const stamp = now();

        db.transaction(() => {

            db.prepare(`

                UPDATE appointments

                SET
                    status = 'cancelled',
                    revision = revision + 1,
                    updated_at = ?

                WHERE id = ?

            `).run(stamp, appointment.id);

            db.prepare(`

                UPDATE email_reminders

                SET
                    status = 'cancelled',
                    updated_at = ?

                WHERE appointment_id = ?

                AND status = 'pending'

            `).run(stamp, appointment.id);

        }).immediate();


        /* EMAIL CANCELLATION NOTICE */

        const recipient =
            verifiedRecipient(project);

        if (recipient) {

            void sendEmail(

                recipient,

                "Monse Media — Appointment cancelled",

                "Your appointment has been cancelled. Contact Monse Media if you have questions."

            );

        }

        res.json({ ok: true });

    }

);

/* ==========================================
   PAST CLIENT ARCHIVE | SHRED PROJECT
   ========================================== */

app.post(
    "/api/admin/projects/:id/shred",
    requireAdmin,
    (req, res) => {

        if (
            req.body?.confirm !== "SHRED" ||
            req.body?.projectId !== req.params.id
        ) {
            return fail(
                res,
                "Explicit project confirmation is required",
                400
            );
        }

        const project = findProject(req.params.id);

        if (!project) {
            return fail(res, "Project not found", 404);
        }

        if (
            !project.published &&
            !["delivered", "completed"].includes(project.status)
        ) {
            return fail(
                res,
                "Only completed projects can be shredded",
                409
            );
        }

        const appointment = appointmentFor(project.id);

        if (
            appointment?.status === "confirmed" &&
            appointment.starts_at > now()
        ) {
            return fail(
                res,
                "A future appointment still exists for this project",
                409
            );
        }

        if (
            appointment &&
            db.prepare(`
                SELECT 1
                FROM email_reminders
                WHERE appointment_id = ?
                AND status = 'processing'
            `).get(appointment.id)
        ) {
            return fail(
                res,
                "A reminder is being processed. Refresh and retry later.",
                409
            );
        }

        const files = db.prepare(`
            SELECT stored
            FROM files
            WHERE project_id = ?
        `).all(project.id);

        const names = [
            ...new Set(files.map(file => file.stored))
        ];

        /* VALIDATE PRIVATE FILES */

        for (const stored of names) {

            if (
                !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(stored) ||
                db.prepare(`
                    SELECT 1
                    FROM files
                    WHERE stored = ?
                    AND project_id <> ?
                `).get(stored, project.id)
            ) {
                return fail(
                    res,
                    "An uploaded file needs manual review before shredding",
                    409
                );
            }
        }

        /* DELETE PROJECT RECORDS */

        db.transaction(() => {

            if (appointment) {

                db.prepare(`
                    DELETE FROM email_reminders
                    WHERE appointment_id = ?
                `).run(appointment.id);

                db.prepare(`
                    DELETE FROM sms_reminders
                    WHERE appointment_id = ?
                `).run(appointment.id);

                db.prepare(`
                    DELETE FROM appointments
                    WHERE id = ?
                `).run(appointment.id);

            }

            db.prepare(`
                DELETE FROM files
                WHERE project_id = ?
            `).run(project.id);

            db.prepare(`
                DELETE FROM projects
                WHERE id = ?
            `).run(project.id);

        }).immediate();

        /* DELETE PRIVATE UPLOADED FILES */

        let cleanupFailed = false;

        for (const stored of names) {

            try {

                fs.unlinkSync(
                    path.join(UPLOAD_DIR, stored)
                );

            } catch (error) {

                if (error.code !== "ENOENT") {

                    cleanupFailed = true;

                    console.error(
                        "Shred cleanup failed:",
                        stored,
                        error.code
                    );

                }

            }

        }

        res.json({

            ok: true,

            warning: cleanupFailed
                ? "Project removed, but some private files require manual cleanup. Review the server log."
                : null

        });

    }
);


/* END | PAST CLIENT ARCHIVE */
/* ==========================================
   36 | SERVER HEALTH CHECK
   ========================================== */

app.get("/api/health", (req, res) => {

    db.prepare("SELECT 1").get();

    res.json({

        ok: true,

        database: "sqlite",

        clientAccounts: true,

        emailConfigured:
            mailer.isConfigured(),

        appointments: true,

        emailReminders:
            reminders.isConfigured()

    });

});


/* ==========================================
   37 | UNKNOWN ROUTES
   ========================================== */

app.use("/api", (req, res) => {

    fail(
        res,
        "API route not found",
        404
    );

});

app.use((req, res) => {

    res.status(404)

        .type("text")

        .send("Page not found");

});


/* ==========================================
   38 | SERVER ERROR HANDLING
   ========================================== */

app.use((error, req, res, next) => {

    console.error(

        "Monse Media server error:",

        error.code ||
        error.name ||
        "ERROR"

    );

    if (res.headersSent) {

        return next(error);

    }

    if (
        error.status === 404 ||
        error.code === "ENOENT"
    ) {

        return fail(
            res,
            "File not found",
            404
        );

    }

    if (error.status === 413) {

        return fail(
            res,
            "Request too large",
            413
        );

    }

    if (error.type === "entity.parse.failed") {

        return fail(
            res,
            "Invalid request body",
            400
        );

    }

    if (error instanceof multer.MulterError) {

        return fail(
            res,
            "Upload too large or too many files.",
            400
        );

    }

    if (error.message === "Unsupported file type") {

        return fail(
            res,
            "Unsupported file type",
            400
        );

    }

    fail(
        res,
        "Server error",
        500
    );

});


/* ==========================================
   39 | START MONSE MEDIA SERVER
   ========================================== */

const server = app.listen(

    PORT,

    HOST,

    () => {

        console.log(
            "MONSE MEDIA SERVER IS RUNNING"
        );

        console.log(
            "Website:",
            SITE_URL + "/"
        );

        console.log(
            "Admin:",
            SITE_URL + "/admin.html"
        );

        console.log(
            "Health:",
            SITE_URL + "/api/health"
        );

        console.log(
            "Client accounts: enabled"
        );

        console.log(

            "Email reminders:",

            reminders.start()

                ? "enabled"

                : "disabled"

        );

    }

);


/* ==========================================
   40 | SAFE SERVER SHUTDOWN
   ========================================== */

let shuttingDown = false;

function shutdown() {

    if (shuttingDown) return;

    shuttingDown = true;

    server.close(async () => {

        await reminders.stop();

        db.close();

        process.exitCode = 0;

    });

    void reminders.stop();

    setTimeout(
        () => process.exit(1),
        90000
    ).unref();

}

process.on("SIGINT", shutdown);

process.on("SIGTERM", shutdown);


/* ==========================================
   END OF MONSE MEDIA SERVER.JS
   ========================================== */