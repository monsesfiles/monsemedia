/* ==========================================
   MONSE MEDIA | DASHBOARD.JS
   Returning Client Dashboard
   Email Notification Preferences
   Requires: supabase.js
   ========================================== */

"use strict";

document.addEventListener("DOMContentLoaded", () => {

    const $ = id => document.getElementById(id);

    const API = window.MonseAPI;

    const controller = new AbortController();

    const options = {
        signal: controller.signal
    };

    let active = false;
    let busy = false;
    let leaving = false;


    /* ==========================================
       01 | EMAIL REMINDER PREFERENCES
       ========================================== */

    const reminderFields = {

        week_before: "weekReminderStatus",

        day_before: "dayReminderStatus",

        morning_of: "morningReminderStatus"

    };

    const reminderKeys = Object.keys(reminderFields);

    const knownPreferences = prefs =>

        reminderKeys.every(key =>

            typeof prefs?.[key] === "boolean"

        );

    const reminderCount = prefs =>

        reminderKeys.filter(key =>

            prefs?.[key] === true

        ).length;


    /* PROJECT STATUS LABELS */

    const labels = {

        pending: "AWAITING REVIEW",

        more_info: "MORE INFORMATION REQUESTED",

        approved: "PROJECT ACCEPTED",

        signed: "CONTRACT SIGNED",

        confirmed: "CONFIRMED",

        completed: "COMPLETED",

        delivered: "DELIVERED",

        declined: "NOT ACCEPTED",

        cancelled: "CANCELLED",

        published: "GALLERY AVAILABLE"

    };


    /* ==========================================
       02 | DISPLAY HELPERS
       ========================================== */

    function text(id, value = "") {

        if ($(id)) $(id).textContent = value;

    }

    function show(id, visible) {

        if (!$(id)) return;

        $(id).hidden = !visible;

        $(id).classList.toggle("hidden", !visible);

    }

    function feedback(id, value = "", error = false) {

        text(id, value);

        $(id)?.classList.toggle("is-error", error);

    }


    /* ==========================================
       03 | LOCK PRIVATE DASHBOARD
       ========================================== */

    function lock(reason, error = false) {

        active = false;

        show("dashboardWorkspace", false);

        show("dashboardAccess", true);


        /* CLEAR PRIVATE PROJECTS */

        for (const id of [

            "upcomingSessions",

            "pastSessions",

            "bookingRequests"

        ]) {

            $(id)?.replaceChildren();

        }


        /* CLEAR STATISTICS */

        for (const id of [

            "upcomingCount",

            "completedCount",

            "galleryCount"

        ]) {

            text(id, "—");

        }


        /* CLEAR PRIVATE ACCOUNT INFORMATION */

        for (const id of [

            "clientFirstName",

            "clientAccountEmail",

            "reminderEmail",

            "emailReminderServiceStatus"

        ]) {

            text(id);

        }

        text(

            "emailPreferenceStatus",

            "Preferences unavailable."

        );

        $("emailPreferenceStatus")

            ?.removeAttribute("data-status");

        Object.values(reminderFields)

            .forEach(id => text(id, "—"));

        feedback("dashboardMessage");

        feedback("accessStatus", reason, error);

    }


    /* ==========================================
       04 | SECURE SERVER CONNECTION
       ========================================== */

    async function account(
        path,
        method = "GET",
        data
    ) {

        if (!API || leaving) {

            throw new Error(
                "Account access is unavailable."
            );

        }

        try {

            const result = await API.account(

                path,

                method,

                data,

                options

            );

            if (leaving) {

                throw new Error("Page closed.");

            }

            return result;

        } catch (error) {

            if (

                !leaving &&

                [401, 403].includes(error.status)

            ) {

                lock(

                    "Please sign in to access your client account.",

                    true

                );

            }

            throw error;

        }

    }


    /* ==========================================
       05 | FORMAT SESSION INFORMATION
       ========================================== */

    function formatDate(value) {

        if (typeof value !== "string") return "";

        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {

            return value;

        }

        const date = new Date(

            `${value}T00:00:00Z`

        );

        if (Number.isNaN(date.getTime())) {

            return value;

        }

        return date.toLocaleDateString("en-US", {

            month: "long",

            day: "numeric",

            year: "numeric",

            timeZone: "UTC"

        });

    }


    function formatTime(value) {

        const match =

            /^(\d{2}):(\d{2})(?::\d{2})?$/

                .exec(value || "");

        if (!match) return value || "";

        const hour = Number(match[1]);

        if (

            hour > 23 ||

            Number(match[2]) > 59

        ) {

            return value;

        }

        return `${hour % 12 || 12}:${match[2]} ${
            hour < 12 ? "AM" : "PM"
        }`;

    }


    /* DISPLAY CARD INFORMATION */

    function field(card, key, value) {

        const el = card.querySelector(

            `[data-field="${key}"]`

        );

        if (!el) return;

        el.textContent = value ?? "";

        el.hidden = value == null || value === "";

    }


    /* PROJECT STATUS */

    function status(card, state) {

        const known = Object.hasOwn(labels, state);

        field(

            card,

            "status",

            known

                ? labels[state]

                : "STATUS UNAVAILABLE"

        );

        card.querySelector('[data-field="status"]')

            .dataset.status = known

                ? state

                : "unknown";

    }


    /* PROJECT TITLE */

    const title = row =>

        row.event_type ||

        row.service ||

        "Creative session";


    /* INDIVIDUAL PROJECT PAGE */

    function pageLink(page, id) {

        const url = new URL(page, location.href);

        url.searchParams.set(

            "project",

            String(id)

        );

        return url.href;

    }


    /* ==========================================
       06 | UPCOMING SESSIONS
       ========================================== */

    function sessionCard(
        row,
        confirmed,
        capabilities,
        prefs
    ) {

        const card = $("sessionCardTemplate")

            .content.cloneNode(true);

        const a = row.appointment || {};


        /* SESSION STATUS */

        status(

            card,

            confirmed

                ? "confirmed"

                : row.status

        );

        field(card, "title", title(row));


        /* SESSION DATE */

        field(

            card,

            "date",

            formatDate(

                confirmed

                    ? a.date

                    : row.event_date

            )

        );


        /* SESSION TIME */

        field(

            card,

            "time",

            [

                formatTime(

                    confirmed

                        ? a.time

                        : row.event_time

                ),

                confirmed

                    ? a.timezone

                    : row.timezone

            ].filter(Boolean).join(" · ")

        );


        /* SESSION LOCATION */

        field(

            card,

            "location",

            confirmed

                ? a.location

                : row.event_location

        );


        /* EMAIL REMINDER PREFERENCES */

        const count = reminderCount(prefs);

        field(

            card,

            "reminders",

            !confirmed

                ? "Requested details are not a confirmed appointment."

                : !knownPreferences(prefs)

                ? "Email reminder preferences unavailable."

                : count === 0

                ? "Optional email reminders are off."

                : `${count} of 3 email reminder preferences enabled. Timing and service availability apply.`

        );


        /* INDIVIDUAL SESSION ACCESS */

        if (capabilities?.sessionDetails === true) {

            const link = card.querySelector(

                '[data-action="details"]'

            );

            link.href = pageLink(

                "client.html",

                row.id

            );

            link.hidden = false;

        }

        return card;

    }


    /* ==========================================
       07 | PRIVATE GALLERY DOWNLOADS
       ========================================== */

    function galleryReady(row) {

        return (

            row.published === true &&

            Boolean(row.signed_at) &&

            row.id != null

        );

    }


    /* DOWNLOAD COMPLETE CLIENT COLLECTION */

    async function download(row, button) {

        if (

            !active ||

            busy ||

            leaving ||

            !galleryReady(row)

        ) return;

        busy = true;

        button.disabled = true;

        const original = button.textContent;

        button.textContent =

            "PREPARING COLLECTION...";

        feedback("dashboardMessage");

        try {

            const id = encodeURIComponent(row.id);

            const result = await account(

                `/projects/${id}/download-link`,

                "POST",

                {

                    fileId: "all"

                }

            );

            if (active && !leaving) {

                location.assign(

                    API.privateURL(result.url)

                );

            }

        } catch (error) {

            if (active && !leaving) {

                feedback(

                    "dashboardMessage",

                    error.message,

                    true

                );

            }

        } finally {

            busy = false;

            button.textContent = original;

            button.disabled = !active || leaving;

        }

    }


    /* ==========================================
       08 | PAST SESSION GALLERIES
       ========================================== */

    function galleryCard(row) {

        const card = $("galleryCardTemplate")

            .content.cloneNode(true);

        const ready = galleryReady(row);


        /* GALLERY STATUS */

        status(

            card,

            ready

                ? "published"

                : row.status

        );

        field(card, "title", title(row));


        /* SESSION DATE */

        field(

            card,

            "date",

            formatDate(

                row.appointment?.date ||

                row.event_date

            )

        );


        /* FILE COUNT */

        field(

            card,

            "fileCount",

            ready &&

            Number.isInteger(row.fileCount) &&

            row.fileCount >= 0

                ? `${row.fileCount} file(s)`

                : ""

        );


        /* DISPLAY AUTHORIZED GALLERY */

        if (ready) {

            const link = card.querySelector(

                '[data-action="gallery"]'

            );

            link.href = pageLink(

                "client-gallery.html",

                row.id

            );

            link.hidden = false;


            /* DOWNLOAD COLLECTION */

            const button = card.querySelector(

                '[data-action="download"]'

            );

            button.disabled = row.fileCount === 0;

            button.addEventListener(

                "click",

                () => void download(row, button)

            );


            /* PRIVATE COVER IMAGE */

            const image = card.querySelector(

                '[data-field="cover"]'

            );

            const placeholder = card.querySelector(

                '[data-field="placeholder"]'

            );

            try {

                if (row.coverUrl) {

                    const src = API.privateURL(

                        row.coverUrl

                    );

                    image.alt =

                        `Cover for ${title(row)}`;

                    image.addEventListener(

                        "error",

                        () => {

                            image.hidden = true;

                            image.removeAttribute("src");

                            placeholder.hidden = false;

                        },

                        { once: true }

                    );

                    image.hidden = false;

                    placeholder.hidden = true;

                    image.src = src;

                }

            } catch {

                // Keep placeholder if the cover
                // image is unavailable.

            }

        }

        return card;

    }


    /* ==========================================
       09 | RENDER PROJECT LISTS
       ========================================== */

    function renderList(
        container,
        empty,
        rows,
        makeCard
    ) {

        $(container).replaceChildren(

            ...rows.map(makeCard)

        );

        show(empty, rows.length === 0);

    }


    /* ==========================================
       10 | DISPLAY VERIFIED CLIENT DASHBOARD
       ========================================== */

    function renderDashboard(data) {

        if (leaving) return;


        /* VALIDATE ACCOUNT DATA */

        if (

            data?.authenticated !== true ||

            !data.profile?.id ||

            ![

                data.upcoming,

                data.past,

                data.requests

            ].every(rows =>

                Array.isArray(rows) &&

                rows.every(row =>

                    row &&

                    typeof row === "object" &&

                    row.id != null

                )

            )

        ) {

            throw new Error(

                "Account or dashboard data could not be verified."

            );

        }


        const {

            profile,

            upcoming,

            past,

            requests,

            email_preferences: prefs,

            capabilities

        } = data;


        /* PERSONALIZED CLIENT GREETING */

        const first = String(

            profile.first_name ||

            profile.name ||

            ""

        ).trim().split(/\s+/)[0];

        text(

            "clientFirstName",

            first

                ? `, ${first.toUpperCase()}`

                : ""

        );

        text(

            "clientAccountEmail",

            profile.email || ""

        );


        /* ==========================================
           CLIENT SESSION STATISTICS
           ========================================== */

        text(

            "upcomingCount",

            String(upcoming.length).padStart(2, "0")

        );

        text(

            "completedCount",

            String(past.length).padStart(2, "0")

        );

        text(

            "galleryCount",

            String(

                past.filter(galleryReady).length

            ).padStart(2, "0")

        );


        /* UPCOMING SESSIONS */

        renderList(

            "upcomingSessions",

            "upcomingEmpty",

            upcoming,

            row => sessionCard(

                row,

                true,

                capabilities,

                prefs

            )

        );


        /* PAST SESSIONS */

        renderList(

            "pastSessions",

            "historyEmpty",

            past,

            galleryCard

        );


        /* NEW BOOKING REQUESTS */

        renderList(

            "bookingRequests",

            "requestsEmpty",

            requests,

            row => sessionCard(

                row,

                false,

                capabilities,

                prefs

            )

        );


        /* ==========================================
           EMAIL REMINDER PREFERENCES
           ========================================== */

        const known = knownPreferences(prefs);

        const count = reminderCount(prefs);

        text(

            "emailPreferenceStatus",

            !known

                ? "Preferences unavailable."

                : count

                ? `${count} of 3 reminders enabled`

                : "Email reminders are off."

        );

        $("emailPreferenceStatus").dataset.status =

            !known

                ? "unknown"

                : count

                ? "opted-in"

                : "opted-out";


        /* INDIVIDUAL REMINDER STATUS */

        for (const key of reminderKeys) {

            text(

                reminderFields[key],

                !known

                    ? "Unavailable"

                    : prefs[key]

                    ? "Enabled"

                    : "Off"

            );

        }


        /* VERIFIED REMINDER EMAIL */

        text(

            "reminderEmail",

            profile.emailVerified === true &&

            profile.email

                ? `Reminder email: ${profile.email}`

                : "A verified email is required."

        );


        /* AUTOMATIC EMAIL SERVICE STATUS */

        text(

            "emailReminderServiceStatus",

            capabilities?.emailReminders === true

                ? "Reminders are scheduled for eligible confirmed appointments."

                : "Automatic email delivery is not currently confirmed as available."

        );


        /* UNLOCK VERIFIED CLIENT DASHBOARD */

        active = true;

        show("dashboardAccess", false);

        show("dashboardWorkspace", true);

    }


    /* ==========================================
       11 | CLIENT ACCOUNT LOGOUT
       ========================================== */

    $("dashboardLogout")?.addEventListener(

        "click",

        async () => {

            if (

                !active ||

                busy ||

                leaving

            ) return;

            busy = true;

            lock("Signing out...");

            try {

                const result = await account(

                    "/logout",

                    "POST",

                    {}

                );

                if (result?.ok !== true) {

                    throw new Error(

                        "Logout not confirmed."

                    );

                }

                if (!leaving) {

                    location.replace("client.html");

                }

            } catch {

                if (!leaving) {

                    lock(

                        "Dashboard closed, but server logout could not be confirmed. Sign in again to retry.",

                        true

                    );

                }

            } finally {

                busy = false;

            }

        }

    );


    /* ==========================================
       12 | PRIVATE DASHBOARD SECURITY
       ========================================== */

    window.addEventListener("pagehide", () => {

        leaving = true;

        controller.abort();

        lock("Checking account access...");

    });


    /* REVERIFY ACCOUNT ON BACK NAVIGATION */

    window.addEventListener("pageshow", event => {

        if (event.persisted) {

            location.reload();

        }

    });


    /* ==========================================
       13 | INITIALIZE CLIENT DASHBOARD
       ========================================== */

    async function initialize() {

        lock("Checking account access...");

        try {


            /* VERIFY BACKEND CONFIGURATION */

            if (!API?.isConfigured()) {

                throw new Error(

                    "Open Monse Media through its Node.js server."

                );

            }


            /* VERIFY SERVER HEALTH */

            const health = await API.checkHealth(

                options

            );

            if (!health.clientAccounts) {

                throw new Error(

                    "Client accounts are not enabled yet."

                );

            }

            if (leaving) return;


            /* VERIFY AUTHENTICATED SESSION */

            const session = await account(

                "/session"

            );

            if (

                session?.authenticated !== true ||

                !session.profile?.id

            ) {

                throw new Error(

                    "Please sign in to your client account."

                );

            }


            /* LOAD PRIVATE DASHBOARD */

            const data = await account(

                "/dashboard"

            );


            /* VERIFY ACCOUNT OWNERSHIP */

            if (

                data?.profile?.id !==

                session.profile.id

            ) {

                throw new Error(

                    "Account access could not be verified."

                );

            }

            renderDashboard(data);

        } catch (error) {

            if (leaving) return;

            lock(

                error.status === 404

                    ? "The dashboard data service is not connected yet."

                    : [401, 403].includes(error.status)

                    ? "Please sign in to access your client account."

                    : error.message ||

                    "Unable to verify account access.",

                true

            );

        }

    }


    /* START CLIENT DASHBOARD */

    void initialize();

});


/* ==========================================
   END OF MONSE MEDIA DASHBOARD.JS
   ========================================== */