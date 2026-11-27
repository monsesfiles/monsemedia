/* ==========================================
   MONSE MEDIA | ADMIN.JS
   Private Studio Dashboard
   Email Reminder Management
   ========================================== */

"use strict";

document.addEventListener("DOMContentLoaded", () => {

    const controller = new AbortController();

    const $ = id => document.getElementById(id);

    const login = $("loginForm");
    const list = $("projectList");

    const terms = [
        "quote",
        "duration",
        "deliverables",
        "turnaround",
        "cancellation",
        "usage_rights"
    ];

    const appointmentFields = [
        "sessionDate",
        "sessionTime",
        "sessionTimezone",
        "sessionLocation"
    ];

    let base;
    let selectedId = null;
    let project = null;
    let version = 0;

    let signedIn = false;
    let busy = false;
    let leaving = false;
    let appointmentEnabled = false;


    /* ==========================================
       01 | DISPLAY HELPERS
       ========================================== */

    function text(id, value = "—") {

        if ($(id)) {

            $(id).textContent =
                value == null || value === ""
                    ? "—"
                    : String(value);

        }

    }

    function message(id, value = "", error = false) {

        if (!$(id)) return;

        $(id).textContent = value;

        $(id).classList.toggle("is-error", error);

    }

    function show(id, visible) {

        if (!$(id)) return;

        $(id).hidden = !visible;

        $(id).classList.toggle("hidden", !visible);

        $(id).style.display = visible ? "" : "none";

    }

    function fill(id, value = "") {

        if ($(id)) {

            $(id).value = value ?? "";

        }

    }

    function disable(id, state) {

        if ($(id)) {

            $(id).disabled = state;

        }

    }


    /* ==========================================
       02 | CLEAR PRIVATE PROJECT INFORMATION
       ========================================== */

    function resetProject() {

        project = null;

        appointmentEnabled = false;

        show("projectPanel", false);

        show("emptySelection", true);

        [...terms, ...appointmentFields]
            .forEach(id => fill(id));

        fill("sessionTimezone", "America/Chicago");

        const privateFields = [

            "projectTitle",
            "projectStatus",
            "detailName",
            "detailEmail",
            "detailService",
            "detailEvent",
            "detailDate",
            "detailLocation",
            "detailMessage",
            "detailInspiration",
            "signatureStatus",
            "galleryStatus",
            "detailReminderEmail",
            "emailConsentStatus",
            "emailWeekStatus",
            "emailDayStatus",
            "emailMorningStatus",
            "emailServiceStatus"

        ];

        privateFields.forEach(id => {

            text(id);

            $(id)?.removeAttribute("data-status");

        });

        [

            "detailEmail",
            "detailPinterest",
            "contractLink"

        ].forEach(id => {

            $(id)?.removeAttribute("href");

        });

        show("detailPinterest", false);

        show("contractLink", false);

        for (

            const c of Array.from(
                $("projectStatus")?.classList || []
            )

        ) {

            if (c.startsWith("status-")) {

                $("projectStatus").classList.remove(c);

            }

        }

        $("projectFiles")?.replaceChildren();

        $("clientHistoryList")?.replaceChildren();

        $("uploadForm")?.reset();

        disable("appointmentFields", true);

        message("appointmentStatus");

        text(
            "clientHistoryStatus",
            "Client history is not connected yet."
        );

    }


    /* ==========================================
       03 | ADMINISTRATOR SESSION
       ========================================== */

    function setSignedIn(active) {

        if (active && leaving) return;

        signedIn = active;

        show("loginView", !active);

        show("workspace", active);

        if (!active) {

            version++;

            selectedId = null;

            resetProject();

            list?.replaceChildren();

            text("projectCount", "0 PROJECTS");

            show("listEmpty", false);

            fill("adminPassword");

            message("adminMessage");

        }

    }


    /* ==========================================
       04 | SECURE BACKEND CONNECTION
       ========================================== */

    async function api(
        path,
        method = "GET",
        data
    ) {

        if (!base || leaving) {

            throw new Error(
                "Admin access is unavailable."
            );

        }

        const url = new URL(path, base);

        if (

            url.origin !== base.origin ||

            !url.pathname.startsWith("/api/admin/") ||

            url.username ||

            url.password ||

            url.hash

        ) {

            throw new Error("Invalid API address.");

        }

        const multipart = data instanceof FormData;

        let response;

        try {

            response = await fetch(url, {

                method,

                credentials: "include",

                cache: "no-store",

                redirect: "error",

                referrerPolicy: "same-origin",

                signal: controller.signal,

                headers: {

                    Accept: "application/json",

                    ...(

                        data !== undefined && !multipart

                            ? {

                                "Content-Type": "application/json"

                            }

                            : {}

                    )

                },

                body:

                    data === undefined

                        ? undefined

                        : multipart

                        ? data

                        : JSON.stringify(data)

            });

        } catch {

            throw new Error(

                "Unable to connect to the Monse Media server. Check your backend connection."

            );

        }

        if (leaving) {

            throw new Error("Page closed.");

        }


        /* INVALID ADMIN SESSION */

        if (

            [401, 403].includes(response.status) &&

            signedIn

        ) {

            setSignedIn(false);

            message(

                "loginStatus",

                "Your admin access could not be verified. Sign in again.",

                true

            );

        }


        /* READ SERVER RESPONSE */

        const json = (

            response.headers.get("content-type") || ""

        ).includes("json");

        const result =

            json && response.status !== 204

                ? await response.json()

                : {};

        if (leaving) {

            throw new Error("Page closed.");

        }

        if (!response.ok) {

            const error = new Error(

                result?.error ||

                `Request failed (${response.status}).`

            );

            error.status = response.status;

            throw error;

        }

        if (!json && response.status !== 204) {

            throw new Error(

                "Unexpected server response. Check API configuration."

            );

        }

        return result;

    }


    /* INDIVIDUAL PROJECT API */

    const pathFor = (id, suffix = "") =>

        `/api/admin/projects/${encodeURIComponent(id)}${suffix}`;


    /* VERIFY PROJECT ACCESS */

    const ready = () =>

        !leaving &&

        signedIn &&

        !busy &&

        selectedId !== null &&

        !!project;


    /* ==========================================
       05 | PREVENT DUPLICATE ACTIONS
       ========================================== */

    async function run(

        buttonId,

        label,

        task,

        errorId = "adminMessage"

    ) {

        if (busy || leaving) return;

        busy = true;

        const button = $(buttonId);

        const original = button?.textContent;

        if (button) {

            button.disabled = true;

            button.textContent = label;

        }

        try {

            await task();

        } catch (error) {

            if (

                !leaving &&

                (signedIn || errorId === "loginStatus")

            ) {

                message(

                    errorId,

                    error.message,

                    true

                );

            }

        } finally {

            busy = false;

            if (button) {

                button.textContent = original;

                button.disabled = leaving;

            }

            if (!leaving && signedIn && project) {

                syncControls();

            }

        }

    }


    /* ==========================================
       06 | LOAD CLIENT PROJECTS
       ========================================== */

    async function getProjects() {

        const projects = await api(

            "/api/admin/projects"

        );

        if (!Array.isArray(projects)) {

            throw new Error("Unexpected project list.");

        }

        return projects;

    }


    /* ==========================================
       CLIENT ARCHIVE | COMPLETED PROJECTS
       ========================================== */

    function isArchived(row) {

        return !!row && (

            row.published === 1 ||

            row.published === true ||

            ["delivered", "completed"].includes(row.status)

        );

    }


    /* FORMAT FOLDER NAMES */

    function folderLabel(value, fallback) {

        const label = String(value || "")
            .trim()
            .replace(/[-_]+/g, " ");

        return (label || fallback)
            .replace(/\b\w/g, letter => letter.toUpperCase());

    }


    /* ==========================================
       CREATE INTERACTIVE ARCHIVE FOLDERS
       ========================================== */

    function archiveFolder(title, count, key, expanded) {

        const folder = document.createElement("details");

        folder.dataset.archiveKey = key;

        folder.open = expanded;

        folder.style.margin = "6px 0";

        const summary = document.createElement("summary");

        summary.textContent = `📁 ${title} (${count})`;

        Object.assign(summary.style, {

            padding: "12px 10px",

            cursor: "pointer",

            fontSize: "12px",

            fontWeight: "600",

            color: "var(--admin-gold, #c8a77e)",

            border: "1px solid var(--admin-border, #40232b)",

            background: "var(--admin-card, #1d0d12)",

            overflowWrap: "anywhere"

        });

        const contents = document.createElement("div");

        Object.assign(contents.style, {

            padding: "8px 0 0 12px",

            display: "grid",

            gap: "8px"

        });

        folder.append(summary, contents);

        return {

            folder,

            contents

        };

    }


    /* ==========================================
       INDIVIDUAL CLIENT RECORD
       ========================================== */

    function projectCard(row) {

        const button = document.createElement("button");

        button.type = "button";

        button.className = "admin-project-item";

        button.dataset.projectId = String(row.id);

        button.setAttribute("aria-pressed", "false");

        const name = document.createElement("strong");

        name.textContent = row.name || "Unnamed client";

        const info = document.createElement("div");

        info.textContent = [

            folderLabel(row.event_type, "Custom project"),

            row.event_date,

            row.status || "pending"

        ].filter(Boolean).join(" · ");

        button.append(name, info);

        button.addEventListener("click", () => {

            if (!busy) {

                void selectProject(row.id);

            }

        });

        return button;

    }


    /* ==========================================
       ORGANIZE CURRENT AND PAST CLIENTS
       ========================================== */

    async function loadProjects(projects) {

        message(

            "adminMessage",

            "Loading studio records..."

        );

        const rows = projects ?? await getProjects();

        if (!signedIn || leaving) return;


        /* REMEMBER OPEN FOLDERS */

        const expanded = new Set(

            Array.from(

                list?.querySelectorAll("details[open]") || [],

                folder => folder.dataset.archiveKey

            )

        );

        list?.replaceChildren();


        /* SEPARATE ACTIVE AND COMPLETED PROJECTS */

        const current = rows.filter(

            row => !isArchived(row)

        );

        const past = rows.filter(isArchived);

        text(

            "projectCount",

            `${current.length} CURRENT · ${past.length} ARCHIVED`

        );

        show("listEmpty", !rows.length);

        text("inquiriesHeading", "STUDIO FILES");

        const description = list

            ?.closest("aside")

            ?.querySelector(".admin-muted");

        if (description) {

            description.textContent =

                "Open a current inquiry or browse your completed projects by service and event.";

        }


        /* RESTORE PREVIOUSLY SELECTED CLIENT */

        const next = rows.find(

            row => String(row.id) === String(selectedId)

        ) || current[0] || past[0];

        const includesNext = group => group.some(

            row => String(row.id) === String(next?.id)

        );


        /* CURRENT INQUIRIES FOLDER */

        const activeFolder = archiveFolder(

            "Current inquiries",

            current.length,

            "current",

            true

        );

        for (const row of current) {

            activeFolder.contents.append(

                projectCard(row)

            );

        }

        if (current.length) {

            list?.append(activeFolder.folder);

        }


        /* ==========================================
           PAST CLIENTS FOLDER
           ========================================== */

        const archive = archiveFolder(

            "Past clients",

            past.length,

            "archive",

            expanded.has("archive") || includesNext(past)

        );


        /* GROUP CLIENTS BY SERVICE AND EVENT TYPE */

        const groups = new Map();

        for (const row of past) {

            const service = folderLabel(

                row.service,

                "Other services"

            );

            const event = folderLabel(

                row.event_type,

                "Custom projects"

            );

            if (!groups.has(service)) {

                groups.set(service, new Map());

            }

            const events = groups.get(service);

            if (!events.has(event)) {

                events.set(event, []);

            }

            events.get(event).push(row);

        }


        /* CREATE SERVICE FOLDERS */

        for (

            const [service, events]

            of [...groups].sort(

                ([a], [b]) => a.localeCompare(b)

            )

        ) {

            const serviceRows = [...events.values()].flat();

            const serviceKey = JSON.stringify([service]);

            const section = archiveFolder(

                service,

                serviceRows.length,

                serviceKey,

                expanded.has(serviceKey) ||

                includesNext(serviceRows)

            );


            /* CREATE EVENT TYPE SUBFOLDERS */

            for (

                const [event, records]

                of [...events].sort(

                    ([a], [b]) => a.localeCompare(b)

                )

            ) {

                const eventKey = JSON.stringify([

                    service,

                    event

                ]);

                const category = archiveFolder(

                    event,

                    records.length,

                    eventKey,

                    expanded.has(eventKey) ||

                    includesNext(records)

                );


                /* ADD CLIENT RECORDS */

                for (const row of records) {

                    category.contents.append(

                        projectCard(row)

                    );

                }

                section.contents.append(

                    category.folder

                );

            }

            archive.contents.append(

                section.folder

            );

        }


        /* EMPTY ARCHIVE MESSAGE */

        if (!past.length) {

            const empty = document.createElement("p");

            empty.className = "admin-muted";

            empty.textContent = "No completed projects yet.";

            archive.contents.append(empty);

        }

        if (rows.length) {

            list?.append(archive.folder);

        }


        /* DISPLAY ACTIVE CLIENT INFORMATION */

        if (next) {

            await selectProject(next.id);

        } else {

            version++;

            selectedId = null;

            resetProject();

            message("adminMessage");

        }

    }


    /* ==========================================
       SHRED PROJECT | PERMANENT DELETION
       ========================================== */

    function syncShredControl() {

        const titleRow = $("projectTitle")

            ?.closest(".admin-title-row");

        if (!titleRow) return;

        let button = $("shredProjectButton");


        /* CREATE SHRED BUTTON */

        if (!button) {

            button = document.createElement("button");

            button.id = "shredProjectButton";

            button.type = "button";

            button.className =

                "admin-button-outline admin-danger";

            button.textContent = "SHRED PROJECT";


            /* SHRED BUTTON EVENT */

            button.addEventListener("click", () => {

                if (!ready() || !isArchived(project)) {

                    return;

                }

                const id = String(selectedId);

                const label =

                    `${project.name || "Client"} — ${project.event_type || "Project"}`;


                /* ARE YOU SURE? CONFIRMATION */

                if (!window.confirm(

                    `ARE YOU SURE?\n\nShred ${label}?\n\nThis permanently removes this project's records, agreement and uploaded files from the portal. Other projects and the client account remain. This cannot be undone from the website.`

                )) {

                    return;

                }


                /* SEND SECURE DELETE REQUEST */

                void run(

                    "shredProjectButton",

                    "SHREDDING...",

                    async () => {

                        const result = await api(

                            pathFor(id, "/shred"),

                            "POST",

                            {

                                confirm: "SHRED",

                                projectId: id

                            }

                        );


                        /* VERIFY DELETION */

                        if (result?.ok !== true) {

                            throw new Error(

                                "Deletion could not be confirmed. Refresh before retrying."

                            );

                        }

                        if (!signedIn || leaving) {

                            return;

                        }


                        /* REMOVE DELETED PROJECT FROM DISPLAY */

                        selectedId = null;

                        version++;

                        resetProject();

                        list?.replaceChildren();


                        /* RELOAD CLIENT ARCHIVE */

                        try {

                            await loadProjects();

                            if (signedIn && !leaving) {

                                message(

                                    "adminMessage",

                                    result.warning ||

                                    "Project shredded successfully.",

                                    !!result.warning

                                );

                            }

                        } catch {

                            if (signedIn && !leaving) {

                                message(

                                    "adminMessage",

                                    "Project removed. Refresh to reload the archive. " +

                                    (result.warning || ""),

                                    true

                                );

                            }

                        }

                    }

                );

            });

            titleRow.append(button);

        }


        /* ONLY COMPLETED PROJECTS CAN BE SHREDDED */

        button.hidden = !isArchived(project);

        button.disabled =

            !ready() || !isArchived(project);

    }


    /* ==========================================
       07 | PROJECT CONTROL AVAILABILITY
       ========================================== */

    function syncControls() {

        syncShredControl();

        const locked =

            !project || !!project.signed_at;

        $("approvalForm")

            ?.querySelectorAll(

                "input, textarea, select, button"

            )

            .forEach(el => {

                el.disabled = locked;

            });

        disable("requestInfoButton", locked);

        disable("declineButton", locked);

        disable(

            "appointmentFields",

            !appointmentEnabled

        );

        disable(

            "publishButton",

            !project?.signed_at ||

            !!project?.published

        );

    }


    /* ==========================================
       08 | EMAIL REMINDER STATUS
       ========================================== */

    function status(id, state, label) {

        text(

            id,

            label || state || "Not available"

        );

        if ($(id)) {

            $(id).dataset.status =

                state || "unknown";

        }

    }


    /* EMAIL REMINDER TYPES */

    const reminderFields = [

        [

            "emailWeekStatus",

            "week",

            "week_before"

        ],

        [

            "emailDayStatus",

            "day",

            "day_before"

        ],

        [

            "emailMorningStatus",

            "morning",

            "morning_of"

        ]

    ];


    /* REMINDER DELIVERY LABELS */

    const reminderLabels = {

        pending: "Pending",

        processing: "Sending",

        sent: "Accepted by mail server",

        failed: "Failed",

        skipped: "Skipped",

        cancelled: "Cancelled",

        unknown: "Send outcome unknown"

    };


    /* FORMAT REMINDER DATE AND TIME */

    function reminderDate(value, timezone) {

        if (!value) return "";

        const d = new Date(value);

        if (Number.isNaN(d.getTime())) {

            return "";

        }

        try {

            return d.toLocaleString("en-US", {

                timeZone:

                    timezone || "America/Chicago",

                month: "short",

                day: "numeric",

                year: "numeric",

                hour: "numeric",

                minute: "2-digit",

                timeZoneName: "short"

            });

        } catch {

            return "";

        }

    }


    /* ==========================================
       09 | APPOINTMENT AND EMAIL INFORMATION
       ========================================== */

    function renderSession(details) {

        const a = details.appointment || {};

        const prefs = details.email_preferences;

        const reminders = details.email_reminders;

        appointmentEnabled =

            details.capabilities?.appointments === true;


        /* CONFIRMED APPOINTMENT DETAILS */

        fill("sessionDate", a.date);

        fill("sessionTime", a.time);

        fill(

            "sessionTimezone",

            a.timezone || "America/Chicago"

        );

        fill("sessionLocation", a.location);


        /* VERIFY CLIENT EMAIL PREFERENCES */

        const known = reminderFields.every(

            ([, , key]) =>

                typeof prefs?.[key] === "boolean"

        );

        const count = known

            ? reminderFields.filter(

                ([, , key]) => prefs[key]

            ).length

            : 0;


        /* VERIFIED CLIENT EMAIL */

        text(

            "detailReminderEmail",

            details.reminder_email ||

            "No verified account email available"

        );


        /* CLIENT NOTIFICATION PREFERENCES */

        status(

            "emailConsentStatus",

            !known

                ? "unknown"

                : count

                ? "opted-in"

                : "opted-out",

            !known

                ? "Preferences unavailable"

                : `${count} of 3 reminders enabled`

        );


        /* EMAIL SERVICE AVAILABILITY */

        message(

            "emailServiceStatus",

            details.capabilities?.emailReminders === true

                ? "Automatic email service enabled. Delivery is not guaranteed."

                : "Automatic email service is not confirmed available."

        );


        /* INDIVIDUAL REMINDER DELIVERY STATUS */

        for (

            const [id, kind, key]

            of reminderFields

        ) {

            const r = reminders?.[kind];

            const state =

                r &&

                Object.hasOwn(

                    reminderLabels,

                    r.status

                )

                    ? r.status

                    : "unknown";

            const preference =

                !known

                    ? "Preference unavailable"

                    : prefs[key]

                    ? "Enabled"

                    : "Off";


            /* DISPLAY REMINDER STATUS */

            const label =

                r &&

                Object.hasOwn(

                    reminderLabels,

                    r.status

                )

                    ? reminderLabels[state]

                    : reminders &&

                      typeof reminders === "object"

                    ? "No scheduled record"

                    : "Schedule unavailable";


            /* DISPLAY SCHEDULED OR SENT TIME */

            const when = reminderDate(

                state === "sent"

                    ? r?.sent_at

                    : r?.due_at,

                a.timezone

            );

            status(

                id,

                state,

                [

                    preference,

                    label,

                    when

                ].filter(Boolean).join(" · ")

            );

        }


        /* APPOINTMENT SERVICE AVAILABILITY */

        message(

            "appointmentStatus",

            appointmentEnabled

                ? ""

                : "Scheduling is not connected yet."

        );


        /* ==========================================
           RETURNING CLIENT HISTORY
           ========================================== */

        const history = details.clientHistory;

        const container = $("clientHistoryList");

        container?.replaceChildren();

        text(

            "clientHistoryStatus",

            Array.isArray(history)

                ? history.length

                    ? `${history.length} previous session(s)`

                    : "No previous sessions."

                : "Client history is not connected yet."

        );

        if (Array.isArray(history)) {

            for (const session of history) {

                const item =

                    document.createElement("div");

                item.className =

                    "admin-file-item";

                item.textContent = [

                    session.service || "Session",

                    session.event_date,

                    session.status

                ].filter(Boolean).join(" · ");

                container?.append(item);

            }

        }

    }


    /* ==========================================
       10 | OPEN INDIVIDUAL CLIENT PROJECT
       ========================================== */

    async function selectProject(id) {

        if (!signedIn || leaving) return;

        const request = ++version;

        selectedId = id;

        resetProject();

        message(

            "adminMessage",

            "Loading project details..."

        );

        try {

            const details = await api(pathFor(id));

            if (

                !signedIn ||

                leaving ||

                request !== version

            ) return false;

            if (

                !details.project ||

                String(details.project.id) !== String(id)

            ) {

                throw new Error(

                    "Project details are unavailable."

                );

            }

            project = details.project;


            /* CLIENT INFORMATION */

            const fields = {

                detailName: "name",

                detailEmail: "email",

                detailService: "service",

                detailEvent: "event_type",

                detailDate: "event_date",

                detailLocation: "event_location",

                detailMessage: "message",

                detailInspiration: "inspiration"

            };

            for (

                const [key, field]

                of Object.entries(fields)

            ) {

                text(key, project[field]);

            }

            text(

                "projectTitle",

                project.name || "PROJECT REVIEW"

            );


            /* PROJECT STATUS */

            const state = String(

                project.status || "pending"

            );

            text(

                "projectStatus",

                state.toUpperCase()

            );

            if (/^[a-z_]+$/.test(state)) {

                $("projectStatus")

                    ?.classList.add(`status-${state}`);

            }


            /* CLIENT EMAIL LINK */

            if (

                /^[^\s@?&#]+@[^\s@?&#]+\.[^\s@?&#]+$/

                    .test(project.email || "") &&

                $("detailEmail")

            ) {

                $("detailEmail").href =

                    `mailto:${project.email}`;

            }


            /* PINTEREST INSPIRATION */

            try {

                const url =

                    new URL(project.pinterest);

                if (

                    url.protocol === "https:" &&

                    !url.username &&

                    !url.password &&

                    $("detailPinterest")

                ) {

                    $("detailPinterest").href =

                        url.href;

                    show("detailPinterest", true);

                }

            } catch {

                // No valid inspiration link.

            }


            /* CONTRACT INFORMATION */

            terms.forEach(id => {

                fill(id, project[id]);

            });

            if (

                project.contract_text &&

                $("contractLink")

            ) {

                $("contractLink").href = new URL(

                    pathFor(id, "/contract"),

                    base

                ).href;

                show("contractLink", true);

            }


            /* ELECTRONIC SIGNATURE */

            const date = new Date(project.signed_at);

            text(

                "signatureStatus",

                project.signed_at

                    ? `Signed by ${

                        project.signed_name || "client"

                    } on ${

                        Number.isNaN(date.getTime())

                            ? "recorded date"

                            : date.toLocaleString()

                    }`

                    : "Awaiting signature"

            );


            /* CLIENT GALLERY STATUS */

            text(

                "galleryStatus",

                project.published

                    ? "Published"

                    : "Not published"

            );


            /* DISPLAY SESSION AND EMAIL INFORMATION */

            renderSession(details);

            renderFiles(

                Array.isArray(details.files)

                    ? details.files

                    : [],

                id

            );

            syncControls();


            /* HIGHLIGHT ACTIVE PROJECT */

            list?.querySelectorAll(

                ".admin-project-item"

            ).forEach(button => {

                const active =

                    button.dataset.projectId === String(id);

                button.classList.toggle(

                    "active",

                    active

                );

                button.setAttribute(

                    "aria-pressed",

                    String(active)

                );


                /* AUTOMATICALLY OPEN ACTIVE PROJECT FOLDERS */

                if (active) {

                    let folder = button.closest("details");

                    while (folder) {

                        folder.open = true;

                        folder = folder.parentElement

                            ?.closest("details");

                    }

                }

            });

            show("emptySelection", false);

            show("projectPanel", true);

            message("adminMessage");

            return true;

        } catch (error) {

            if (

                signedIn &&

                !leaving &&

                request === version

            ) {

                resetProject();

                message(

                    "adminMessage",

                    error.message,

                    true

                );

            }

            return false;

        }

    }


    /* ==========================================
       11 | PROJECT APPROVAL AND CONTRACTS
       ========================================== */

    async function decide(decision, buttonId) {

        if (!ready() || project.signed_at) return;

        const id = selectedId;

        const payload = { decision };


        /* COLLECT CONTRACT TERMS */

        if (decision === "approved") {

            for (const field of terms) {

                payload[field] =

                    $(field)?.value.trim() || "";

                if (payload[field].length > 2000) {

                    return message(

                        "adminMessage",

                        "Each contract field must be 2,000 characters or fewer.",

                        true

                    );

                }

                if (!payload[field]) {

                    return message(

                        "adminMessage",

                        `Complete ${field.replaceAll("_", " ")} first.`,

                        true

                    );

                }

            }

        }


        /* SUBMIT PROJECT DECISION */

        await run(

            buttonId,

            "SAVING...",

            async () => {

                const result = await api(

                    pathFor(id, "/decision"),

                    "POST",

                    payload

                );

                if (

                    String(result?.project?.id) !== String(id) ||

                    result.project.status !== decision

                ) {

                    throw new Error(

                        "Project update could not be confirmed."

                    );

                }

                await loadProjects();

                if (signedIn && project) {

                    message(

                        "adminMessage",

                        "Project updated successfully."

                    );

                }

            }

        );

    }


    /* ACCEPT PROJECT */

    $("approvalForm")?.addEventListener(

        "submit",

        event => {

            event.preventDefault();

            void decide(

                "approved",

                "approveButton"

            );

        }

    );


    /* REQUEST MORE INFORMATION */

    $("requestInfoButton")?.addEventListener(

        "click",

        () => {

            void decide(

                "more_info",

                "requestInfoButton"

            );

        }

    );


    /* DECLINE PROJECT */

    $("declineButton")?.addEventListener(

        "click",

        () => {

            if (

                ready() &&

                confirm("Decline this project?")

            ) {

                void decide(

                    "declined",

                    "declineButton"

                );

            }

        }

    );


    /* ==========================================
       12 | CONFIRM OR RESCHEDULE APPOINTMENT
       ========================================== */

    $("appointmentForm")?.addEventListener(

        "submit",

        event => {

            event.preventDefault();

            if (

                !ready() ||

                !appointmentEnabled

            ) return;

            const [

                date,

                time,

                timezone,

                location

            ] = appointmentFields.map(id =>

                $(id)?.value.trim()

            );


            /* VALIDATE SESSION DETAILS */

            if (

                !date ||

                !time ||

                !timezone ||

                !location

            ) {

                return message(

                    "appointmentStatus",

                    "Complete all session fields.",

                    true

                );

            }


            /* VALIDATE TIME ZONE */

            try {

                new Intl.DateTimeFormat(

                    "en-US",

                    { timeZone: timezone }

                );

            } catch {

                return message(

                    "appointmentStatus",

                    "Enter a valid time zone, e.g. America/Chicago.",

                    true

                );

            }

            const id = selectedId;


            /* SAVE APPOINTMENT */

            void run(

                "saveAppointment",

                "SAVING...",

                async () => {

                    const result = await api(

                        pathFor(id, "/appointment"),

                        "POST",

                        {

                            date,

                            time,

                            timezone,

                            location

                        }

                    );

                    if (result?.ok !== true) {

                        throw new Error(

                            "Appointment update could not be confirmed."

                        );

                    }

                    if (await selectProject(id)) {

                        message(

                            "appointmentStatus",

                            "Session details saved."

                        );

                    }

                },

                "appointmentStatus"

            );

        }

    );


    /* ==========================================
       13 | CANCEL APPOINTMENT
       ========================================== */

    $("cancelAppointment")?.addEventListener(

        "click",

        () => {

            if (

                !ready() ||

                !appointmentEnabled ||

                !confirm(

                    "Cancel this session and its pending reminders?"

                )

            ) return;

            const id = selectedId;

            void run(

                "cancelAppointment",

                "CANCELLING...",

                async () => {

                    const result = await api(

                        pathFor(id, "/appointment/cancel"),

                        "POST",

                        {}

                    );

                    if (result?.ok !== true) {

                        throw new Error(

                            "Cancellation could not be confirmed."

                        );

                    }

                    if (await selectProject(id)) {

                        message(

                            "appointmentStatus",

                            "Session cancelled."

                        );

                    }

                },

                "appointmentStatus"

            );

        }

    );


    /* ==========================================
       14 | PRIVATE CLIENT FILES
       ========================================== */

    function renderFiles(files, id) {

        const container = $("projectFiles");

        if (!container) return;

        container.replaceChildren();

        if (!files.length) {

            container.textContent =

                "No uploaded files yet.";

            return;

        }


        /* DISPLAY UPLOADED FILES */

        for (const file of files) {

            const button =

                document.createElement("button");

            button.type = "button";

            button.className =

                "admin-button-outline";

            button.textContent =

                `DOWNLOAD: ${file.filename || "Untitled file"}`;


            /* PRIVATE FILE DOWNLOAD */

            button.addEventListener(

                "click",

                async () => {

                    if (

                        !ready() ||

                        button.disabled

                    ) return;

                    const currentVersion = version;

                    button.disabled = true;

                    try {

                        const result = await api(

                            pathFor(id, "/download-link"),

                            "POST",

                            {

                                fileId: file.id

                            }

                        );

                        if (

                            !signedIn ||

                            leaving ||

                            currentVersion !== version

                        ) return;


                        /* VERIFY DOWNLOAD ADDRESS */

                        if (

                            typeof result.url !== "string" ||

                            !result.url

                        ) {

                            throw new Error(

                                "Download unavailable."

                            );

                        }

                        const url = new URL(

                            result.url,

                            base

                        );

                        if (

                            url.origin !== base.origin ||

                            !/^\/api\/access\/[A-Za-z0-9_-]+\.[a-f0-9]{64}$/

                                .test(url.pathname) ||

                            url.username ||

                            url.password ||

                            url.search ||

                            url.hash

                        ) {

                            throw new Error(

                                "Invalid private download address."

                            );

                        }

                        window.location.assign(

                            url.href

                        );

                    } catch (error) {

                        if (

                            signedIn &&

                            currentVersion === version

                        ) {

                            message(

                                "adminMessage",

                                error.message,

                                true

                            );

                        }

                    } finally {

                        button.disabled = false;

                    }

                }

            );

            container.append(button);

        }

    }


    /* ==========================================
       15 | UPLOAD CLIENT DELIVERABLES
       ========================================== */

    $("uploadForm")?.addEventListener(

        "submit",

        event => {

            event.preventDefault();

            if (!ready()) return;

            const files = Array.from(

                $("deliveryFiles")?.files || []

            );


            /* VALIDATE NUMBER OF FILES */

            if (

                !files.length ||

                files.length > 12

            ) {

                return message(

                    "adminMessage",

                    "Choose 1–12 files per upload.",

                    true

                );

            }


            /* VALIDATE FILE SIZE AND TYPE */

            if (files.some(file =>

                !file.size ||

                file.size > 500 * 1024 * 1024 ||

                !/\.(jpe?g|png|webp|mp4|mov|pdf|zip)$/i

                    .test(file.name)

            )) {

                return message(

                    "adminMessage",

                    "Remove empty, unsupported or over-500 MB files.",

                    true

                );

            }

            const id = selectedId;

            const data = new FormData();

            files.forEach(file => {

                data.append("files", file);

            });


            /* UPLOAD PRIVATE FILES */

            void run(

                "uploadButton",

                "UPLOADING...",

                async () => {

                    const result = await api(

                        pathFor(id, "/files"),

                        "POST",

                        data

                    );

                    if (

                        result?.ok !== true ||

                        result.count !== files.length

                    ) {

                        throw new Error(

                            "Upload could not be fully confirmed. Refresh before retrying."

                        );

                    }

                    await selectProject(id);

                    if (signedIn && project) {

                        message(

                            "adminMessage",

                            "Upload complete."

                        );

                    }

                }

            );

        }

    );


    /* ==========================================
       16 | PUBLISH PRIVATE CLIENT GALLERY
       ========================================== */

    $("publishButton")?.addEventListener(

        "click",

        () => {

            if (

                !ready() ||

                !project.signed_at ||

                project.published ||

                !confirm(

                    "Publish the finished client gallery?"

                )

            ) return;

            const id = selectedId;

            void run(

                "publishButton",

                "PUBLISHING...",

                async () => {

                    const result = await api(

                        pathFor(id, "/publish"),

                        "POST",

                        {}

                    );

                    if (result?.ok !== true) {

                        throw new Error(

                            "Publication could not be confirmed."

                        );

                    }


                    /* AUTOMATICALLY MOVE TO PAST CLIENTS */

                    await loadProjects();

                    if (signedIn && project) {

                        message(

                            "adminMessage",

                            "Client gallery published."

                        );

                    }

                }

            );

        }

    );


    /* ==========================================
       17 | REFRESH ADMIN DASHBOARD
       ========================================== */

    $("refreshProjects")?.addEventListener(

        "click",

        () => {

            if (signedIn) {

                void run(

                    "refreshProjects",

                    "REFRESHING...",

                    () => loadProjects()

                );

            }

        }

    );


    /* ==========================================
       18 | ADMINISTRATOR LOGIN
       ========================================== */

    login?.addEventListener(

        "submit",

        event => {

            event.preventDefault();

            if (

                !base ||

                busy ||

                signedIn ||

                $("loginButton")?.disabled

            ) return;

            const email =

                $("adminEmail")?.value.trim();

            const password =

                $("adminPassword")?.value;

            if (!email || !password) {

                return message(

                    "loginStatus",

                    "Enter your email and password.",

                    true

                );

            }


            /* VERIFY ADMIN CREDENTIALS */

            void run(

                "loginButton",

                "SIGNING IN...",

                async () => {

                    fill("adminPassword");

                    const result = await api(

                        "/api/admin/login",

                        "POST",

                        {

                            email,

                            password

                        }

                    );

                    if (result?.ok !== true) {

                        throw new Error(

                            "Sign-in could not be confirmed."

                        );

                    }


                    /* VERIFY ADMIN SESSION */

                    const rows = await getProjects();

                    setSignedIn(true);

                    message("loginStatus");

                    await loadProjects(rows);

                },

                "loginStatus"

            );

        }

    );


    /* ==========================================
       19 | ADMINISTRATOR LOGOUT
       ========================================== */

    $("logoutButton")?.addEventListener(

        "click",

        () => {

            if (!signedIn || busy) return;

            void run(

                "logoutButton",

                "SIGNING OUT...",

                async () => {

                    try {

                        const result = await api(

                            "/api/admin/logout",

                            "POST",

                            {}

                        );

                        if (result?.ok !== true) {

                            throw new Error(

                                "Logout could not be confirmed."

                            );

                        }

                        setSignedIn(false);

                        login?.reset();

                        message(

                            "loginStatus",

                            "You have signed out."

                        );

                    } catch {

                        setSignedIn(false);

                        message(

                            "loginStatus",

                            "Dashboard closed, but server logout was not confirmed. Reconnect to end your session.",

                            true

                        );

                    }

                }

            );

        }

    );


    /* ==========================================
       20 | INITIALIZE ADMIN DASHBOARD
       ========================================== */

    async function initialize() {

        setSignedIn(false);

        if (

            !login ||

            !$("workspace") ||

            !list

        ) return;


        /* VERIFY BACKEND ADDRESS */

        try {

            base = new URL(window.location.origin);

            const localhost =

                base.protocol === "http:" &&

                [

                    "localhost",

                    "127.0.0.1",

                    "[::1]"

                ].includes(base.hostname);

            if (

                base.protocol !== "https:" &&

                !localhost

            ) {

                throw new Error(

                    "Use an HTTPS backend or a local development server."

                );

            }

            if (base.hostname.endsWith(".github.io")) {

                throw new Error(

                    "Connect the hosted backend before signing in."

                );

            }

        } catch (error) {

            base = null;

            disable("loginButton", true);

            message(

                "loginStatus",

                error.message,

                true

            );

            return;

        }


        /* CHECK EXISTING ADMIN SESSION */

        await run(

            "loginButton",

            "CHECKING SESSION...",

            async () => {

                try {

                    const rows = await getProjects();

                    setSignedIn(true);

                    await loadProjects(rows);

                } catch (error) {

                    setSignedIn(false);

                    if (error.status !== 401) {

                        message(

                            "loginStatus",

                            error.message,

                            true

                        );

                    }

                }

            },

            "loginStatus"

        );

    }


    /* ==========================================
       21 | PRIVATE DASHBOARD SECURITY
       ========================================== */

    window.addEventListener(

        "pagehide",

        () => {

            leaving = true;

            controller.abort();

            setSignedIn(false);

            login?.reset();

        }

    );


    /* REVERIFY ACCESS AFTER BACK NAVIGATION */

    window.addEventListener(

        "pageshow",

        event => {

            if (event.persisted) {

                window.location.reload();

            }

        }

    );


    /* START ADMIN DASHBOARD */

    void initialize();

});


/* ==========================================
   END OF MONSE MEDIA ADMIN.JS
   ========================================== */