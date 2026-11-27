/* ==========================================
   MONSE MEDIA | MAILER.JS
   Account Emails & Appointment Reminders
   ========================================== */

"use strict";

const nodemailer = require("nodemailer");

function createMailer({ siteUrl, adminEmail }) {

    const site = new URL(siteUrl);

    const production =
        process.env.NODE_ENV === "production";

    if (
        !["http:", "https:"].includes(site.protocol) ||
        site.username ||
        site.password ||
        site.search ||
        site.hash ||
        site.pathname !== "/" ||
        (production && site.protocol !== "https:")
    ) {
        throw new Error("Invalid email SITE_URL.");
    }


    /* ==========================================
       01 | SMTP EMAIL CONNECTION
       ========================================== */

    const host =
        (process.env.SMTP_HOST || "").trim();

    const user =
        (process.env.SMTP_USER || "").trim();

    const pass =
        process.env.SMTP_PASS || "";

    const port =
        Number(process.env.SMTP_PORT || 587);

    const from =
        process.env.MAIL_FROM || user;

    const configured =
        Boolean(host && user && pass && from);

    if (
        configured &&
        (!Number.isInteger(port) ||
        port < 1 ||
        port > 65535)
    ) {
        throw new Error("Invalid SMTP_PORT.");
    }

    const transport = configured

        ? nodemailer.createTransport({

            host,
            port,

            secure: port === 465,

            requireTLS: port !== 465,

            auth: {
                user,
                pass
            },

            connectionTimeout: 15000,

            greetingTimeout: 15000,

            socketTimeout: 30000,

            logger: false,

            debug: false

        })

        : null;


    /* ==========================================
       02 | SAFE EMAIL CONTENT
       ========================================== */

    function escapeHTML(value) {

        return String(value ?? "").replace(
            /[&<>"']/g,
            char => ({

                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;"

            })[char]
        );

    }

    const clean = (value, max = 200) =>

        typeof value === "string"

            ? value.trim().slice(0, max)

            : "";


    /* ==========================================
       03 | SEND EMAIL
       ========================================== */

    async function sendEmail(
        to,
        subject,
        message,
        html
    ) {

        if (!transport) return false;

        if (

            typeof to !== "string" ||

            to.length > 254 ||

            !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/
                .test(to) ||

            /[\x00-\x1f\x7f]/.test(to) ||

            typeof subject !== "string" ||

            /[\r\n]/.test(subject) ||

            subject.length > 250 ||

            typeof message !== "string" ||

            (
                html !== undefined &&
                typeof html !== "string"
            )

        ) return false;

        try {

            const result = await transport.sendMail({

                from,

                to,

                subject,

                text: message,

                ...(html ? { html } : {}),

                disableFileAccess: true,

                disableUrlAccess: true

            });

            return Array.isArray(result.accepted) &&
                result.accepted.length > 0;

        } catch {

            console.error(
                "Monse Media: email sending failed."
            );

            return false;

        }

    }


    /* ==========================================
       04 | MONSE MEDIA EMAIL DESIGN
       ========================================== */

    function brandedEmail(
        to,
        subject,
        heading,
        paragraphs,
        action,
        footer = ""
    ) {

        const text = [

            heading,

            ...paragraphs,

            ...(action
                ? [action.label + ":\n" + action.url]
                : []),

            footer,

            "Monse Media | Your creative experience"

        ].filter(Boolean).join("\n\n");


        const html = `

<!doctype html>

<html lang="en">

<body style="
    margin:0;
    background:#f7f1ee;
    color:#24151a;
    font-family:Arial,sans-serif;
">

<table role="presentation"
       width="100%"
       cellspacing="0"
       cellpadding="0">

<tr>

<td align="center"
    style="padding:24px 12px;">

<table role="presentation"
       width="100%"
       cellspacing="0"
       cellpadding="0"
       style="
           max-width:600px;
           background:#ffffff;
       ">


<!-- EMAIL HEADER -->

<tr>

<td style="
    background:#721f32;
    color:#ffffff;
    padding:28px;
">

<div style="
    font-size:25px;
    letter-spacing:3px;
    font-weight:bold;
">

    MONSE MEDIA

</div>

<div style="
    font-size:12px;
    letter-spacing:2px;
    margin-top:8px;
">

    YOUR CREATIVE EXPERIENCE

</div>

</td>

</tr>


<!-- EMAIL CONTENT -->

<tr>

<td style="
    padding:28px;
    line-height:1.65;
">

<h1 style="
    font-family:Georgia,serif;
    color:#721f32;
    font-size:28px;
    line-height:1.2;
">

    ${escapeHTML(heading)}

</h1>

${paragraphs.map(p =>

    `<p>${escapeHTML(p).replace(/\n/g, "<br>")}</p>`

).join("")}


<!-- CLIENT PORTAL BUTTON -->

${action ? `

<p style="margin:28px 0;">

    <a href="${escapeHTML(action.url)}"

       style="
           display:inline-block;
           background:#721f32;
           color:#ffffff;
           padding:14px 22px;
           text-decoration:none;
           font-weight:bold;
       ">

       ${escapeHTML(action.label)}

    </a>

</p>

<p style="
    font-size:12px;
    overflow-wrap:anywhere;
">

    ${escapeHTML(action.url)}

</p>

` : ""}


<!-- SIGNATURE -->

<p>

    With love and creativity,

    <br>

    <strong>Monse Media</strong>

</p>

</td>

</tr>


<!-- EMAIL FOOTER -->

<tr>

<td style="
    background:#24151a;
    color:#f1e5e7;
    padding:22px;
    font-size:12px;
    line-height:1.6;
">

${escapeHTML(

    footer ||
    "Private client communication from Monse Media."

).replace(/\n/g, "<br>")}

</td>

</tr>

</table>

</td>

</tr>

</table>

</body>

</html>

`;

        return sendEmail(
            to,
            subject,
            text,
            html
        );

    }


    /* ==========================================
       05 | PRIVATE ACCOUNT LINKS
       ========================================== */

    function accountLink(page, key, token) {

        if (

            typeof token !== "string" ||

            !/^[A-Za-z0-9_-]{43,128}$/.test(token)

        ) {

            throw new Error(
                "Invalid account token."
            );

        }

        const url = new URL(
            page,
            site.origin
        );

        url.hash = new URLSearchParams({

            [key]: token

        }).toString();

        return url.href;

    }


    /* ==========================================
       06 | CLIENT EMAIL VERIFICATION
       ========================================== */

    function sendVerification(to, token) {

        return brandedEmail(

            to,

            "Monse Media — Verify Your Email",

            "Welcome to Monse Media!",

            [

                "Your private client account is almost ready.",

                "Open the verification link in the same browser you used to register. The link expires and can only be used once."

            ],

            {

                label: "VERIFY MY EMAIL",

                url: accountLink(

                    "/client.html",

                    "verify",

                    token

                )

            },

            "If you did not request this account, ignore this email. Keep your link private."

        );

    }


    /* ==========================================
       07 | PASSWORD RECOVERY EMAIL
       ========================================== */

    function sendPasswordReset(to, token) {

        return brandedEmail(

            to,

            "Monse Media — Reset Your Password",

            "Reset your password",

            [

                "A password reset was requested for your client account.",

                "Use the private link below to choose a new password. The link expires and can only be used once."

            ],

            {

                label: "RESET MY PASSWORD",

                url: accountLink(

                    "/reset-password.html",

                    "recovery",

                    token

                )

            },

            "If you did not request a reset, ignore this email. Keep your link private."

        );

    }


    /* ==========================================
       08 | EMAIL ADDRESS CHANGE
       ========================================== */

    function sendEmailChange(to, token) {

        return brandedEmail(

            to,

            "Monse Media — Confirm Your New Email",

            "Confirm your email address",

            [

                "Confirm the new email address for your client account.",

                "This private link expires and can only be used once."

            ],

            {

                label: "CONFIRM NEW EMAIL",

                url: accountLink(

                    "/client.html",

                    "verify-email-change",

                    token

                )

            },

            "If you did not request this change, ignore this email."

        );

    }


    /* ==========================================
       09 | FORMAT APPOINTMENT INFORMATION
       ========================================== */

    function appointmentDetails(appointment) {

        const a = appointment || {};

        const date = clean(a.date, 10);

        const time = clean(a.time, 8);

        const timezone = clean(a.timezone, 100);

        const location = clean(a.location, 200);

        const day = new Date(
            date + "T00:00:00Z"
        );


        /* VALIDATE APPOINTMENT */

        if (

            !/^\d{4}-\d{2}-\d{2}$/.test(date) ||

            Number.isNaN(day.getTime()) ||

            day.toISOString().slice(0, 10) !== date ||

            !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/
                .test(time) ||

            !timezone ||

            !location

        ) {

            throw new Error(

                "Invalid confirmed appointment details."

            );

        }


        /* VALIDATE TIME ZONE */

        new Intl.DateTimeFormat("en-US", {

            timeZone: timezone

        });


        /* FORMAT SESSION DATE */

        const displayDate =
            day.toLocaleDateString("en-US", {

                weekday: "long",

                month: "long",

                day: "numeric",

                year: "numeric",

                timeZone: "UTC"

            });


        /* FORMAT SESSION TIME */

        const [hour, minute] =
            time.split(":").map(Number);

        const displayTime =

            `${hour % 12 || 12}:` +

            `${String(minute).padStart(2, "0")} ` +

            `${hour < 12 ? "AM" : "PM"}`;


        /* RETURN APPOINTMENT INFORMATION */

        return [

            `Date: ${displayDate}`,

            `Time: ${displayTime} (${timezone})`,

            `Location: ${location}`

        ].join("\n");

    }


    /* CLIENT DASHBOARD BUTTON */

    const dashboard = {

        label: "OPEN MY CLIENT PORTAL",

        url: new URL(

            "/dashboard.html",

            site.origin

        ).href

    };


    /* ==========================================
       10 | APPOINTMENT CONFIRMATION EMAIL
       ========================================== */

    function sendAppointmentConfirmation(
        to,
        appointment
    ) {

        const name =
            clean(appointment?.name, 80) || "there";

        return brandedEmail(

            to,

            "Monse Media — Your Session Is Confirmed",

            "You're officially booked!",

            [

                `Hi ${name},`,

                "Your creative session has been confirmed. I'm excited to work with you!",

                appointmentDetails(appointment),

                "Visit your private client dashboard to review your session details."

            ],

            dashboard

        );

    }


    /* ==========================================
       11 | APPOINTMENT REMINDER TEMPLATES
       ========================================== */

    const reminderTemplates = {


        /* ONE WEEK BEFORE */

        week: {

            subject:

                "Monse Media — Your Session Is One Week Away!",

            heading:

                "One week to go!",

            message:

                "Your creative session is coming up. Start preparing your outfits, inspiration and anything special you'd like to include."

        },


        /* ONE DAY BEFORE */

        day: {

            subject:

                "Monse Media — See You Tomorrow!",

            heading:

                "Tomorrow is the day!",

            message:

                "Your session is tomorrow. Take a moment to review your appointment details and prepare everything you need."

        },


        /* MORNING OF THE SESSION */

        morning: {

            subject:

                "Monse Media — It's Shoot Day!",

            heading:

                "It's shoot day!",

            message:

                "Today is your creative session! I'm looking forward to capturing your vision. Please review your confirmed time and location."

        }

    };


    /* ==========================================
       12 | SEND APPOINTMENT REMINDER
       ========================================== */

    function sendAppointmentReminder(
        to,
        appointment,
        kind
    ) {

        if (

            !Object.hasOwn(
                reminderTemplates,
                kind
            )

        ) {

            throw new Error(
                "Invalid reminder type."
            );

        }

        const template =
            reminderTemplates[kind];

        const name =
            clean(appointment?.name, 80) || "there";

        const settingsUrl = new URL(

            "/client-settings.html#notifications",

            site.origin

        ).href;


        /*
            The reminder scheduler must verify:

            - Confirmed appointment
            - Verified client email
            - Current notification preferences
            - Correct reminder time
            - No previous duplicate reminder
        */

        return brandedEmail(

            to,

            template.subject,

            template.heading,

            [

                `Hi ${name},`,

                template.message,

                appointmentDetails(appointment)

            ],

            dashboard,

            `Manage optional appointment email reminders in your client settings:\n${settingsUrl}`

        );

    }


    /* ==========================================
       13 | GALLERY DELIVERY EMAIL
       ========================================== */

    function sendGalleryReady(to, name) {

        return brandedEmail(

            to,

            "Monse Media — Your Memories Are Ready!",

            "Your gallery is ready!",

            [

                `Hi ${clean(name, 80) || "there"},`,

                "Your finished collection is ready to view and download. Thank you for trusting Monse Media with your memories!"

            ],

            {

                label: "VIEW MY GALLERIES",

                url: new URL(

                    "/client-gallery.html",

                    site.origin

                ).href

            }

        );

    }


    /* ==========================================
       14 | ADMIN NOTIFICATIONS
       ========================================== */

    function notifyAdmin(subject, message) {

        return sendEmail(

            adminEmail,

            subject,

            message

        );

    }


    /* ==========================================
       15 | EXPORT EMAIL FUNCTIONS
       ========================================== */

    return Object.freeze({

        isConfigured: () => configured,

        sendEmail,

        sendVerification,

        sendPasswordReset,

        sendEmailChange,

        sendAppointmentConfirmation,

        sendAppointmentReminder,

        sendGalleryReady,

        notifyAdmin

    });

}


module.exports = {

    createMailer

};


/* ==========================================
   END OF MONSE MEDIA MAILER.JS
   ========================================== */