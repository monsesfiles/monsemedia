/* ==========================================
   MONSE MEDIA | BOOKING.JS
   Public Inquiries & Client Bookings
   Email Notification Preferences
   Requires: supabase.js
   ========================================== */

"use strict";

document.addEventListener("DOMContentLoaded", () => {

    const API = window.MonseAPI;
    const $ = id => document.getElementById(id);

    const form = $("booking-form") || $("inquiry-form");

    const status = $("booking-status") ||
        $("contact-form-status");

    if (!form || !status) return;

    const accountBooking = form.id === "booking-form";

    const button = form.querySelector('[type="submit"]');

    const preferenceUpdate = $("updateEmailPreferences");

    const reminderChoices = $("bookingEmailChoices");

    const reminderKeys = [
        "week_before",
        "day_before",
        "morning_of"
    ];

    const acknowledgment = $("bookingAcknowledgment") ||
        form.querySelector('[name="booking_acknowledgment"]');

    const controller = new AbortController();

    let sending = false;
    let leaving = false;
    let locked = false;


    /* ==========================================
       01 | FORM MESSAGES
       ========================================== */

    function message(value, type = "") {

        status.classList.remove(
            "success",
            "error",
            "is-error"
        );

        if (type) status.classList.add(type);

        if (type === "error") {

            status.classList.add("is-error");

        }

        status.textContent = value;

    }


    /* CREATE CLIENT PORTAL LINKS */

    function addLink(address, label) {

        const link = document.createElement("a");

        link.href = address;

        link.textContent = label;

        link.style.cssText =
            "display:block;" +
            "margin-top:15px;" +
            "color:inherit;" +
            "text-decoration:underline";

        status.append(link);

    }


    /* ==========================================
       02 | OPTIONAL EMAIL REMINDERS
       ========================================== */

    /* DISABLE ANY REMAINING SMS CHECKBOXES */

    for (const input of form.querySelectorAll(
        '[name="sms_consent"]'
    )) {

        input.checked = false;

        input.disabled = true;

        const label = input.closest("label") ||
            input.labels?.[0];

        if (label) label.hidden = true;

        input.hidden = true;

    }


    /* ENABLE EMAIL PREFERENCES WHEN REQUESTED */

    function syncReminders() {

        if (reminderChoices) {

            reminderChoices.disabled =

                !accountBooking ||

                preferenceUpdate?.checked !== true;

        }

    }

    preferenceUpdate?.addEventListener(
        "change",
        syncReminders
    );

    form.addEventListener("reset", () => {

        queueMicrotask(syncReminders);

    });

    syncReminders();


    /* ==========================================
       03 | VALIDATE BOOKING DETAILS
       ========================================== */

    function collectInquiry() {

        const data = new FormData(form);

        const read = key =>
            String(data.get(key) || "").trim();


        /* PROJECT INFORMATION */

        const inquiry = {

            service: read("service"),

            event_type:
                read("event_type") || "Custom project",

            event_date: read("event_date"),

            event_location: read("event_location"),

            message: read("message")

        };


        /* PUBLIC CLIENT INFORMATION */

        if (!accountBooking) {

            inquiry.name = read("name");

            inquiry.email = read("email");

            if (

                !inquiry.name ||

                inquiry.name.length > 120 ||

                inquiry.email.length > 254 ||

                !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/
                    .test(inquiry.email)

            ) {

                throw new Error(
                    "Enter a valid name and email address."
                );

            }

            inquiry.website = read("website");

        }


        /* VALIDATE REQUIRED INFORMATION */

        if (!inquiry.service || !inquiry.message) {

            throw new Error(
                "Please complete all required fields."
            );

        }


        /* VALIDATE FIELD LENGTHS */

        if (

            inquiry.service.length > 80 ||

            inquiry.event_type.length > 100 ||

            inquiry.event_location.length > 200 ||

            inquiry.message.length > 5000

        ) {

            throw new Error(
                "Some booking details are too long. Please shorten them."
            );

        }


        /* VALIDATE REQUESTED DATE */

        if (inquiry.event_date) {

            const date = new Date(
                inquiry.event_date + "T00:00:00Z"
            );

            if (

                !/^\d{4}-\d{2}-\d{2}$/
                    .test(inquiry.event_date) ||

                Number.isNaN(date.getTime()) ||

                date.toISOString().slice(0, 10) !==
                    inquiry.event_date

            ) {

                throw new Error(
                    "Choose a valid date."
                );

            }

        }


        /* ==========================================
           RETURNING CLIENT INFORMATION
           ========================================== */

        if (accountBooking) {

            inquiry.event_time = read("event_time");

            inquiry.timezone =
                read("timezone") || "America/Chicago";


            /* VALIDATE SESSION TIME */

            if (

                inquiry.event_time &&

                !/^([01]\d|2[0-3]):[0-5]\d$/
                    .test(inquiry.event_time)

            ) {

                throw new Error(
                    "Choose a valid session time."
                );

            }

            if (

                inquiry.event_time &&
                !inquiry.event_date

            ) {

                throw new Error(
                    "Choose a date for your requested time."
                );

            }


            /* VALIDATE TIME ZONE */

            try {

                new Intl.DateTimeFormat("en-US", {

                    timeZone: inquiry.timezone

                });

            } catch {

                throw new Error(
                    "Choose a valid time zone."
                );

            }


            /* BOOKING ACKNOWLEDGMENT */

            if (!acknowledgment?.checked) {

                throw new Error(
                    "Please acknowledge that this is a request, not a confirmed booking."
                );

            }

            inquiry.booking_acknowledgment =
                acknowledgment?.checked === true;


            /* ==========================================
               EMAIL NOTIFICATION PREFERENCES
               ========================================== */

            /*
                Only update account preferences when
                the client explicitly requests a change.

                Otherwise, preserve existing preferences.
            */

            if (preferenceUpdate?.checked === true) {

                if (

                    !reminderChoices ||

                    reminderChoices.matches(":disabled")

                ) {

                    throw new Error(
                        "Email reminder choices are unavailable."
                    );

                }

                inquiry.email_preferences = {};

                for (const key of reminderKeys) {

                    const input =
                        reminderChoices.querySelector(
                            `[name="${key}"]`
                        );

                    if (

                        !input ||

                        input.type !== "checkbox"

                    ) {

                        throw new Error(
                            "Email reminder choices are incomplete."
                        );

                    }

                    inquiry.email_preferences[key] =
                        input.checked;

                }

            }

        }

        return inquiry;

    }


    /* ==========================================
       04 | SUBMIT TO NODE.JS DATABASE
       ========================================== */

    async function sendToDatabase(inquiry) {

        if (!API?.isConfigured()) {

            throw new Error(
                "Open Monse Media through its Node.js server."
            );

        }

        const options = {

            signal: controller.signal

        };


        /* RETURNING CLIENT REQUEST */

        if (accountBooking) {

            const session = await API.account(

                "/session",

                "GET",

                undefined,

                options

            );


            /* VERIFY SIGNED-IN ACCOUNT */

            if (

                session?.authenticated !== true ||

                !session.profile?.id

            ) {

                throw new Error(
                    "Please sign in again before booking."
                );

            }


            /* SAVE REQUEST TO CLIENT ACCOUNT */

            const result = await API.account(

                "/inquiries",

                "POST",

                inquiry,

                options

            );

            if (result?.ok !== true) {

                throw new Error(
                    "Booking could not be confirmed."
                );

            }

            return result;

        }


        /* PUBLIC BOOKING REQUEST */

        const result = await API.request(

            "/api/inquiries",

            "POST",

            inquiry,

            {

                ...options,

                public: true

            }

        );

        if (result?.ok !== true) {

            throw new Error(
                "Inquiry could not be confirmed."
            );

        }

        return result;

    }


    /* ==========================================
       05 | OPTIONAL FORMSPREE FALLBACK
       ========================================== */

    /*
        Formspree is only used for public inquiries
        submitted through GitHub Pages.

        Private account requests must use the
        authenticated Node.js backend.
    */

    async function sendToFormspree(inquiry) {

        const endpoint = new URL(

            form.getAttribute("action") || "",

            location.href

        );


        /* VALIDATE FORMSPREE ADDRESS */

        if (

            endpoint.origin !== "https://formspree.io" ||

            !/^\/f\/[A-Za-z0-9_-]+\/?$/
                .test(endpoint.pathname) ||

            endpoint.username ||

            endpoint.password ||

            endpoint.search ||

            endpoint.hash

        ) {

            throw new Error(
                "The public contact form is not configured."
            );

        }


        /* ONLY SEND PUBLIC INQUIRY INFORMATION */

        const data = new FormData();

        for (const key of [

            "name",

            "email",

            "service",

            "event_type",

            "event_date",

            "event_location",

            "message",

            "website"

        ]) {

            data.append(

                key,

                inquiry[key] || ""

            );

        }


        /* SUBMIT PUBLIC EMAIL REQUEST */

        const response = await fetch(endpoint, {

            method: "POST",

            headers: {

                Accept: "application/json"

            },

            credentials: "omit",

            redirect: "error",

            referrerPolicy: "no-referrer",

            signal: controller.signal,

            body: data

        });

        const result = await response.json()
            .catch(() => ({}));

        if (!response.ok || result.ok !== true) {

            throw new Error(
                "Email submission could not be confirmed."
            );

        }

    }


    /* ==========================================
       06 | PRIVATE CLIENT PORTAL LINK
       ========================================== */

    function showPortalLink(address) {

        if (

            typeof address !== "string" ||

            !address

        ) return;

        try {

            const url = new URL(
                address,
                location.href
            );

            const expected = new URL(
                "client.html",
                location.href
            );

            const token = new URLSearchParams(

                url.hash.slice(1)

            ).get("token") || "";


            /* VERIFY PRIVATE PORTAL LINK */

            if (

                url.origin !== expected.origin ||

                url.username ||

                url.password ||

                ![
                    expected.pathname,
                    "/client.html"
                ].includes(url.pathname) ||

                url.search ||

                !/^[A-Za-z0-9_-]{40,100}$/
                    .test(token)

            ) return;


            /* CREATE VERIFIED PORTAL URL */

            expected.hash = new URLSearchParams({

                token

            }).toString();

            addLink(

                expected.href,

                "OPEN YOUR PRIVATE CLIENT PORTAL ↗"

            );


            /* CLIENT PRIVACY NOTICE */

            const note =
                document.createElement("small");

            note.textContent =
                "Save this confidential link. Do not share it.";

            status.append(note);

        } catch {

            // Do not display unverified links.

        }

    }


    /* ==========================================
       07 | HANDLE BOOKING SUBMISSION
       ========================================== */

    form.addEventListener("submit", async event => {

        event.preventDefault();


        /* PREVENT DUPLICATE REQUESTS */

        if (

            sending ||

            leaving ||

            locked ||

            button?.matches(":disabled") ||

            !form.reportValidity()

        ) return;


        /* COLLECT AND VALIDATE INFORMATION */

        let inquiry;

        try {

            inquiry = collectInquiry();

        } catch (error) {

            return message(

                error.message,

                "error"

            );

        }


        /* DISPLAY SENDING STATUS */

        sending = true;

        const original = button?.textContent;

        if (button) {

            button.disabled = true;

            button.textContent =
                "SENDING REQUEST...";

        }

        message("Submitting your request...");


        try {


            /* PUBLIC GITHUB PAGES FALLBACK */

            if (

                !accountBooking &&

                location.hostname.endsWith(".github.io")

            ) {

                await sendToFormspree(inquiry);

                if (leaving) return;

                form.reset();

                message(

                    "Your inquiry was sent by email. A private booking record has not been created.",

                    "success"

                );

                return;

            }


            /* SAVE BOOKING TO PRIVATE DATABASE */

            const result =
                await sendToDatabase(inquiry);

            if (leaving) return;

            form.reset();


            /* SUCCESS MESSAGE */

            message(

                "Your request was received! It is awaiting review, not confirmed.",

                "success"

            );


            /* RETURNING CLIENT CONFIRMATION */

            if (accountBooking) {


                /* EMAIL REMINDER CONFIRMATION */

                if (inquiry.email_preferences) {

                    const note =
                        document.createElement("p");

                    note.textContent =

                        result.emailPreferencesSaved === true

                            ? "Your account-wide email reminder preferences were saved. Reminders require a confirmed appointment and an active email service."

                            : "Your booking was received, but your reminder preference update was not confirmed. Check your account settings.";

                    status.append(note);

                }


                /* RETURN TO CLIENT DASHBOARD */

                addLink(

                    "dashboard.html",

                    "RETURN TO MY DASHBOARD ↗"

                );

            } else {


                /* NEW CLIENT PRIVATE PORTAL */

                showPortalLink(result.portalUrl);

            }


            /* SUCCESS ANIMATION */

            if (

                !matchMedia(
                    "(prefers-reduced-motion: reduce)"
                ).matches &&

                typeof window.launchFireworks === "function"

            ) {

                try {

                    window.launchFireworks();

                } catch {

                    // Request already saved.

                }

            }


        } catch (error) {

            if (leaving) return;


            /* ACCOUNT SESSION EXPIRED */

            if (

                accountBooking &&

                [401, 403].includes(error.status)

            ) {

                locked = true;

                message(

                    "Please sign in again before submitting a request.",

                    "error"

                );

                addLink(

                    "client.html",

                    "SIGN IN ↗"

                );


            /* BACKEND NOT CONNECTED */

            } else if (

                accountBooking &&

                error.status === 404

            ) {

                message(

                    "The returning-client booking service is not connected yet.",

                    "error"

                );


            /* GENERAL SUBMISSION ERROR */

            } else {

                message(

                    (

                        error.message ||

                        "Submission could not be confirmed."

                    ) +

                    " If the submission may have reached the server, contact Monse Media before retrying.",

                    "error"

                );

            }

        } finally {


            /* RESTORE SUBMIT BUTTON */

            sending = false;

            if (button) {

                button.textContent = original;

                button.disabled =
                    leaving || locked;

            }

        }

    });


    /* ==========================================
       08 | PAGE PRIVACY
       ========================================== */

    window.addEventListener("pagehide", () => {

        leaving = true;

        controller.abort();

        if (accountBooking) {

            form.reset();

        }

        message("");

        if (button) {

            button.disabled = true;

        }

    });


    /* REVERIFY ACCESS ON BACK NAVIGATION */

    window.addEventListener("pageshow", event => {

        if (event.persisted) {

            location.reload();

        }

    });

});


/* ==========================================
   END OF MONSE MEDIA BOOKING.JS
   ========================================== */